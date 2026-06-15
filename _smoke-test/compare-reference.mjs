/**
 * Compare a ClipForge export against the edited reference video.
 *
 * Usage:
 *   node _smoke-test/compare-reference.mjs [output.mp4] [reference.mov]
 *
 * Writes _smoke-test/reference-comparison.json.
 */
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(process.argv[2] ?? join(__dir, "OUTPUT.mp4"));
const REFERENCE_PATH = resolve(
	process.argv[3] ?? join(__dir, "FINISHED-reference.mov"),
);
const reportName = `reference-comparison-${basename(OUTPUT_PATH).replace(
	/[^a-z0-9]+/gi,
	"-",
)}.json`;
const REPORT_PATH = resolve(
	process.env.CLIPFORGE_COMPARISON_REPORT ?? join(__dir, reportName),
);

const FFPROBE = process.env.FFPROBE_BIN ?? "/opt/homebrew/bin/ffprobe";
const FFMPEG = process.env.FFMPEG_BIN ?? "/opt/homebrew/bin/ffmpeg";
const SAMPLE_FRAMES = 16;
const FRAME_SIDE = 32;
const AUDIO_SAMPLE_RATE = 8000;
const AUDIO_WINDOWS = 96;

function run(command, args, options = {}) {
	return execFileSync(command, args, {
		encoding: options.encoding,
		input: options.input,
		maxBuffer: options.maxBuffer ?? 256 * 1024 * 1024,
		stdio: options.stdio ?? ["pipe", "pipe", "pipe"],
		timeout: options.timeout ?? 120_000,
	});
}

function assertFile(path, label) {
	if (!existsSync(path)) {
		throw new Error(`${label} not found: ${path}`);
	}
}

function probe(path) {
	const raw = run(
		FFPROBE,
		[
			"-v",
			"quiet",
			"-print_format",
			"json",
			"-show_format",
			"-show_streams",
			path,
		],
		{ encoding: "utf8" },
	);
	const data = JSON.parse(raw);
	const video = data.streams.find((stream) => stream.codec_type === "video");
	const audio = data.streams.find((stream) => stream.codec_type === "audio");
	if (!video) throw new Error(`No video stream found in ${path}`);
	const rotation =
		Number(video.tags?.rotate ?? 0) ||
		Number(video.side_data_list?.find((entry) => entry.rotation)?.rotation ?? 0);
	const rotated = Math.abs(rotation) === 90 || Math.abs(rotation) === 270;
	const width = Number(video.width);
	const height = Number(video.height);
	return {
		path,
		name: basename(path),
		duration_s: Number(data.format.duration),
		width,
		height,
		display_width: rotated ? height : width,
		display_height: rotated ? width : height,
		rotation,
		video_codec: video.codec_name,
		audio_codec: audio?.codec_name ?? null,
	};
}

function sampleFrameHashes(path, durationS) {
	const fps = Math.max(0.01, SAMPLE_FRAMES / Math.max(durationS, 1));
	const raw = run(
		FFMPEG,
		[
			"-v",
			"error",
			"-i",
			path,
			"-vf",
			`fps=${fps},scale=${FRAME_SIDE}:${FRAME_SIDE},format=gray`,
			"-frames:v",
			String(SAMPLE_FRAMES),
			"-f",
			"rawvideo",
			"pipe:1",
		],
		{ encoding: "buffer", timeout: 180_000 },
	);
	const frameSize = FRAME_SIDE * FRAME_SIDE;
	const hashes = [];
	for (let offset = 0; offset + frameSize <= raw.length; offset += frameSize) {
		const frame = raw.subarray(offset, offset + frameSize);
		let sum = 0;
		for (const value of frame) sum += value;
		const avg = sum / frame.length;
		let bits = "";
		for (const value of frame) bits += value >= avg ? "1" : "0";
		hashes.push(bits);
	}
	return hashes;
}

function hashSimilarity(left, right) {
	const count = Math.min(left.length, right.length);
	if (count === 0) return 0;
	let total = 0;
	for (let i = 0; i < count; i++) {
		const a = left[i];
		const b = right[i];
		let same = 0;
		const len = Math.min(a.length, b.length);
		for (let j = 0; j < len; j++) {
			if (a[j] === b[j]) same += 1;
		}
		total += same / len;
	}
	return total / count;
}

function decodeAudioVector(path, durationS) {
	const maxDuration = Math.max(1, Math.min(durationS, 180));
	const raw = run(
		FFMPEG,
		[
			"-v",
			"error",
			"-i",
			path,
			"-t",
			String(maxDuration),
			"-vn",
			"-ac",
			"1",
			"-ar",
			String(AUDIO_SAMPLE_RATE),
			"-f",
			"f32le",
			"pipe:1",
		],
		{ encoding: "buffer", timeout: 180_000 },
	);
	const values = new Float32Array(
		raw.buffer,
		raw.byteOffset,
		Math.floor(raw.byteLength / Float32Array.BYTES_PER_ELEMENT),
	);
	const windowSize = Math.max(1, Math.floor(values.length / AUDIO_WINDOWS));
	const rms = [];
	for (let i = 0; i < AUDIO_WINDOWS; i++) {
		const start = i * windowSize;
		const end = Math.min(values.length, start + windowSize);
		if (end <= start) {
			rms.push(0);
			continue;
		}
		let sum = 0;
		for (let j = start; j < end; j++) sum += values[j] * values[j];
		rms.push(Math.sqrt(sum / (end - start)));
	}
	return rms;
}

