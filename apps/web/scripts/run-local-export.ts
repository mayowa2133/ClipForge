#!/usr/bin/env -S npx ts-node --project ../tsconfig.json
/**
 * ClipForge Local Export Pipeline
 *
 * Standalone CLI that takes raw footage + optional background music and
 * produces a finished video with:
 * - Intelligent content selection (LLM instruction / reference matching / silence removal)
 * - Visual analysis (detect and cut "looking down", "eyes closed", etc.)
 * - Explicit time-range cuts (--cut "0:45-1:02")
 * - Word-by-word captions (bold white text, black outline)
 * - Background music mixing
 * - Portrait 1080x1920 output
 *
 * Works fully offline — no database, no cloud storage required.
 *
 * Usage:
 *   CLIPFORGE_MODE=local npx bun run scripts/run-local-export.ts \
 *     --raw /path/to/raw-footage.mov \
 *     --output /path/to/output.mp4 \
 *     [--instruction "remove boring parts"] \
 *     [--cut "0:45-1:02"] \
 *     [--music /path/to/music.mp3] \
 *     [--reference /path/to/reference.mov] \
 *     [--target-duration 60] \
 *     [--width 1080] [--height 1920] \
 *     [--music-volume 0.12] \
 *     [--whisper-model base] \
 *     [--silence-threshold -20] \
 *     [--no-captions]
 */

// Set local mode BEFORE any imports that touch env schema
process.env.CLIPFORGE_MODE = "local";
process.env.CLIPFORGE_WHISPER_CLI_ENABLED = "true";
(process.env as Record<string, string | undefined>).NODE_ENV =
	process.env.NODE_ENV || "development";

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { execSync } from "node:child_process";

import {
	detectSilenceWithFfmpeg,
} from "../src/lib/clipforge/silence-detection-ffmpeg";
import {
	matchTranscriptCuts,
	buildCutsFromSilence,
	buildMappedCaptions,
	type CutSegment,
} from "../src/lib/clipforge/content-match";
import { runWhisperOnPath } from "../src/lib/clipforge/transcribers/whisper-cli-server";
import {
	generateAssFile,
	hasSubtitlesFilter,
	hasDrawtextFilter,
	buildDrawtextFilterChain,
	burnCaptionsWithPillow,
	type CaptionWord,
} from "../src/lib/clipforge/production/worker/caption-burn";
import {
	selectSegmentsWithLLM,
	applyTimeCuts,
} from "../src/lib/clipforge/editorial/llm-editorial-selector";
import {
	analyzeVideoForVisualCondition,
	filterSegmentsByVisualQuality,
	requiresVisualAnalysis,
	extractVisualCondition,
} from "../src/lib/clipforge/editorial/visual-frame-analyzer";

// ── Argument parsing ───────────────────────────────────────────

interface PipelineArgs {
	raw: string;
	music: string | null;
	output: string;
	reference: string | null;
	instruction: string | null;
	cuts: string[];
	targetDuration: number | null;
	width: number;
	height: number;
	musicVolume: number;
	whisperModel: string;
	silenceThreshold: number;
	noCaptions: boolean;
	ffmpegBin: string;
	visualAnalysis: boolean;
}

