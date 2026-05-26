import type {
	GazeCategory,
	MediaGazeAnalysis,
	MediaGazeWindow,
} from "@/types/assets";

const GAZE_ANALYSIS_VERSION = 1 as const;
const SAMPLE_INTERVAL_SECONDS = 0.5;
const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 160;
const GAZE_WINDOW_SECONDS = 2;

// Camera-gaze thresholds.
// The camera threshold is intentionally conservative (high) so that ambiguous
// mid-range scores — e.g. slight head-tilt in a bright car interior — are
// treated as off-camera rather than camera.  Only clearly forward-facing
// frames with high symmetry + upper-brightness should qualify.
const CAMERA_GAZE_THRESHOLD = 0.76;
const OFF_CAMERA_GAZE_THRESHOLD = 0.38;
// Minimum mean brightness in the face region — below this we have no face
const NO_FACE_BRIGHTNESS_THRESHOLD = 0.08;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Compute a gaze score and confidence for a single video frame using
 * canvas pixel heuristics. No external ML dependencies — works in-browser.
 *
 * Heuristic strategy (talking-head videos):
 *  1. Face-region brightness: the face / eye area (upper-center of frame)
 *     should be the brightest region when the subject is on-camera.
 *  2. Bilateral symmetry: a face pointed at the camera is left-right
 *     symmetric; turning away breaks symmetry.
 *  3. Upper-vs-lower ratio: looking down moves the eye-line out of the
 *     upper region — the top band gets darker relative to the lower face.
 *
 * Returns gazeScore in [0, 1] (1 = fully on-camera) and a confidence
 * value that reflects how likely we are looking at a face at all.
 */
export function computeFrameGazeScore(
	frame: Uint8ClampedArray,
	width: number,
	height: number,
): { gazeScore: number; confidence: number } {
	// Face region: rows 15–65 %, cols 20–80 % — where a talking-head
	// face typically lives in a portrait or 16:9 frame.
	const faceRowStart = Math.floor(height * 0.15);
	const faceRowEnd = Math.floor(height * 0.65);
	const faceMidRow = Math.floor(height * 0.40);
	const faceColStart = Math.floor(width * 0.20);
	const faceColEnd = Math.floor(width * 0.80);
	const faceMidCol = Math.floor(width / 2);

	let faceSum = 0;
	let faceCount = 0;
	let leftSum = 0;
	let leftCount = 0;
	let rightSum = 0;
	let rightCount = 0;
	let upperSum = 0;
	let upperCount = 0;
	let lowerSum = 0;
	let lowerCount = 0;

	for (let row = faceRowStart; row < faceRowEnd; row++) {
		for (let col = faceColStart; col < faceColEnd; col++) {
			const baseIndex = (row * width + col) * 4;
			const r = frame[baseIndex] ?? 0;
			const g = frame[baseIndex + 1] ?? 0;
			const b = frame[baseIndex + 2] ?? 0;
			// Perceptual luminance
			const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;

			// Skip near-white background pixels (car ceilings, studio backdrops,
			// windows, etc.).  These saturated pixels corrupt the upper/lower
			// brightness ratio when they bleed into the face region — a bright
			// ceiling directly above the subject's head can keep `upperAvg` high
			// even when the person's head is tilted away from the camera.
			if (brightness > 0.88) continue;

			faceSum += brightness;
			faceCount += 1;

			if (col < faceMidCol) {
				leftSum += brightness;
				leftCount += 1;
			} else {
				rightSum += brightness;
				rightCount += 1;
			}

			if (row < faceMidRow) {
				upperSum += brightness;
				upperCount += 1;
			} else {
				lowerSum += brightness;
				lowerCount += 1;
			}
		}
	}

	const faceAvg = faceCount > 0 ? faceSum / faceCount : 0;

	// 1. Face presence: very dark upper-center → no face / back of head
	if (faceAvg < NO_FACE_BRIGHTNESS_THRESHOLD) {
		return { gazeScore: 0, confidence: 0.9 };
	}

	const leftAvg = leftCount > 0 ? leftSum / leftCount : 0;
	const rightAvg = rightCount > 0 ? rightSum / rightCount : 0;
	const upperAvg = upperCount > 0 ? upperSum / upperCount : 0;
	const lowerAvg = lowerCount > 0 ? lowerSum / lowerCount : 0;

	// 2. Bilateral symmetry score: 1 when perfectly symmetric, 0 when one
	//    side is dark (face turned away).
	const sideMax = Math.max(leftAvg, rightAvg, 1e-6);
	const symmetryScore = 1 - Math.abs(leftAvg - rightAvg) / sideMax;

	// 3. Upper / lower brightness ratio: looking down shifts the eye-line
	//    below the midpoint → upper region dims relative to lower region.
	const vertMax = Math.max(upperAvg, lowerAvg, 1e-6);
	const upperLowerRatio = upperAvg / vertMax; // ~1.0 when looking forward, <0.5 when looking down

	// 4. Face-region brightness (normalised): brighter → face facing camera.
	//    Cap at 0.33 expected avg → full score; this handles dim lighting.
	const brightnessScore = clamp(faceAvg / 0.33, 0, 1);

	// Weighted combination
	const gazeScore = clamp(
		0.35 * symmetryScore + 0.35 * upperLowerRatio + 0.30 * brightnessScore,
		0,
		1,
	);

	// Confidence: low when the face region is very dark (could be b-roll,
	// text on screen, etc.).  Also low when all three signals disagree.
	const signalVariance =
		((symmetryScore - gazeScore) ** 2 +
			(upperLowerRatio - gazeScore) ** 2 +
			(brightnessScore - gazeScore) ** 2) /
		3;
	const confidence = clamp(brightnessScore * (1 - signalVariance), 0.1, 0.95);

	return { gazeScore: Number(gazeScore.toFixed(4)), confidence: Number(confidence.toFixed(4)) };
}

