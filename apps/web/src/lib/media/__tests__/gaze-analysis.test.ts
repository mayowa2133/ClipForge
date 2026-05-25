import { describe, expect, test } from "bun:test";
import {
	buildGazeWindowsFromSamples,
	computeFrameGazeScore,
	findFirstOffCameraWindowAfter,
	findOffCameraSpanAfter,
} from "@/lib/media/gaze-analysis";
import type { MediaGazeAnalysis } from "@/types/assets";

// ---------------------------------------------------------------------------
// Pixel frame helpers
// ---------------------------------------------------------------------------

/**
 * Build a synthetic RGBA frame of (width × height) pixels.
 * Each pixel's RGB values are taken from `colorFn(row, col)`.
 */
function buildFrame(
	width: number,
	height: number,
	colorFn: (row: number, col: number) => [number, number, number],
): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let row = 0; row < height; row++) {
		for (let col = 0; col < width; col++) {
			const [r, g, b] = colorFn(row, col);
			const base = (row * width + col) * 4;
			data[base] = r;
			data[base + 1] = g;
			data[base + 2] = b;
			data[base + 3] = 255;
		}
	}
	return data;
}

/** Uniform bright frame — simulates a well-lit face looking at camera. */
function brightSymmetricFrame(width = 160, height = 160): Uint8ClampedArray {
	return buildFrame(width, height, () => [200, 170, 150]);
}

/**
 * Asymmetric frame: left half dark, right half bright.
 * Simulates face turned hard to one side.
 */
function asymmetricFrame(width = 160, height = 160): Uint8ClampedArray {
	return buildFrame(width, height, (_row, col) =>
		col < width / 2 ? [30, 25, 20] : [200, 170, 150],
	);
}

/**
 * Looking-down frame: upper 40 % rows very dark (forehead/hair visible),
 * lower rows bright (chin/neck closer to camera).
 */
function lookingDownFrame(width = 160, height = 160): Uint8ClampedArray {
	const upperEnd = Math.floor(height * 0.4);
	return buildFrame(width, height, (row) =>
		row < upperEnd ? [20, 18, 15] : [190, 160, 140],
	);
}

/** All-black frame — no face present. */
function blackFrame(width = 160, height = 160): Uint8ClampedArray {
	return buildFrame(width, height, () => [0, 0, 0]);
}

// ---------------------------------------------------------------------------
// computeFrameGazeScore
// ---------------------------------------------------------------------------

describe("computeFrameGazeScore", () => {
	test("bright symmetric frame scores high (on-camera)", () => {
		const { gazeScore, confidence } = computeFrameGazeScore(
			brightSymmetricFrame(),
			160,
			160,
		);
		expect(gazeScore).toBeGreaterThan(0.55);
		expect(confidence).toBeGreaterThan(0.4);
	});

	test("hard asymmetric frame scores lower than symmetric", () => {
		const symmetric = computeFrameGazeScore(brightSymmetricFrame(), 160, 160);
		const asymmetric = computeFrameGazeScore(asymmetricFrame(), 160, 160);
		expect(asymmetric.gazeScore).toBeLessThan(symmetric.gazeScore);
	});

	test("looking-down frame scores lower than symmetric", () => {
		const symmetric = computeFrameGazeScore(brightSymmetricFrame(), 160, 160);
		const lookingDown = computeFrameGazeScore(lookingDownFrame(), 160, 160);
		expect(lookingDown.gazeScore).toBeLessThan(symmetric.gazeScore);
	});

	test("black frame returns gazeScore 0 and high confidence (no-face path)", () => {
		const { gazeScore, confidence } = computeFrameGazeScore(
			blackFrame(),
			160,
			160,
		);
		expect(gazeScore).toBe(0);
		expect(confidence).toBeGreaterThan(0.5);
	});

	test("scores are clamped in [0, 1]", () => {
		for (const frame of [
			brightSymmetricFrame(),
			asymmetricFrame(),
			lookingDownFrame(),
			blackFrame(),
		]) {
			const { gazeScore, confidence } = computeFrameGazeScore(frame, 160, 160);
			expect(gazeScore).toBeGreaterThanOrEqual(0);
			expect(gazeScore).toBeLessThanOrEqual(1);
			expect(confidence).toBeGreaterThanOrEqual(0);
			expect(confidence).toBeLessThanOrEqual(1);
		}
	});

	test("symmetric scores both sides equally", () => {
		// Mirror frame: same left and right — symmetry should be 1.0
		const frame = buildFrame(160, 160, (_row, col) => {
			const mirror = Math.abs(col - 80);
			const brightness = 80 + mirror; // same value each side
			return [brightness, brightness - 10, brightness - 20];
		});
		const { gazeScore } = computeFrameGazeScore(frame, 160, 160);
		// Symmetric → should not be penalised by symmetry score
		expect(gazeScore).toBeGreaterThan(0.3);
	});
});

