import type { MediaVisualActivityWindow, MediaVisualAnalysis } from "@/types/assets";

const VISUAL_ANALYSIS_VERSION = 1 as const;
const SAMPLE_INTERVAL_SECONDS = 0.25;
const FRAME_WIDTH = 48;
const FRAME_HEIGHT = 48;
const ACTIVITY_WINDOW_SECONDS = 1;
const ACTIVITY_THRESHOLD_RATIO = 0.45;
const SCENE_CUT_THRESHOLD_RATIO = 0.72;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function normalizeFrameDeltas({
	frameDeltas,
}: {
	frameDeltas: number[];
}): number[] {
	if (frameDeltas.length === 0) return [];
	const maxDelta = Math.max(...frameDeltas, 1e-6);
	return frameDeltas.map((delta) => Number((delta / maxDelta).toFixed(4)));
}

export function detectSceneCutsFromFrameDeltas({
	frameDeltas,
	sampleIntervalSeconds,
}: {
	frameDeltas: number[];
	sampleIntervalSeconds?: number;
}): number[] {
	const interval = sampleIntervalSeconds ?? SAMPLE_INTERVAL_SECONDS;
	const normalized = normalizeFrameDeltas({ frameDeltas });
	const cuts: number[] = [];

	for (let index = 0; index < normalized.length; index += 1) {
		const delta = normalized[index] ?? 0;
		if (delta < SCENE_CUT_THRESHOLD_RATIO) continue;
		const time = Number(((index + 1) * interval).toFixed(3));
		cuts.push(time);
	}

	return cuts;
}

export function buildActivityWindowsFromFrameDeltas({
	frameDeltas,
	sampleIntervalSeconds,
}: {
	frameDeltas: number[];
	sampleIntervalSeconds?: number;
}): MediaVisualActivityWindow[] {
	const interval = sampleIntervalSeconds ?? SAMPLE_INTERVAL_SECONDS;
	const normalized = normalizeFrameDeltas({ frameDeltas });
	if (normalized.length === 0) return [];

	const windows: MediaVisualActivityWindow[] = [];
	const samplesPerWindow = Math.max(1, Math.round(ACTIVITY_WINDOW_SECONDS / interval));

	for (let startIndex = 0; startIndex < normalized.length; startIndex += samplesPerWindow) {
		const slice = normalized.slice(startIndex, startIndex + samplesPerWindow);
		if (slice.length === 0) continue;
		const average =
			slice.reduce((sum, value) => sum + value, 0) / Math.max(1, slice.length);
		if (average < ACTIVITY_THRESHOLD_RATIO) continue;
		const startTime = Number((startIndex * interval).toFixed(3));
		const endTime = Number(((startIndex + slice.length) * interval).toFixed(3));
		windows.push({
			startTime,
			endTime,
			score: Number(average.toFixed(4)),
		});
	}

	return windows;
}

async function extractFrameDeltasFromVideo({
	file,
}: {
	file: File;
}): Promise<{ frameDeltas: number[]; duration: number }> {
	if (typeof document === "undefined") {
		throw new Error("Visual analysis requires a browser environment.");
	}

	const video = document.createElement("video");
	video.preload = "metadata";
	video.muted = true;
	video.playsInline = true;
	video.crossOrigin = "anonymous";
	const canvas = document.createElement("canvas");
	canvas.width = FRAME_WIDTH;
	canvas.height = FRAME_HEIGHT;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) {
		throw new Error("Visual analysis could not allocate a canvas context.");
	}

	const objectUrl = URL.createObjectURL(file);
	video.src = objectUrl;

	const frameDeltas: number[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			video.onloadedmetadata = () => resolve();
			video.onerror = () => reject(new Error("Unable to load video metadata."));
		});

		const duration = Number.isFinite(video.duration) ? video.duration : 0;
		if (duration <= 0) {
			return { frameDeltas, duration: 0 };
		}

		let previousFrame: Uint8ClampedArray | null = null;
		for (let time = 0; time <= duration; time += SAMPLE_INTERVAL_SECONDS) {
			video.currentTime = clamp(time, 0, duration);
			await new Promise<void>((resolve) => {
				const handler = () => {
					video.removeEventListener("seeked", handler);
					resolve();
				};
				video.addEventListener("seeked", handler, { once: true });
			});
			context.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
			const frame = context.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT).data;
			if (previousFrame) {
				let totalDelta = 0;
				for (let index = 0; index < frame.length; index += 4) {
					totalDelta += Math.abs(frame[index] - (previousFrame[index] ?? 0));
					totalDelta += Math.abs(frame[index + 1] - (previousFrame[index + 1] ?? 0));
					totalDelta += Math.abs(frame[index + 2] - (previousFrame[index + 2] ?? 0));
				}
				frameDeltas.push(totalDelta / (FRAME_WIDTH * FRAME_HEIGHT * 3 * 255));
			}
			previousFrame = new Uint8ClampedArray(frame);
		}

		return { frameDeltas, duration };
	} finally {
		URL.revokeObjectURL(objectUrl);
		video.src = "";
	}
}

export async function analyzeVisualActivityFromFile({
	file,
}: {
	file: File;
}): Promise<MediaVisualAnalysis> {
	try {
		const { frameDeltas } = await extractFrameDeltasFromVideo({ file });
		return {
			sceneCuts: detectSceneCutsFromFrameDeltas({ frameDeltas }),
			activityWindows: buildActivityWindowsFromFrameDeltas({ frameDeltas }),
			analyzedAt: new Date().toISOString(),
			version: VISUAL_ANALYSIS_VERSION,
		};
	} catch {
		return {
			sceneCuts: [],
			activityWindows: [],
			analyzedAt: new Date().toISOString(),
			version: VISUAL_ANALYSIS_VERSION,
		};
	}
}