function classifyGaze(gazeScore: number): GazeCategory {
	if (gazeScore >= CAMERA_GAZE_THRESHOLD) return "camera";
	if (gazeScore <= OFF_CAMERA_GAZE_THRESHOLD) return "off-camera";
	// Scores in the middle band are ambiguous — treat as off-camera since we
	// want the AI to be conservative and only cut when there's a clear signal.
	return "off-camera";
}

export function buildGazeWindowsFromSamples(
	samples: Array<{ time: number; gazeScore: number; confidence: number }>,
): MediaGazeWindow[] {
	if (samples.length === 0) return [];

	const windows: MediaGazeWindow[] = [];
	const samplesPerWindow = Math.max(
		1,
		Math.round(GAZE_WINDOW_SECONDS / SAMPLE_INTERVAL_SECONDS),
	);

	for (
		let startIndex = 0;
		startIndex < samples.length;
		startIndex += samplesPerWindow
	) {
		const slice = samples.slice(startIndex, startIndex + samplesPerWindow);
		if (slice.length === 0) continue;

		const avgGaze =
			slice.reduce((sum, s) => sum + s.gazeScore, 0) / slice.length;
		const avgConfidence =
			slice.reduce((sum, s) => sum + s.confidence, 0) / slice.length;

		const firstSample = slice[0];
		const lastSample = slice[slice.length - 1];
		if (!firstSample || !lastSample) continue;

		const startTime = firstSample.time;
		const endTime = lastSample.time + SAMPLE_INTERVAL_SECONDS;

		windows.push({
			startTime: Number(startTime.toFixed(3)),
			endTime: Number(endTime.toFixed(3)),
			gazeScore: Number(avgGaze.toFixed(4)),
			category: classifyGaze(avgGaze),
			confidence: Number(avgConfidence.toFixed(4)),
		});
	}

	return windows;
}

async function sampleGazeFramesFromVideo({
	file,
}: {
	file: File;
}): Promise<{ samples: Array<{ time: number; gazeScore: number; confidence: number }>; duration: number }> {
	if (typeof document === "undefined") {
		throw new Error("Gaze analysis requires a browser environment.");
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
		throw new Error("Gaze analysis could not allocate a canvas context.");
	}

	const objectUrl = URL.createObjectURL(file);
	video.src = objectUrl;

	const samples: Array<{ time: number; gazeScore: number; confidence: number }> = [];
	try {
		await new Promise<void>((resolve, reject) => {
			video.onloadedmetadata = () => resolve();
			video.onerror = () => reject(new Error("Unable to load video metadata for gaze analysis."));
		});

		const duration = Number.isFinite(video.duration) ? video.duration : 0;
		if (duration <= 0) {
			return { samples, duration: 0 };
		}

		for (let time = 0; time <= duration; time += SAMPLE_INTERVAL_SECONDS) {
			video.currentTime = clamp(time, 0, duration);
			await new Promise<void>((resolve) => {
				const handler = () => {
					video.removeEventListener("seeked", handler);
					resolve();
				};
				video.addEventListener("seeked", handler, { once: true });
			});

			// For portrait videos the face sits in the top ~40 % of the frame.
			// Squashing the full portrait height into 160 px moves the face into
			// rows 0–48, well above the face-region window (rows 24–104) and means
			// the lower region measures car interior / background instead of the
			// lower face. Fix: crop the top 55 % of a portrait frame so the face
			// fills the canvas at the right position for the heuristic.
			if (video.videoWidth < video.videoHeight) {
				const srcH = Math.floor(video.videoHeight * 0.55);
				context.drawImage(
					video,
					0, 0, video.videoWidth, srcH,
					0, 0, FRAME_WIDTH, FRAME_HEIGHT,
				);
			} else {
				context.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
			}
			const frame = context.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT).data;
			const { gazeScore, confidence } = computeFrameGazeScore(
				frame,
				FRAME_WIDTH,
				FRAME_HEIGHT,
			);
			samples.push({ time: Number(time.toFixed(3)), gazeScore, confidence });
		}

		return { samples, duration };
	} finally {
		URL.revokeObjectURL(objectUrl);
		video.src = "";
	}
}

