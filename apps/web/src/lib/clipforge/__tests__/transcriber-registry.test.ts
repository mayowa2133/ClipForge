import { describe, expect, test } from "bun:test";
import { resolveClipForgeTranscriber, SrtImportTranscriber } from "@/lib/clipforge";
import { BrowserWhisperTranscriber } from "@/lib/clipforge/transcribers/browser-whisper";
import { ManagedCloudTranscriber } from "@/lib/clipforge/transcribers/managed-cloud";

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

	test("ignores managedCloud config when useManagedCloud is false", () => {
		const transcriber = resolveClipForgeTranscriber({
			useManagedCloud: false,
			managedCloud: { resolveCloudProjectId: async () => "cp_x" },
		});
		expect(transcriber).toBeInstanceOf(BrowserWhisperTranscriber);
	});

	test("prepends managed cloud transcriber when useManagedCloud is true and config is provided", () => {
		const transcriber = resolveClipForgeTranscriber({
			useManagedCloud: true,
			managedCloud: { resolveCloudProjectId: async () => "cp_x" },
		});
		// Wraps in fallback chain (managed cloud + browser fallback) so check
		// against the fallback wrapper (not BrowserWhisperTranscriber directly).
		expect(transcriber).not.toBeInstanceOf(BrowserWhisperTranscriber);
		expect(transcriber).not.toBeInstanceOf(ManagedCloudTranscriber);
	});

	test("uses managed cloud alone when allowBrowserFallback=false and CLI disabled", () => {
		const originalValue = process.env.NEXT_PUBLIC_CLIPFORGE_WHISPER_CLI_ENABLED;
		process.env.NEXT_PUBLIC_CLIPFORGE_WHISPER_CLI_ENABLED = "false";
		const transcriber = resolveClipForgeTranscriber({
			useManagedCloud: true,
			allowBrowserFallback: false,
			managedCloud: { resolveCloudProjectId: async () => "cp_x" },
		});
		expect(transcriber).toBeInstanceOf(ManagedCloudTranscriber);
		process.env.NEXT_PUBLIC_CLIPFORGE_WHISPER_CLI_ENABLED = originalValue;
	});
});
