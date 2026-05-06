import { describe, expect, test } from "bun:test";
import {
	buildEmptyMediaMetadata,
	type ClipTranscriptionInput,
	normalizeWordsFromSeconds,
	SrtImportTranscriber,
	WhisperCliTranscriber,
} from "@/lib/clipforge";
import type { MediaAsset } from "@/types/assets";

function buildMediaAsset(): MediaAsset {
	return {
		id: "clip-1",
		name: "intro",
		type: "video",
		duration: 3,
		file: new File(["video"], "intro.mp4", { type: "video/mp4" }),
	};
}

describe("clipforge transcription scaffolding", () => {
	test("parses SRT into transcript segments", async () => {
		const transcriber = new SrtImportTranscriber();
		const input: ClipTranscriptionInput = {
			mediaAsset: buildMediaAsset(),
			srtText: `1
00:00:00,000 --> 00:00:01,250
hello world

2
00:00:01,500 --> 00:00:03,000
this is clipforge
`,
		};

		const result = await transcriber.transcribe(input);

		expect(result.provider).toBe("srt-import");
		expect(result.words).toEqual([
			{ text: "hello", start_ms: 0, end_ms: 625 },
			{ text: "world", start_ms: 625, end_ms: 1250 },
			{ text: "this", start_ms: 1500, end_ms: 2000 },
			{ text: "is", start_ms: 2000, end_ms: 2500 },
			{ text: "clipforge", start_ms: 2500, end_ms: 3000 },
		]);
		expect(result.segments).toEqual([
			{
				text: "hello world",
				start_ms: 0,
				end_ms: 1250,
			},
			{
				text: "this is clipforge",
				start_ms: 1500,
				end_ms: 3000,
			},
		]);
	});

	test("returns empty metadata scaffold defaults", () => {
		expect(buildEmptyMediaMetadata()).toEqual({
			words: [],
			segments: [],
			silenceRegions: [],
			transcriptionStatus: "idle",
			transcriptionProvider: null,
			transcriptionLanguage: null,
			transcriptionError: null,
			indexedAt: null,
		});
	});

	test("normalizes browser word timestamps into media metadata words", () => {
		expect(
			normalizeWordsFromSeconds({
				words: [
					{ text: " hello ", start: 0, end: 0.42 },
					{ text: "", start: 0.42, end: 0.5 },
					{ text: "world", start: 0.5, end: 1.12 },
				],
			}),
		).toEqual([
			{ text: "hello", start_ms: 0, end_ms: 420 },
			{ text: "world", start_ms: 500, end_ms: 1120 },
		]);
	});

	test("whisper cli transcriber rejects unavailable local endpoint", async () => {
		const transcriber = new WhisperCliTranscriber();
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ error: "Whisper CLI is disabled." }), {
				status: 503,
				headers: { "Content-Type": "application/json" },
			})) as unknown as typeof fetch;

		await expect(
			transcriber.transcribe({
				mediaAsset: buildMediaAsset(),
			}),
		).rejects.toThrow("Whisper CLI is disabled.");

		globalThis.fetch = originalFetch;
	});
});
