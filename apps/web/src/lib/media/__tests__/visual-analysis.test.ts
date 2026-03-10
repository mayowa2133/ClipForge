import { describe, expect, test } from "bun:test";
import {
	buildActivityWindowsFromFrameDeltas,
	detectSceneCutsFromFrameDeltas,
	normalizeFrameDeltas,
} from "@/lib/media/visual-analysis";

describe("visual-analysis helpers", () => {
	test("normalizeFrameDeltas scales values deterministically", () => {
		expect(normalizeFrameDeltas({ frameDeltas: [0.1, 0.2, 0.4] })).toEqual([
			0.25,
			0.5,
			1,
		]);
	});

	test("detectSceneCutsFromFrameDeltas marks strong changes", () => {
		expect(
			detectSceneCutsFromFrameDeltas({
				frameDeltas: [0.1, 0.15, 0.95, 0.2, 0.82],
				sampleIntervalSeconds: 0.5,
			}),
		).toEqual([1.5, 2.5]);
	});

	test("buildActivityWindowsFromFrameDeltas returns ranked windows only above threshold", () => {
		expect(
			buildActivityWindowsFromFrameDeltas({
				frameDeltas: [0.1, 0.2, 0.75, 0.78, 0.12, 0.65, 0.7, 0.2],
				sampleIntervalSeconds: 0.25,
			}),
		).toEqual([
			{ startTime: 0, endTime: 1, score: 0.5865 },
			{ startTime: 1, endTime: 2, score: 0.5352 },
		]);
	});
});
