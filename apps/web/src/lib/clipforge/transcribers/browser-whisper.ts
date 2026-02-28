import { transcriptionService } from "@/services/transcription/service";
import type { Transcriber } from "@/lib/clipforge/transcription";
import {
	buildWordsFromSegments,
	normalizeSegmentsFromSeconds,
} from "@/lib/clipforge/transcription";
import type { TranscriptionLanguage } from "@/types/transcription";

export class BrowserWhisperTranscriber implements Transcriber {
	async transcribe(input: Parameters<Transcriber["transcribe"]>[0]) {
		if (!input.audioData) {
			throw new Error("Browser Whisper transcriber requires decoded audio.");
		}

		const result = await transcriptionService.transcribe({
			audioData: input.audioData,
			language: input.language as TranscriptionLanguage | undefined,
		});
		const segments = normalizeSegmentsFromSeconds({
			segments: result.segments,
		});

		return {
			words: buildWordsFromSegments({ segments }),
			segments,
			language: result.language,
			provider: "browser-whisper" as const,
		};
	}
}
