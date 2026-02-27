import { describe, expect, test } from "bun:test";
import {
	buildEmptyMediaMetadata,
	SrtImportTranscriber,
	WhisperCliTranscriber,
} from "@/lib/clipforge";

describe("clipforge transcription scaffolding", () => {
	test("parses SRT into transcript segments", async () => {
		const transcriber = new SrtImportTranscriber({
			"/clips/intro.mp4": `1
00:00:00,000 --> 00:00:01,250
hello world

2
00:00:01,500 --> 00:00:03,000
this is clipforge
`,
		});

		const result = await transcriber.transcribe("/clips/intro.mp4");

		expect(result.words).toEqual([]);
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
		});
	});

	test("whisper transcriber is intentionally unconfigured in scaffold", async () => {
		const transcriber = new WhisperCliTranscriber();
		await expect(transcriber.transcribe("/clips/a.mp4")).rejects.toThrow(
			"Whisper CLI transcriber is not configured yet",
		);
	});
});