// ---------------------------------------------------------------------------
// buildGazeWindowsFromSamples
// ---------------------------------------------------------------------------

describe("buildGazeWindowsFromSamples", () => {
	test("returns empty array for empty samples", () => {
		expect(buildGazeWindowsFromSamples([])).toEqual([]);
	});

	test("groups samples into 2-second windows", () => {
		// 0.5s interval → 4 samples per 2s window
		const samples = Array.from({ length: 12 }, (_, i) => ({
			time: i * 0.5,
			gazeScore: 0.8,
			confidence: 0.7,
		}));
		const windows = buildGazeWindowsFromSamples(samples);
		// 12 samples / 4 per window = 3 windows
		expect(windows.length).toBe(3);
	});

	test("classifies high-score window as camera", () => {
		const samples = Array.from({ length: 4 }, (_, i) => ({
			time: i * 0.5,
			gazeScore: 0.85,
			confidence: 0.8,
		}));
		const [window] = buildGazeWindowsFromSamples(samples);
		expect(window?.category).toBe("camera");
	});

	test("classifies low-score window as off-camera", () => {
		const samples = Array.from({ length: 4 }, (_, i) => ({
			time: i * 0.5,
			gazeScore: 0.2,
			confidence: 0.7,
		}));
		const [window] = buildGazeWindowsFromSamples(samples);
		expect(window?.category).toBe("off-camera");
	});

	test("window startTime and endTime are numerically consistent", () => {
		const samples = Array.from({ length: 4 }, (_, i) => ({
			time: i * 0.5,
			gazeScore: 0.75,
			confidence: 0.6,
		}));
		const [window] = buildGazeWindowsFromSamples(samples);
		expect(window).toBeDefined();
		expect(window!.endTime).toBeGreaterThan(window!.startTime);
	});

	test("preserves confidence average across window", () => {
		const samples = [
			{ time: 0, gazeScore: 0.8, confidence: 0.9 },
			{ time: 0.5, gazeScore: 0.8, confidence: 0.7 },
			{ time: 1.0, gazeScore: 0.8, confidence: 0.5 },
			{ time: 1.5, gazeScore: 0.8, confidence: 0.3 },
		];
		const [window] = buildGazeWindowsFromSamples(samples);
		// avg confidence = (0.9+0.7+0.5+0.3)/4 = 0.6
		expect(window?.confidence).toBeCloseTo(0.6, 2);
	});
});

// ---------------------------------------------------------------------------
// findFirstOffCameraWindowAfter
// ---------------------------------------------------------------------------

