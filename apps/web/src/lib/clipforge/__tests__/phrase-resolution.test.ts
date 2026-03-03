import { describe, expect, test } from "bun:test";
import {
	findPhraseOccurrences,
	resolvePhraseWindow,
} from "@/lib/clipforge";

const projectSummary = {
	timeline_words: [
		{ text: "Hey", start_ms: 1000, end_ms: 1200, segment_id: "seg-1" },
		{ text: "bro,", start_ms: 1200, end_ms: 1450, segment_id: "seg-1" },
		{ text: "welcome", start_ms: 1450, end_ms: 1900, segment_id: "seg-1" },
		{ text: "back", start_ms: 1900, end_ms: 2200, segment_id: "seg-1" },
		{ text: "bro", start_ms: 2600, end_ms: 2900, segment_id: "seg-2" },
		{ text: "again", start_ms: 2900, end_ms: 3300, segment_id: "seg-2" },
	],
};

describe("phrase resolution", () => {
	test("finds exact, punctuation-normalized phrase matches", () => {
		const matches = findPhraseOccurrences({
			projectSummary,
			phrase: "bro",
		});

		expect(matches).toHaveLength(2);
		expect(matches[0]).toMatchObject({
			occurrence: 1,
			start_ms: 1200,
			end_ms: 1450,
			segment_id: "seg-1",
		});
		expect(matches[1]).toMatchObject({
			occurrence: 2,
			start_ms: 2600,
			end_ms: 2900,
			segment_id: "seg-2",
		});
	});

	test("supports multi-word phrase windows and ordinal selection", () => {
		const matches = findPhraseOccurrences({
			projectSummary,
			phrase: "bro welcome",
		});

		expect(matches).toHaveLength(1);
		expect(resolvePhraseWindow({
			projectSummary,
			phrase: "bro",
			occurrence: 2,
		})).toEqual({
			start_ms: 2480,
			end_ms: 3020,
		});
	});

	test("returns null when the phrase is missing", () => {
		expect(
			resolvePhraseWindow({
				projectSummary,
				phrase: "missing phrase",
			}),
		).toBeNull();
	});
});
