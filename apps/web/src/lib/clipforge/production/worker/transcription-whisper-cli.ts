/**
 * Local Whisper CLI transcription engine for the worker.
 *
 * Implements the TranscriptionEngine interface from transcription-worker.ts
 * using the local whisper CLI binary. This enables transcription without
 * the remote Modal endpoint — works fully offline.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TranscriptionEngine } from "./transcription-worker";
import type {
	TranscriptionGraphInput,
	TranscriptionSegment,
	TranscriptionWord,
} from "@/lib/clipforge/production/transcription-graph";
import { runWhisperOnPath } from "@/lib/clipforge/transcribers/whisper-cli-server";

export interface WhisperCliTranscriptionEngineArgs {
	id?: string;
	model?: string;
	fetchImpl?: typeof fetch;
}

export class WhisperCliTranscriptionEngine implements TranscriptionEngine {
	readonly id: string;
	private readonly model: string;
	private readonly fetchImpl: typeof fetch;

	constructor({
		id = "clipforge-whisper-cli-transcriber",
		model = "base",
		fetchImpl,
	}: WhisperCliTranscriptionEngineArgs = {}) {
		this.id = id;
		this.model = model;
		this.fetchImpl = fetchImpl ?? fetch;
	}

	async transcribe({
		input,
		mediaDownloadUrl,
		onProgress,
	}: {
		input: TranscriptionGraphInput;
		mediaDownloadUrl: string;
		onProgress: (pct: number) => Promise<void>;
	}): Promise<{
		words: TranscriptionWord[];
		segments: TranscriptionSegment[];
		language: string;
		stub: boolean;
	}> {
		await onProgress(5);

		// Resolve the media file to a local path
		let filePath: string;
		let cleanup: (() => Promise<void>) | undefined;

		if (
			mediaDownloadUrl.startsWith("file://") ||
			mediaDownloadUrl.startsWith("/")
		) {
			// Local file — use directly
			filePath = mediaDownloadUrl.replace(/^file:\/\//, "");
		} else {
			// Remote URL — download to temp file
			const tempDir = await mkdtemp(
				join(tmpdir(), "clipforge-whisper-dl-"),
			);
			filePath = join(tempDir, "media");
			cleanup = async () => rm(tempDir, { recursive: true, force: true });

			const response = await this.fetchImpl(mediaDownloadUrl);
			if (!response.ok) {
				throw new Error(
					`Failed to download media from ${mediaDownloadUrl}: ${response.status}`,
				);
			}
			const buffer = Buffer.from(await response.arrayBuffer());
			await writeFile(filePath, buffer);
		}

		await onProgress(20);

		try {
			// Run Whisper CLI on the local file
			const result = await runWhisperOnPath({
				filePath,
				language: input.languageHint ?? undefined,
				model: this.model,
			});

			await onProgress(90);

			// Map ClipTranscriptionResult types to TranscriptionGraph types
			// Both use { text, start_ms, end_ms } — structurally identical
			const words: TranscriptionWord[] = result.words.map((w) => ({
				text: w.text,
				start_ms: w.start_ms,
				end_ms: w.end_ms,
			}));

			const segments: TranscriptionSegment[] = result.segments.map((s) => ({
				text: s.text,
				start_ms: s.start_ms,
				end_ms: s.end_ms,
			}));

			return {
				words,
				segments,
				language: result.language ?? input.languageHint ?? "en",
				stub: false,
			};
		} finally {
			if (cleanup) await cleanup();
		}
	}
}
