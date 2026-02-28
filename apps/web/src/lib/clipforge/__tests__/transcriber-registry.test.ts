import { describe, expect, test } from "bun:test";
import { resolveClipForgeTranscriber, SrtImportTranscriber } from "@/lib/clipforge";
import { BrowserWhisperTranscriber } from "@/lib/clipforge/transcribers/browser-whisper";

describe("resolveClipForgeTranscriber", () => {
	test("prefers SRT import when text is provided", () => {
		const transcriber = resolveClipForgeTranscriber({
			srtText: "1\n00:00:00,000 --> 00:00:01,000\nhello",
		});

		expect(transcriber).toBeInstanceOf(SrtImportTranscriber);
	});

	test("falls back to browser whisper when cli is not enabled", () => {
		const originalValue = process.env.NEXT_PUBLIC_CLIPFORGE_WHISPER_CLI_ENABLED;
		process.env.NEXT_PUBLIC_CLIPFORGE_WHISPER_CLI_ENABLED = "false";

		const transcriber = resolveClipForgeTranscriber();

		expect(transcriber).toBeInstanceOf(BrowserWhisperTranscriber);
		process.env.NEXT_PUBLIC_CLIPFORGE_WHISPER_CLI_ENABLED = originalValue;
	});
});