function parseArgs(): PipelineArgs {
	const args = process.argv.slice(2);
	const opts: PipelineArgs = {
		raw: "",
		music: null,
		output: "output.mp4",
		reference: null,
		instruction: null,
		cuts: [],
		targetDuration: null,
		width: 1080,
		height: 1920,
		musicVolume: 0.12,
		whisperModel: "base",
		silenceThreshold: -20,
		noCaptions: false,
		ffmpegBin: process.env.CLIPFORGE_FFMPEG_BIN || "ffmpeg",
		visualAnalysis: false,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const next = args[i + 1];
		switch (arg) {
			case "--raw": opts.raw = next!; i++; break;
			case "--music": opts.music = next!; i++; break;
			case "--output": opts.output = next!; i++; break;
			case "--reference": opts.reference = next!; i++; break;
			case "--instruction": opts.instruction = next!; i++; break;
			case "--cut": opts.cuts.push(next!); i++; break;
			case "--target-duration": opts.targetDuration = parseFloat(next!); i++; break;
			case "--width": opts.width = parseInt(next!, 10); i++; break;
			case "--height": opts.height = parseInt(next!, 10); i++; break;
			case "--music-volume": opts.musicVolume = parseFloat(next!); i++; break;
			case "--whisper-model": opts.whisperModel = next!; i++; break;
			case "--silence-threshold": opts.silenceThreshold = parseFloat(next!); i++; break;
			case "--no-captions": opts.noCaptions = true; break;
			case "--visual": opts.visualAnalysis = true; break;
			case "--ffmpeg": opts.ffmpegBin = next!; i++; break;
			case "--help":
			case "-h":
				printUsage();
				process.exit(0);
		}
	}

	if (!opts.raw) {
		console.error("ERROR: --raw <path> is required");
		printUsage();
		process.exit(1);
	}

	// Auto-enable visual analysis when instruction implies it
	if (opts.instruction && requiresVisualAnalysis(opts.instruction)) {
		opts.visualAnalysis = true;
	}

	return opts;
}

function printUsage() {
	console.log(`
ClipForge Local Export Pipeline

Usage:
  npx bun run scripts/run-local-export.ts --raw <video> [options]

Content Selection (pick one or combine):
  --instruction "<text>"    Natural language editing instruction
                            e.g. "remove boring parts"
                            e.g. "keep only the key points"
                            e.g. "cut out where I'm looking down"
  --cut "<start>-<end>"     Cut a specific time range (repeatable)
                            e.g. --cut "0:45-1:02" --cut "2:10-2:30"
  --reference <path>        Match content to a reference video
  --target-duration <secs>  Target output duration in seconds

Media:
  --raw <path>              Raw footage file (required)
  --music <path>            Background music file
  --output <path>           Output file path (default: output.mp4)
  --music-volume <0-1>      Music volume level (default: 0.12)

Output:
  --width <n>               Output width (default: 1080)
  --height <n>              Output height (default: 1920)
  --no-captions             Skip caption rendering
  --whisper-model <name>    Whisper model size (default: base)
  --silence-threshold <dB>  Silence detection threshold (default: -20)
  --ffmpeg <path>           Path to ffmpeg binary

Examples:
  # Any talking head → edited clip with captions
  npx bun run scripts/run-local-export.ts --raw vid.mov --output out.mp4

  # Remove boring parts using AI
  ... --instruction "remove boring parts and filler words"

  # Cut where I'm looking down (uses computer vision)
  ... --instruction "remove the parts where I'm looking down"

  # Cut specific time range
  ... --cut "0:45-1:02" --cut "2:10-2:30"

  # Match a reference edit
  ... --reference reference.mov
`);
}

// ── Media probing ──────────────────────────────────────────────

interface ProbeResult {
	durationS: number;
	width: number;
	height: number;
	rotation: number;
	displayWidth: number;
	displayHeight: number;
	colorSpace: string;
	colorTransfer: string;
	colorPrimaries: string;
	pixFmt: string;
}

function probeMedia(filePath: string, ffmpegBin: string): ProbeResult {
	const ffprobeBin = ffmpegBin.replace(/ffmpeg$/, "ffprobe");
	const raw = execSync(
		`${ffprobeBin} -v quiet -print_format json -show_format -show_streams "${filePath}"`,
		{ encoding: "utf-8" },
	);
	const data = JSON.parse(raw) as {
		streams: Array<{
			codec_type: string;
			width?: number;
			height?: number;
			side_data_list?: Array<{ rotation?: number }>;
			tags?: { rotate?: string };
			color_space?: string;
			color_transfer?: string;
			color_primaries?: string;
			pix_fmt?: string;
		}>;
		format: { duration: string };
	};
	const video = data.streams.find((s) => s.codec_type === "video");
	const width = Number(video?.width ?? 0);
	const height = Number(video?.height ?? 0);

	let rotation = 0;
	if (video?.side_data_list) {
		for (const sd of video.side_data_list) {
			if (sd.rotation !== undefined) rotation = Number(sd.rotation);
		}
	}
	if (rotation === 0 && video?.tags?.rotate) {
		rotation = Number(video.tags.rotate);
	}

	const isRotated = Math.abs(rotation) === 90 || Math.abs(rotation) === 270;

	return {
		durationS: Number(data.format.duration),
		width,
		height,
		rotation,
		displayWidth: isRotated ? height : width,
		displayHeight: isRotated ? width : height,
		colorSpace: video?.color_space ?? "",
		colorTransfer: video?.color_transfer ?? "",
		colorPrimaries: video?.color_primaries ?? "",
		pixFmt: video?.pix_fmt ?? "",
	};
}

