/**
 * FFmpeg rendering engine.
 *
 * Two-stage approach:
 * Stage 1 (this file): trim + concat + scale + music mix using ffmpeg
 * Stage 2 (burn-captions.py): overlay word-by-word captions using Python/Pillow
 *
 * This split is necessary because the homebrew ffmpeg build doesn't include
 * libfreetype/drawtext. The ffmpeg stage handles all the heavy video processing.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { KeptSegment, PipelineConfig } from "./types";

const FFMPEG = "/opt/homebrew/bin/ffmpeg";

function buildAtempoChain(speed: number): string {
	if (!Number.isFinite(speed) || speed <= 0 || Math.abs(speed - 1) < 0.001) {
		return "anull";
	}
	const factors: number[] = [];
	let remaining = speed;
	while (remaining > 2) {
		factors.push(2);
		remaining /= 2;
	}
	while (remaining < 0.5) {
		factors.push(0.5);
		remaining /= 0.5;
	}
	factors.push(remaining);
	return factors.map((factor) => `atempo=${factor.toFixed(6)}`).join(",");
}

/**
 * Render the final video: trim segments + concat + scale + mix music.
 * Captions are handled separately.
 */
export function render(config: PipelineConfig, segments: KeptSegment[]): void {
	// Use concat demuxer approach — most reliable for 16+ segments
	renderWithConcatDemuxer(config, segments);
}

/**
 * Two-pass render:
 * Pass 1: Extract each segment to individual temp files (uses -ss for fast seeking)
 * Pass 2: Concat + scale to portrait + mix in background music
 */
function renderWithConcatDemuxer(
	config: PipelineConfig,
	segments: KeptSegment[],
): void {
	const tmpDir = resolve(dirname(config.output_path), ".render-tmp");
	execSync(`mkdir -p "${tmpDir}"`);

	console.log(`  Extracting ${segments.length} segments...`);

	// Pass 1: Extract each segment
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		const segPath = join(tmpDir, `seg_${String(i).padStart(3, "0")}.mp4`);
		const dur = seg.src_end_s - seg.src_start_s;

		// Use accurate seeking after -i so audio cut points match transcript timings.
		// Fast keyframe seeking can keep pre-roll audio and breaks reference audio proof.
		const cmd = [
			FFMPEG,
			"-y",
			`-i "${config.raw_path}"`,
			`-ss ${seg.src_start_s}`,
			`-t ${dur}`,
			`-c:v ${config.out_codec}`,
			`-crf ${config.out_crf}`,
			`-preset ultrafast`,
			`-c:a aac -b:a 192k`,
			`"${segPath}"`,
		].join(" ");

		try {
			execSync(cmd, { stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(
				`    ERROR extracting segment ${i}: ${message.slice(0, 200)}`,
			);
			// Try fallback with fast seek if accurate extraction fails.
			const fallbackCmd = [
				FFMPEG,
				"-y",
				`-ss ${seg.src_start_s}`,
				`-i "${config.raw_path}"`,
				`-t ${dur}`,
				`-c:v ${config.out_codec}`,
				`-crf ${config.out_crf}`,
				`-preset ultrafast`,
				`-c:a aac -b:a 192k`,
				`-avoid_negative_ts make_zero`,
				`"${segPath}"`,
			].join(" ");
			execSync(fallbackCmd, {
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 120_000,
			});
		}

		if ((i + 1) % 5 === 0 || i === segments.length - 1) {
			console.log(`    Extracted ${i + 1}/${segments.length}`);
		}
	}

	// Write concat list
	const concatListPath = join(tmpDir, "concat_list.txt");
	const lines = segments.map(
		(_, i) => `file '${join(tmpDir, `seg_${String(i).padStart(3, "0")}.mp4`)}'`,
	);
	writeFileSync(concatListPath, `${lines.join("\n")}\n`);

	// Pass 2: Concat all segments
	const concatOutPath = join(tmpDir, "concat_raw.mp4");
	console.log("  Concatenating segments...");
	execSync(
		`${FFMPEG} -y -f concat -safe 0 -i "${concatListPath}" -c copy "${concatOutPath}"`,
		{ stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 },
	);

	// Pass 3: Scale to portrait + mix in background music
	console.log("  Scaling + mixing music...");
	const concatDurationS = segments.reduce(
		(sum, segment) => sum + segment.duration_s,
		0,
	);
	const speed =
		config.target_duration_s &&
		config.target_duration_s > 0 &&
		concatDurationS > 0
			? concatDurationS / config.target_duration_s
			: 1;
	const videoPaceFilter =
		Math.abs(speed - 1) > 0.001 ? `,setpts=PTS/${speed.toFixed(6)}` : "";
	const speechPaceFilter = buildAtempoChain(speed);
	const speechSegmentFilters = segments.map(
		(segment, index) =>
			`[2:a]atrim=start=${segment.src_start_s}:end=${segment.src_end_s},asetpts=PTS-STARTPTS[speech${index}]`,
	);
	const speechLabels = segments.map((_, index) => `[speech${index}]`).join("");
	const musicStartOffsetS = Math.max(0, config.music_start_offset_s ?? 0);
	const filterComplex = [
		// Scale video to 1080x1920
		`[0:v]scale=${config.out_width}:${config.out_height}:force_original_aspect_ratio=decrease,` +
			`pad=${config.out_width}:${config.out_height}:(ow-iw)/2:(oh-ih)/2:black,` +
			`setsar=1${videoPaceFilter}[vout]`,
		// Rebuild speech audio directly from raw source timings. Using the
		// extracted segment files for audio can introduce keyframe/pre-roll drift.
		...speechSegmentFilters,
		`${speechLabels}concat=n=${segments.length}:v=0:a=1,${speechPaceFilter},volume=${config.speech_volume}[speech]`,
		`[1:a]atrim=start=${musicStartOffsetS.toFixed(3)},asetpts=PTS-STARTPTS,volume=${config.music_volume}[musicvol]`,
		`[speech][musicvol]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
	].join(";");

	const cmd = [
		FFMPEG,
		"-y",
		`-i "${concatOutPath}"`,
		`-i "${config.music_path}"`,
		`-i "${config.raw_path}"`,
		`-filter_complex "${filterComplex}"`,
		`-map "[vout]"`,
		`-map "[aout]"`,
		`-c:v ${config.out_codec}`,
		`-crf ${config.out_crf}`,
		`-preset fast`,
		`-r ${config.out_fps}`,
		`-c:a aac -b:a 192k`,
		`-movflags +faststart`,
		`"${config.output_path}"`,
	].join(" ");

	execSync(cmd, { stdio: ["pipe", "pipe", "pipe"], timeout: 300_000 });

	// Cleanup temp files
	console.log("  Cleaning up temp files...");
	execSync(`rm -rf "${tmpDir}"`);
}
