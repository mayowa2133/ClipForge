import { describe, expect, test } from "bun:test";
import { parseWhisperCliJson } from "@/lib/clipforge/transcribers/whisper-cli-server";

describe("parseWhisperCliJson", () => {
	test("uses native word timestamps when available", () => {
		const result = parseWhisperCliJson({
			raw: JSON.stringify({
				language: "en",
				segments: [
					{
						text: "hello world",
						start: 0,
						end: 1,
						words: [
							{ word: "hello", start: 0, end: 0.4 },
							{ word: "world", start: 0.4, end: 1 },
						],
					},
				],
			}),
		});

		expect(result.provider).toBe("whisper-cli");
		expect(result.words).toEqual([
			{ text: "hello", start_ms: 0, end_ms: 400 },
			{ text: "world", start_ms: 400, end_ms: 1000 },
		]);
	});

	test("synthesizes word timings when native words are absent", () => {
		const result = parseWhisperCliJson({
			raw: JSON.stringify({
				segments: [{ text: "hello world", start: 0, end: 1 }],
			}),
		});

		expect(result.words).toEqual([
			{ text: "hello", start_ms: 0, end_ms: 500 },
			{ text: "world", start_ms: 500, end_ms: 1000 },
		]);
	});
});