function correlation(left, right) {
	const n = Math.min(left.length, right.length);
	if (n === 0) return 0;
	const meanLeft = left.slice(0, n).reduce((sum, value) => sum + value, 0) / n;
	const meanRight =
		right.slice(0, n).reduce((sum, value) => sum + value, 0) / n;
	let numerator = 0;
	let denomLeft = 0;
	let denomRight = 0;
	for (let i = 0; i < n; i++) {
		const a = left[i] - meanLeft;
		const b = right[i] - meanRight;
		numerator += a * b;
		denomLeft += a * a;
		denomRight += b * b;
	}
	const denom = Math.sqrt(denomLeft * denomRight);
	return denom === 0 ? 0 : numerator / denom;
}

function maxLagCorrelation(left, right, maxLagWindows) {
	let best = Number.NEGATIVE_INFINITY;
	for (let lag = -maxLagWindows; lag <= maxLagWindows; lag++) {
		const shiftedLeft = [];
		const shiftedRight = [];
		for (let i = 0; i < left.length; i++) {
			const j = i + lag;
			if (j < 0 || j >= right.length) continue;
			shiftedLeft.push(left[i]);
			shiftedRight.push(right[j]);
		}
		if (shiftedLeft.length < Math.max(8, left.length * 0.6)) continue;
		best = Math.max(best, correlation(shiftedLeft, shiftedRight));
	}
	return Number.isFinite(best) ? best : 0;
}

function verdict(checks) {
	if (checks.every((check) => check.pass)) return "PASS";
	if (checks.filter((check) => check.pass).length >= checks.length - 1) {
		return "CLOSE";
	}
	return "NEEDS_TUNING";
}

function main() {
	assertFile(OUTPUT_PATH, "Output");
	assertFile(REFERENCE_PATH, "Reference");
	const tempDir = mkdtempSync(join(tmpdir(), "clipforge-compare-"));
	try {
		const output = probe(OUTPUT_PATH);
		const reference = probe(REFERENCE_PATH);
		const durationDeltaS = Math.abs(output.duration_s - reference.duration_s);
		const aspectDelta = Math.abs(
			output.display_width / output.display_height -
				reference.display_width / reference.display_height,
		);
		const outputHashes = sampleFrameHashes(OUTPUT_PATH, output.duration_s);
		const referenceHashes = sampleFrameHashes(
			REFERENCE_PATH,
			reference.duration_s,
		);
		const imageHashSimilarity = hashSimilarity(outputHashes, referenceHashes);
		const outputAudio = decodeAudioVector(OUTPUT_PATH, output.duration_s);
		const referenceAudio = decodeAudioVector(REFERENCE_PATH, reference.duration_s);
		const audioCorrelation = correlation(outputAudio, referenceAudio);
		const audioMaxLagCorrelation = maxLagCorrelation(
			outputAudio,
			referenceAudio,
			8,
		);
		const checks = [
			{
				name: "duration_delta_s <= 3",
				pass: durationDeltaS <= 3,
				value: Number(durationDeltaS.toFixed(3)),
			},
			{
				name: "portrait/aspect matches",
				pass: aspectDelta <= 0.03,
				value: Number(aspectDelta.toFixed(4)),
			},
			{
				name: "frame_hash_similarity >= 0.58",
				pass: imageHashSimilarity >= 0.58,
				value: Number(imageHashSimilarity.toFixed(4)),
			},
			{
				name: "audio_rms_max_lag_correlation >= 0.30",
				pass: audioMaxLagCorrelation >= 0.3,
				value: Number(audioMaxLagCorrelation.toFixed(4)),
			},
		];
		const report = {
			generatedAt: new Date().toISOString(),
			output,
			reference,
			metrics: {
				duration_delta_s: Number(durationDeltaS.toFixed(3)),
				aspect_delta: Number(aspectDelta.toFixed(4)),
				frame_hash_similarity: Number(imageHashSimilarity.toFixed(4)),
				audio_rms_correlation: Number(audioCorrelation.toFixed(4)),
				audio_rms_max_lag_correlation: Number(
					audioMaxLagCorrelation.toFixed(4),
				),
				sampled_frames: Math.min(outputHashes.length, referenceHashes.length),
			},
			checks,
			verdict: verdict(checks),
		};
		writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
		console.log(`ClipForge reference comparison: ${report.verdict}`);
		console.log(
			`  output:    ${output.name} ${output.display_width}x${output.display_height} ${output.duration_s.toFixed(2)}s`,
		);
		console.log(
			`  reference: ${reference.name} ${reference.display_width}x${reference.display_height} ${reference.duration_s.toFixed(2)}s`,
		);
		for (const check of checks) {
			console.log(
				`  ${check.pass ? "PASS" : "FAIL"} ${check.name}: ${check.value}`,
			);
		}
		console.log(`  report: ${REPORT_PATH}`);
		process.exit(report.verdict === "NEEDS_TUNING" ? 1 : 0);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

main();
