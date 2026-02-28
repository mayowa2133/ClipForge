import {
	type ClipTranscriptionInput,
	type ClipTranscriptionResult,
	type Transcriber,
	SrtImportTranscriber,
} from "@/lib/clipforge/transcription";
import { BrowserWhisperTranscriber } from "@/lib/clipforge/transcribers/browser-whisper";
import { WhisperCliTranscriber } from "@/lib/clipforge/transcribers/whisper-cli";

interface ResolveClipForgeTranscriberConfig {
	srtText?: string;
	preferCli?: boolean;
	allowBrowserFallback?: boolean;
}

class FallbackTranscriber implements Transcriber {
	constructor(private readonly transcribers: Transcriber[]) {}

	async transcribe(input: ClipTranscriptionInput): Promise<ClipTranscriptionResult> {
		const warnings: string[] = [];

		for (let index = 0; index < this.transcribers.length; index++) {
			const transcriber = this.transcribers[index];
			try {
				const result = await transcriber.transcribe(input);
				if (warnings.length === 0) return result;
				return {
					...result,
					warnings: [...(result.warnings ?? []), ...warnings],
				};
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Unknown transcription error";
				warnings.push(message);
			}
		}

		throw new Error(warnings[warnings.length - 1] ?? "No transcriber available.");
	}
}

export function resolveClipForgeTranscriber({
	srtText,
	preferCli = true,
	allowBrowserFallback = true,
}: ResolveClipForgeTranscriberConfig = {}): Transcriber {
	if (srtText !== undefined) {
		return new SrtImportTranscriber();
	}

	const browserWhisper = new BrowserWhisperTranscriber();
	const isCliEnabled =
		process.env.NEXT_PUBLIC_CLIPFORGE_WHISPER_CLI_ENABLED === "true";

	if (preferCli && isCliEnabled) {
		const ordered: Transcriber[] = [new WhisperCliTranscriber()];
		if (allowBrowserFallback) {
			ordered.push(browserWhisper);
		}
		return ordered.length === 1 ? ordered[0] : new FallbackTranscriber(ordered);
	}

	return browserWhisper;
}
