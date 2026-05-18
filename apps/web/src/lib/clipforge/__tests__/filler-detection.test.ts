import { describe, expect, test } from "bun:test";
import {
	isFillerWord,
	detectFillerRegions,
	mergeFillerRegions,
} from "@/lib/clipforge/filler-detection";
import type { TranscriptWord } from "@/types/clipforge";

describe("isFillerWord", () => {
	test("detects known filler words", () => {
		const fillers = ["um", "uh", "umm", "uhh", "hmm", "hm", "er", "err", "ah", "ahh", "eh", "mhm", "mm", "mmm"];
		for (const w of fillers) {
			expect(isFillerWord(w)).toBe(true);
		}
	});

	test("returns false for non-filler words", () => {
		expect(isFillerWord("hello")).toBe(false);
		expect(isFillerWord("the")).toBe(false);
		expect(isFillerWord("amazing")).toBe(false);
	});

	test("matches hesitation regex patterns", () => {
		expect(isFillerWord("uhhm")).toBe(true);
		expect(isFillerWord("ahhh")).toBe(true);
		expect(isFillerWord("mmmhm")).toBe(true);
		expect(isFillerWord("uuuhh")).toBe(true);
	});

	test("strips punctuation before matching", () => {
		expect(isFillerWord("um,")).toBe(true);
		expect(isFillerWord("uh.")).toBe(true);
		expect(isFillerWord("hmm...")).toBe(true);
	});

	test("returns false for empty string", () => {
		expect(isFillerWord("")).toBe(false);
	});

	test("is case-insensitive", () => {
		expect(isFillerWord("UM")).toBe(true);
		expect(isFillerWord("Uh")).toBe(true);
	});
});

describe("detectFillerRegions", () => {
	test("finds filler words in transcript", () => {
		const words: TranscriptWord[] = [
			{ text: "so", start_ms: 0, end_ms: 200 },
			{ text: "um", start_ms: 200, end_ms: 400 },
			{ text: "yeah", start_ms: 400, end_ms: 600 },
			{ text: "uh", start_ms: 600, end_ms: 800 },
		];

		const regions = detectFillerRegions(words);
		expect(regions).toHaveLength(2);
		expect(regions[0].word).toBe("um");
		expect(regions[0].start_ms).toBe(200);
		expect(regions[1].word).toBe("uh");
	});

	test("returns empty for clean transcript", () => {
		const words: TranscriptWord[] = [
			{ text: "hello", start_ms: 0, end_ms: 300 },
			{ text: "world", start_ms: 300, end_ms: 600 },
		];
		expect(detectFillerRegions(words)).toEqual([]);
	});

	test("returns empty for empty input", () => {
		expect(detectFillerRegions([])).toEqual([]);
	});
});

describe("mergeFillerRegions", () => {
	test("merges regions within 150ms gap", () => {
		const regions = [
			{ start_ms: 100, end_ms: 200, word: "um" },
			{ start_ms: 300, end_ms: 400, word: "uh" },
		];
		const merged = mergeFillerRegions(regions);
		expect(merged).toHaveLength(1);
		expect(merged[0].start_ms).toBe(100);
		expect(merged[0].end_ms).toBe(400);
	});

	test("keeps distant regions separate", () => {
		const regions = [
			{ start_ms: 100, end_ms: 200, word: "um" },
			{ start_ms: 1000, end_ms: 1100, word: "uh" },
		];
		const merged = mergeFillerRegions(regions);
		expect(merged).toHaveLength(2);
	});

	test("handles empty input", () => {
		expect(mergeFillerRegions([])).toEqual([]);
	});

	test("handles single region", () => {
		const merged = mergeFillerRegions([{ start_ms: 100, end_ms: 200, word: "um" }]);
		expect(merged).toHaveLength(1);
	});

	test("sorts unsorted input before merging", () => {
		const regions = [
			{ start_ms: 500, end_ms: 600, word: "uh" },
			{ start_ms: 100, end_ms: 200, word: "um" },
			{ start_ms: 550, end_ms: 650, word: "er" },
		];
		const merged = mergeFillerRegions(regions);
		expect(merged).toHaveLength(2);
		expect(merged[0].start_ms).toBe(100);
		expect(merged[1].end_ms).toBe(650);
	});
});