describe("findFirstOffCameraWindowAfter", () => {
	const analysis: MediaGazeAnalysis = {
		windows: [
			{ startTime: 0, endTime: 2, gazeScore: 0.9, category: "camera", confidence: 0.8 },
			{ startTime: 2, endTime: 4, gazeScore: 0.2, category: "off-camera", confidence: 0.75 },
			{ startTime: 4, endTime: 6, gazeScore: 0.15, category: "off-camera", confidence: 0.7 },
			{ startTime: 6, endTime: 8, gazeScore: 0.85, category: "camera", confidence: 0.9 },
		],
		cameraLookRatio: 0.5,
		avgGazeScore: 0.5,
		samplingIntervalMs: 500,
		analyzedAt: null,
		version: 1,
	};

	test("finds first off-camera window after timestamp", () => {
		const result = findFirstOffCameraWindowAfter({ gazeAnalysis: analysis, afterSeconds: 1 });
		expect(result?.startTime).toBe(2);
	});

	test("returns null when all off-camera windows are before timestamp", () => {
		const result = findFirstOffCameraWindowAfter({ gazeAnalysis: analysis, afterSeconds: 5 });
		expect(result).toBeNull();
	});

	test("respects minConfidence filter", () => {
		const lowConfAnalysis: MediaGazeAnalysis = {
			...analysis,
			windows: [
				{ startTime: 1, endTime: 3, gazeScore: 0.1, category: "off-camera", confidence: 0.2 },
			],
		};
		const result = findFirstOffCameraWindowAfter({
			gazeAnalysis: lowConfAnalysis,
			afterSeconds: 0,
			minConfidence: 0.4,
		});
		expect(result).toBeNull();
	});

	test("camera window after timestamp is skipped", () => {
		// Only a camera window exists after afterSeconds
		const result = findFirstOffCameraWindowAfter({ gazeAnalysis: analysis, afterSeconds: 6 });
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// findOffCameraSpanAfter
// ---------------------------------------------------------------------------

describe("findOffCameraSpanAfter", () => {
	const analysis: MediaGazeAnalysis = {
		windows: [
			{ startTime: 0, endTime: 2, gazeScore: 0.9, category: "camera", confidence: 0.8 },
			{ startTime: 2, endTime: 4, gazeScore: 0.2, category: "off-camera", confidence: 0.75 },
			{ startTime: 4, endTime: 6, gazeScore: 0.15, category: "off-camera", confidence: 0.7 },
			{ startTime: 6, endTime: 8, gazeScore: 0.85, category: "camera", confidence: 0.9 },
		],
		cameraLookRatio: 0.5,
		avgGazeScore: 0.5,
		samplingIntervalMs: 500,
		analyzedAt: null,
		version: 1,
	};

	test("merges consecutive off-camera windows into one span", () => {
		const span = findOffCameraSpanAfter({ gazeAnalysis: analysis, afterSeconds: 1 });
		expect(span?.startTime).toBe(2);
		expect(span?.endTime).toBe(6);
	});

	test("stops merging at camera window", () => {
		const span = findOffCameraSpanAfter({ gazeAnalysis: analysis, afterSeconds: 1 });
		// [6, 8) is camera — span must not extend to 8
		expect(span?.endTime).toBeLessThanOrEqual(6);
	});

	test("returns null when no off-camera window exists after timestamp", () => {
		const span = findOffCameraSpanAfter({ gazeAnalysis: analysis, afterSeconds: 6 });
		expect(span).toBeNull();
	});

	test("single off-camera window returns that window as span", () => {
		const singleWindow: MediaGazeAnalysis = {
			...analysis,
			windows: [
				{ startTime: 3, endTime: 5, gazeScore: 0.1, category: "off-camera", confidence: 0.8 },
			],
		};
		const span = findOffCameraSpanAfter({ gazeAnalysis: singleWindow, afterSeconds: 0 });
		expect(span?.startTime).toBe(3);
		expect(span?.endTime).toBe(5);
	});

	test("non-consecutive off-camera windows are not merged", () => {
		const gapped: MediaGazeAnalysis = {
			...analysis,
			windows: [
				{ startTime: 2, endTime: 4, gazeScore: 0.1, category: "off-camera", confidence: 0.7 },
				// 4 s gap — well beyond the 1s merge tolerance
				{ startTime: 9, endTime: 11, gazeScore: 0.1, category: "off-camera", confidence: 0.7 },
			],
		};
		const span = findOffCameraSpanAfter({ gazeAnalysis: gapped, afterSeconds: 0 });
		// Only the first window; the second is too far away to merge
		expect(span?.endTime).toBeLessThan(9);
	});
});
