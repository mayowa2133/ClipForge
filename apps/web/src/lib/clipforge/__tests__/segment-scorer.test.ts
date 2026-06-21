import { describe, expect, test } from "bun:test";
import { buildDurationClosingCutOps } from "@/lib/clipforge/segment-scorer";

describe("duration-closing editorial pass", () => {
	test("lands on target while preserving hook and payoff speech", () => {
		const segments = [
			{ startMs: 1_000, endMs: 3_000 },
			{ startMs: 10_000, endMs: 12_000 },
			{ startMs: 20_000, endMs: 23_000 },
			{ startMs: 40_000, endMs: 43_000 },
			{ startMs: 55_000, endMs: 58_000 },
		];
		const words = segments.flatMap((segment, segmentIndex) =>
			Array.from({ length: 6 }, (_, wordIndex) => ({
				text: `word-${segmentIndex}-${wordIndex}`,
				start_ms: segment.startMs + wordIndex * 200,
				end_ms: segment.startMs + wordIndex * 200 + 150,
			})),
		);
		const cuts = buildDurationClosingCutOps({
			segments,
			transcriptWords: words,
			totalDurationMs: 60_000,
			targetDurationMs: 20_000,
		});
		const keptDurationMs =
			60_000 - cuts.reduce((sum, cut) => sum + cut.end_ms - cut.start_ms, 0);

		expect(keptDurationMs).toBeGreaterThanOrEqual(19_990);
		expect(keptDurationMs).toBeLessThanOrEqual(20_010);
		expect(
			cuts.some((cut) => cut.start_ms <= 1_000 && cut.end_ms >= 3_000),
		).toBe(false);
		expect(
			cuts.some((cut) => cut.start_ms <= 55_000 && cut.end_ms >= 58_000),
		).toBe(false);
	});

	test("does nothing when the timeline is already within target", () => {
		expect(
			buildDurationClosingCutOps({
				segments: [{ startMs: 0, endMs: 9_000 }],
				transcriptWords: [],
				totalDurationMs: 9_000,
				targetDurationMs: 10_000,
			}),
		).toEqual([]);
	});
});
