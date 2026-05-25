/**
 * FFmpeg-based silence detection.
 *
 * Uses ffmpeg's silencedetect audio filter to find silent regions in media
 * files. Works in Node.js/CLI context (does not require Web Audio API or
 * decoded PCM samples like the browser-side silence detection).
 */
import { execSync } from "node:child_process";

export interface SilenceRegion {
	/** Start of silence in milliseconds */
	start_ms: number;
	/** End of silence in milliseconds */
	end_ms: number;
	/** Duration of silence in milliseconds */
	duration_ms: number;
}

export interface DetectSilenceOptions {
	/** Audio level threshold for silence (dB, negative). Default: -20 */
	thresholdDb?: number;
	/** Minimum silence duration in seconds. Default: 0.3 */
	minDurationS?: number;
	/** Path to ffmpeg binary. Default: "ffmpeg" */
	ffmpegBin?: string;
}

/**
 * Detect silent regions in a media file using ffmpeg's silencedetect filter.
 */
export function detectSilenceWithFfmpeg(
	filePath: string,
	options: DetectSilenceOptions = {},
): SilenceRegion[] {
	const {
		thresholdDb = -20,
		minDurationS = 0.3,
		ffmpegBin = process.env.CLIPFORGE_FFMPEG_BIN || "ffmpeg",
	} = options;

	const cmd = [
		ffmpegBin,
		"-i",
		`"${filePath}"`,
		"-af",
		`silencedetect=noise=${thresholdDb}dB:d=${minDurationS}`,
		"-f",
		"null",
		"-",
		"2>&1",
	].join(" ");

	let output: string;
	try {
		output = execSync(cmd, { encoding: "utf-8", timeout: 300_000 });
	} catch (e: unknown) {
		const err = e as { stdout?: string; stderr?: string };
		output = err.stdout ?? err.stderr ?? "";
	}

	return parseSilenceOutput(output);
}

/**
 * Parse ffmpeg silencedetect output for silence_start / silence_end markers.
 */
export function parseSilenceOutput(output: string): SilenceRegion[] {
	const regions: SilenceRegion[] = [];
	const lines = output.split("\n");
	let currentStart: number | null = null;

	for (const line of lines) {
		const startMatch = line.match(/silence_start:\s*([\d.]+)/);
		if (startMatch) {
			currentStart = parseFloat(startMatch[1]);
			continue;
		}

		const endMatch = line.match(
			/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/,
		);
		if (endMatch && currentStart !== null) {
			const endS = parseFloat(endMatch[1]);
			const durationS = parseFloat(endMatch[2]);
			regions.push({
				start_ms: Math.round(currentStart * 1000),
				end_ms: Math.round(endS * 1000),
				duration_ms: Math.round(durationS * 1000),
			});
			currentStart = null;
		}
	}

	return regions;
}

/**
 * Detect audio volume levels in a media file.
 * Returns mean and max volume in dB.
 */
export function detectVolumeLevel(
	filePath: string,
	ffmpegBin?: string,
): { meanDb: number; maxDb: number } {
	const bin = ffmpegBin ?? process.env.CLIPFORGE_FFMPEG_BIN ?? "ffmpeg";
	const cmd = `${bin} -i "${filePath}" -af "volumedetect" -f null - 2>&1`;

	let output: string;
	try {
		output = execSync(cmd, { encoding: "utf-8", timeout: 120_000 });
	} catch (e: unknown) {
		const err = e as { stdout?: string; stderr?: string };
		output = err.stdout ?? err.stderr ?? "";
	}

	const meanMatch = output.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
	const maxMatch = output.match(/max_volume:\s*(-?[\d.]+)\s*dB/);

	return {
		meanDb: meanMatch ? parseFloat(meanMatch[1]) : -Infinity,
		maxDb: maxMatch ? parseFloat(maxMatch[1]) : -Infinity,
	};
}