export async function analyzeGazePatternsFromFile({
	file,
}: {
	file: File;
}): Promise<MediaGazeAnalysis> {
	try {
		const { samples } = await sampleGazeFramesFromVideo({ file });

		const windows = buildGazeWindowsFromSamples(samples);

		const cameraWindows = windows.filter((w) => w.category === "camera");
		const totalDuration = windows.reduce((sum, w) => sum + (w.endTime - w.startTime), 0);
		const cameraDuration = cameraWindows.reduce(
			(sum, w) => sum + (w.endTime - w.startTime),
			0,
		);
		const cameraLookRatio =
			totalDuration > 0 ? cameraDuration / totalDuration : 0;

		const avgGazeScore =
			samples.length > 0
				? samples.reduce((sum, s) => sum + s.gazeScore, 0) / samples.length
				: 0;

		return {
			windows,
			cameraLookRatio: Number(cameraLookRatio.toFixed(4)),
			avgGazeScore: Number(avgGazeScore.toFixed(4)),
			samplingIntervalMs: Math.round(SAMPLE_INTERVAL_SECONDS * 1000),
			analyzedAt: new Date().toISOString(),
			version: GAZE_ANALYSIS_VERSION,
		};
	} catch {
		return {
			windows: [],
			cameraLookRatio: 0,
			avgGazeScore: 0,
			samplingIntervalMs: Math.round(SAMPLE_INTERVAL_SECONDS * 1000),
			analyzedAt: new Date().toISOString(),
			version: GAZE_ANALYSIS_VERSION,
		};
	}
}

/**
 * Find the first off-camera window that starts at or after `afterSeconds`.
 * Used by the heuristic planner to resolve "cut where I'm looking down after
 * I say X" requests.
 */
export function findFirstOffCameraWindowAfter({
	gazeAnalysis,
	afterSeconds,
	minConfidence = 0.4,
}: {
	gazeAnalysis: MediaGazeAnalysis;
	afterSeconds: number;
	minConfidence?: number;
}): MediaGazeWindow | null {
	for (const window of gazeAnalysis.windows) {
		if (
			window.startTime >= afterSeconds &&
			window.category === "off-camera" &&
			window.confidence >= minConfidence
		) {
			return window;
		}
	}
	return null;
}

/**
 * Find consecutive off-camera windows starting at or after `afterSeconds`.
 * Returns the merged span [startTime, endTime] if consecutive windows are
 * found, or null otherwise.
 */
export function findOffCameraSpanAfter({
	gazeAnalysis,
	afterSeconds,
	minConfidence = 0.4,
}: {
	gazeAnalysis: MediaGazeAnalysis;
	afterSeconds: number;
	minConfidence?: number;
}): { startTime: number; endTime: number } | null {
	const firstWindow = findFirstOffCameraWindowAfter({
		gazeAnalysis,
		afterSeconds,
		minConfidence,
	});
	if (!firstWindow) return null;

	let endTime = firstWindow.endTime;

	// Extend the span through consecutive off-camera windows
	for (const window of gazeAnalysis.windows) {
		if (
			window.startTime >= firstWindow.endTime &&
			window.startTime <= endTime + SAMPLE_INTERVAL_SECONDS * 2 &&
			window.category === "off-camera" &&
			window.confidence >= minConfidence
		) {
			endTime = window.endTime;
		}
	}

	return { startTime: firstWindow.startTime, endTime };
}