/**
 * Returns true if the probed video stream is HDR content (HLG or PQ).
 * Used for informational logging.
 */
function isHdrInput(probe: ProbeResult): boolean {
	return (
		probe.colorPrimaries === "bt2020" ||
		probe.colorSpace === "bt2020nc" ||
		probe.colorSpace === "bt2020c" ||
		probe.colorTransfer === "arib-std-b67" || // HLG
		probe.colorTransfer === "smpte2084"        // PQ / HDR10
	);
}

// ── Main pipeline ──────────────────────────────────────────────

async function main() {
	const opts = parseArgs();
	const startTime = Date.now();

	console.log("╔══════════════════════════════════════╗");
	console.log("║  ClipForge Local Export Pipeline     ║");
	console.log("╚══════════════════════════════════════╝\n");

	if (opts.instruction) {
		console.log(`  Instruction: "${opts.instruction}"`);
	}
	if (opts.cuts.length > 0) {
		console.log(`  Cuts: ${opts.cuts.join(", ")}`);
	}

	// Verify inputs
	if (!existsSync(opts.raw)) {
		console.error(`ERROR: Raw footage not found: ${opts.raw}`);
		process.exit(1);
	}
	if (opts.music && !existsSync(opts.music)) {
		console.error(`ERROR: Music file not found: ${opts.music}`);
		process.exit(1);
	}
	if (opts.reference && !existsSync(opts.reference)) {
		console.error(`ERROR: Reference not found: ${opts.reference}`);
		process.exit(1);
	}

	mkdirSync(dirname(resolve(opts.output)), { recursive: true });

	// ── Step 1: Probe ──
	console.log("Step 1: Probing media...");
	const rawInfo = probeMedia(opts.raw, opts.ffmpegBin);
	console.log(`  Raw: ${rawInfo.displayWidth}x${rawInfo.displayHeight} ${rawInfo.durationS.toFixed(1)}s`);

	let refInfo: ProbeResult | null = null;
	if (opts.reference) {
		refInfo = probeMedia(opts.reference, opts.ffmpegBin);
		console.log(`  Ref: ${refInfo.displayWidth}x${refInfo.displayHeight} ${refInfo.durationS.toFixed(1)}s`);
	}

	// ── Step 2: Transcribe ──
	console.log("\nStep 2: Transcribing...");
	const rawTranscription = await runWhisperOnPath({
		filePath: opts.raw,
		model: opts.whisperModel,
		language: "en",
	});
	console.log(`  ${rawTranscription.words.length} words transcribed from raw footage`);

	// ── Step 3: Visual analysis (if needed) ──
	let visualCutRanges: Array<{ start_ms: number; end_ms: number }> = [];
	if (opts.visualAnalysis && opts.instruction && requiresVisualAnalysis(opts.instruction)) {
		console.log("\nStep 3a: Visual analysis...");
		const condition = extractVisualCondition(opts.instruction);
		console.log(`  Detecting: "${condition}"`);
		try {
			visualCutRanges = await analyzeVideoForVisualCondition(opts.raw, {
				condition,
				sampleIntervalS: 2,
				ffmpegBin: opts.ffmpegBin,
				minBadDurationMs: 3000, // Need 3+ consecutive seconds looking away to cut
			});
			console.log(`  Found ${visualCutRanges.length} visual cut ranges`);
		} catch (err) {
			console.warn(`  Visual analysis failed: ${err instanceof Error ? err.message : err}`);
			console.warn("  Continuing without visual cuts.");
		}
	}

	// ── Step 3: Plan cuts ──
	console.log("\nStep 3: Planning cuts...");
	let segments: CutSegment[];
	const totalMs = Math.round(rawInfo.durationS * 1000);

	// Determine if LLM is available (prefer Anthropic, fall back to OpenAI)
	const hasLLM = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);

	// Build the effective instruction:
	// - If user gave --instruction, use it
	// - If no reference and LLM is available, use smart default editorial instruction
	const effectiveInstruction =
		opts.instruction && !requiresVisualAnalysis(opts.instruction)
			? opts.instruction
			: !opts.reference && !opts.instruction && hasLLM
			? "Create an engaging short-form social media clip. Start with the strongest hook — the most surprising or bold statement. Cut all filler words, pauses, and repetitions. Keep only the most energetic, confident, and value-packed moments. End on the most memorable line."
			: null;

	if (effectiveInstruction) {
		// LLM-driven content selection from transcript
		if (opts.instruction) {
			console.log(`  Using LLM editorial: "${opts.instruction}"`);
		} else {
			console.log("  Using LLM smart editor (auto — no reference provided)");
		}
		// When no explicit target is given, over-select to compensate for
		// the visual quality filter that typically removes ~30-40% of segments.
		// Effective target = desired output / (1 - expected_filter_loss)
		const autoTargetS = opts.targetDuration
			? opts.targetDuration
			: opts.height >= 1500
			? 70  // portrait (TikTok/Reels): over-select; pause-split + visual filter reduce to ~35s
			: 65; // landscape: over-select; filters reduce to ~40s
		segments = await selectSegmentsWithLLM(
			rawTranscription.words,
			rawTranscription.segments,
			{
				instruction: effectiveInstruction,
				targetDurationS: autoTargetS,
				totalDurationS: rawInfo.durationS,
			},
		);
		console.log(`  ${segments.length} sub-segments after refinement:`);
		for (const s of segments) {
			console.log(`    src[${(s.src_start_ms/1000).toFixed(2)}s–${(s.src_end_ms/1000).toFixed(2)}s] → out[${(s.out_start_ms/1000).toFixed(2)}s] (${(s.duration_ms/1000).toFixed(2)}s)`);
		}

		// Automatic visual quality pass — filter out segments where subject looks bad
		console.log("  Running visual quality check on selected segments...");
		try {
			segments = await filterSegmentsByVisualQuality(opts.raw, segments, { ffmpegBin: opts.ffmpegBin });
			console.log(`  ${segments.length} segments after visual quality filter`);
		} catch (err) {
			console.warn(`  Visual quality check failed: ${err instanceof Error ? err.message : err} (skipping)`);
		}
	} else if (opts.instruction && requiresVisualAnalysis(opts.instruction) && visualCutRanges.length > 0) {
		// Visual-instruction: build kept ranges directly from the inverse of visual cuts
		// (keeps everything NOT flagged by vision, minimum 2s chunks)
		const MIN_KEPT_MS = 2000;
		const sortedCuts = [...visualCutRanges].sort((a, b) => a.start_ms - b.start_ms);
		const keptRanges: Array<{ start_ms: number; end_ms: number }> = [];
		let cursor = 0;

		for (const cut of sortedCuts) {
			if (cut.start_ms > cursor + MIN_KEPT_MS) {
				keptRanges.push({ start_ms: cursor, end_ms: cut.start_ms });
			}
			cursor = Math.max(cursor, cut.end_ms);
		}
		if (cursor < totalMs - MIN_KEPT_MS) {
			keptRanges.push({ start_ms: cursor, end_ms: totalMs });
		}

		let outCursor = 0;
		segments = keptRanges.map((r, i) => {
			const dur = r.end_ms - r.start_ms;
			const seg: CutSegment = {
				index: i,
				src_start_ms: r.start_ms,
				src_end_ms: r.end_ms,
				duration_ms: dur,
				out_start_ms: outCursor,
			};
			outCursor += dur;
			return seg;
		});
		console.log(`  Visual cuts → ${segments.length} kept segments`);
	} else if (opts.reference) {
		// Reference-matching
		const refTranscription = await runWhisperOnPath({
			filePath: opts.reference,
			model: opts.whisperModel,
			language: "en",
		});
		console.log(`  Reference: ${refTranscription.segments.length} segments`);
		segments = matchTranscriptCuts(rawTranscription.words, refTranscription.segments);
		console.log(`  Matched ${segments.length} segments`);
	} else {
		// Silence-based cutting (default)
		const silenceRegions = detectSilenceWithFfmpeg(opts.raw, {
			thresholdDb: opts.silenceThreshold,
			ffmpegBin: opts.ffmpegBin,
		});
		console.log(`  Found ${silenceRegions.length} silence regions`);
		segments = buildCutsFromSilence(totalMs, silenceRegions);
	}

	// Apply explicit --cut time ranges on top of any selection
	if (opts.cuts.length > 0) {
		console.log(`  Applying ${opts.cuts.length} explicit time cut(s): ${opts.cuts.join(", ")}`);
		segments = applyTimeCuts(segments, opts.cuts, totalMs);
		console.log(`  After cuts: ${segments.length} segments`);
	}

	const totalKeptMs = segments.reduce((s, seg) => s + seg.duration_ms, 0);
	console.log(`  Total kept: ${(totalKeptMs / 1000).toFixed(1)}s (from ${rawInfo.durationS.toFixed(1)}s)`);

	// ── Step 4: Build captions ──
	let captions: CaptionWord[] = [];
	if (!opts.noCaptions) {
		console.log("\nStep 4: Building captions...");
		const mapped = buildMappedCaptions(rawTranscription.words, segments);
		captions = mapped.map((c) => ({
			text: c.text,
			startS: c.start_ms / 1000,
			endS: c.end_ms / 1000,
		}));
		console.log(`  ${captions.length} caption words`);
	} else {
		console.log("\nStep 4: Skipping captions (--no-captions)");
	}

	// ── Step 5: Render via ffmpeg ──
	console.log("\nStep 5: Rendering...");
	const workDir = join(dirname(resolve(opts.output)), ".clipforge-render");
	mkdirSync(workDir, { recursive: true });

	if (isHdrInput(rawInfo)) {
		console.log(`  HDR input (${rawInfo.colorTransfer} / ${rawInfo.colorPrimaries}) — colorspace metadata will be preserved through pipeline`);
	}

	console.log(`  Extracting ${segments.length} segments...`);
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		const segPath = join(workDir, `seg_${String(i).padStart(3, "0")}.mp4`);

		execSync(
			`${opts.ffmpegBin} -y -ss ${seg.src_start_ms / 1000} -i "${opts.raw}" ` +
			`-t ${seg.duration_ms / 1000} -c:v libx264 -crf 18 -preset ultrafast ` +
			`-c:a aac -b:a 192k -avoid_negative_ts make_zero "${segPath}"`,
			{ stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 },
		);
	}
	console.log(`  ${segments.length} segments extracted`);

	const concatListPath = join(workDir, "concat.txt");
	const concatList = segments
		.map((_, i) => `file '${join(workDir, `seg_${String(i).padStart(3, "0")}.mp4`)}'`)
		.join("\n");
	writeFileSync(concatListPath, concatList + "\n");

	const concatPath = join(workDir, "concat.mp4");
	execSync(
		`${opts.ffmpegBin} -y -f concat -safe 0 -i "${concatListPath}" -c copy "${concatPath}"`,
		{ stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 },
	);
	console.log("  Segments concatenated");

	const basePath = join(workDir, "base.mp4");
	if (opts.music) {
		const filterComplex = [
			`[0:v]scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease,` +
			`pad=${opts.width}:${opts.height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[vout]`,
			`[1:a]volume=${opts.musicVolume}[musicvol]`,
			`[0:a][musicvol]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
		].join(";");

		execSync(
			`${opts.ffmpegBin} -y -i "${concatPath}" -i "${opts.music}" ` +
			`-filter_complex "${filterComplex}" -map "[vout]" -map "[aout]" ` +
			`-c:v libx264 -crf 18 -preset fast -r 30 ` +
			`-c:a aac -b:a 192k -movflags +faststart "${basePath}"`,
			{ stdio: ["pipe", "pipe", "pipe"], timeout: 300_000 },
		);
		console.log("  Video scaled + music mixed");
	} else {
		const filterComplex =
			`[0:v]scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease,` +
			`pad=${opts.width}:${opts.height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[vout]`;

		execSync(
			`${opts.ffmpegBin} -y -i "${concatPath}" ` +
			`-filter_complex "${filterComplex}" -map "[vout]" -map "0:a" ` +
			`-c:v libx264 -crf 18 -preset fast -r 30 ` +
			`-c:a aac -b:a 192k -movflags +faststart "${basePath}"`,
			{ stdio: ["pipe", "pipe", "pipe"], timeout: 300_000 },
		);
		console.log("  Video scaled (no music)");
	}

	// ── Step 6: Burn captions ──
	const outputPath = resolve(opts.output);
	if (captions.length > 0) {
		console.log("\nStep 6: Burning captions...");

		if (hasDrawtextFilter(opts.ffmpegBin)) {
			console.log("  Using drawtext filter");
			const dtFilter = buildDrawtextFilterChain(captions);
			execSync(
				`${opts.ffmpegBin} -y -i "${basePath}" ` +
				`-vf "${dtFilter}" -c:a copy -movflags +faststart "${outputPath}"`,
				{ stdio: ["pipe", "pipe", "pipe"], timeout: 300_000 },
			);
		} else if (hasSubtitlesFilter(opts.ffmpegBin)) {
			console.log("  Using ASS subtitles");
			const assPath = generateAssFile(captions, {
				width: opts.width,
				height: opts.height,
				workDir,
			});
			execSync(
				`${opts.ffmpegBin} -y -i "${basePath}" ` +
				`-vf "subtitles='${assPath}'" -c:a copy ` +
				`-movflags +faststart "${outputPath}"`,
				{ stdio: ["pipe", "pipe", "pipe"], timeout: 300_000 },
			);
		} else {
			console.log("  Using Python/Pillow fallback");
			const captionsJsonPath = join(workDir, "captions.json");
			writeFileSync(
				captionsJsonPath,
				JSON.stringify(captions.map((c) => ({
					text: c.text,
					start_s: c.startS,
					end_s: c.endS,
				}))),
			);
			burnCaptionsWithPillow(basePath, captionsJsonPath, outputPath);
		}
	} else {
		execSync(`cp "${basePath}" "${outputPath}"`);
	}

	execSync(`rm -rf "${workDir}"`);

	// ── Report ──
	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log(`\n╔══════════════════════════════════════╗`);
	console.log(`║  Pipeline complete in ${elapsed}s`);
	console.log(`╚══════════════════════════════════════╝`);

	if (existsSync(outputPath)) {
		const outInfo = probeMedia(outputPath, opts.ffmpegBin);
		console.log(`\nOutput: ${outInfo.displayWidth}x${outInfo.displayHeight} ${outInfo.durationS.toFixed(1)}s`);
		console.log(`File:   ${outputPath}`);

		if (refInfo) {
			const delta = Math.abs(outInfo.durationS - refInfo.durationS);
			console.log(`Ref:    ${refInfo.displayWidth}x${refInfo.displayHeight} ${refInfo.durationS.toFixed(1)}s`);
			console.log(`Delta:  ${delta.toFixed(1)}s ${delta < 3 ? "✓ PASS" : delta < 5 ? "~ CLOSE" : "✗ NEEDS TUNING"}`);
		}
	}
}

main().catch((e) => {
	console.error("Pipeline error:", e);
	process.exit(1);
});
