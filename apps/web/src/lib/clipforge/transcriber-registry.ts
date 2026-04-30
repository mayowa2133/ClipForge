import {
	type ClipTranscriptionInput,
	type ClipTranscriptionResult,
	type Transcriber,
	SrtImportTranscriber,
} from "@/lib/clipforge/transcription";
import { BrowserWhisperTranscriber } from "@/lib/clipforge/transcribers/browser-whisper";
import { WhisperCliTranscriber } from "@/lib/clipforge/transcribers/whisper-cli";
import {
	ManagedCloudTranscriber,
	type ManagedCloudTranscriberArgs,
} from "@/lib/clipforge/transcribers/managed-cloud";

interface ResolveClipForgeTranscriberConfig {
	srtText?: string;
	preferCli?: boolean;
	allowBrowserFallback?: boolean;
	managedCloud?: ManagedCloudTranscriberArgs | false;
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
	managedCloud,
}: ResolveClipForgeTranscriberConfig = {}): Transcriber {
	if (srtText !== undefined) {
		return new SrtImportTranscriber();
	}

	const ordered: Transcriber[] = [];
	const useManagedCloud = managedCloud !== false && shouldUseManagedCloud(managedCloud);
	if (useManagedCloud && managedCloud) {
		ordered.push(new ManagedCloudTranscriber(managedCloud));
	}

	const isCliEnabled =
		process.env.NEXT_PUBLIC_CLIPFORGE_WHISPER_CLI_ENABLED === "true";
	if (preferCli && isCliEnabled) {
		ordered.push(new WhisperCliTranscriber());
	}
	if (allowBrowserFallback || ordered.length === 0) {
		ordered.push(new BrowserWhisperTranscriber());
	}

	return ordered.length === 1 ? ordered[0]! : new FallbackTranscriber(ordered);
}

function shouldUseManagedCloud(
	args: ManagedCloudTranscriberArgs | undefined | false,
): boolean {
	if (!args) return false;
	if (
		typeof process !== "undefined" &&
		process.env?.NEXT_PUBLIC_CLIPFORGE_MANAGED_TRANSCRIBER === "true"
	) {
		return true;
	}
	return false;
}
