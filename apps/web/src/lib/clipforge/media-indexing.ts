import { detectSilenceRegions } from "@/lib/clipforge/silence-detection";
import type { Transcriber } from "@/lib/clipforge/transcription";
import { buildEmptyMediaMetadata } from "@/lib/clipforge/transcription";
import type { DecodedAudio } from "@/lib/media/audio";
import type { MediaAsset } from "@/types/assets";
import type { ClipMediaMetadata } from "@/types/clipforge";

export async function buildClipIndex({
	mediaAsset,
	language,
	transcriber,
	extractAudio,
}: {
	mediaAsset: MediaAsset;
	language?: string;
	transcriber: Transcriber;
	extractAudio: (params: { mediaAsset: MediaAsset }) => Promise<DecodedAudio>;
}): Promise<ClipMediaMetadata> {
	if (mediaAsset.type !== "video" && mediaAsset.type !== "audio") {
		return buildEmptyMediaMetadata();
	}

	const { samples, sampleRate } = await extractAudio({ mediaAsset });
	const transcript = await transcriber.transcribe({
		mediaAsset,
		audioData: samples,
		language,
	});

	return {
		words: transcript.words,
		segments: transcript.segments,
		silenceRegions: detectSilenceRegions({
			samples,
			sampleRate,
		}),
		transcriptionStatus: "ready",
		transcriptionProvider: transcript.provider,
		transcriptionLanguage: transcript.language ?? language ?? null,
		transcriptionError:
			transcript.warnings && transcript.warnings.length > 0
				? transcript.warnings.join(" | ")
				: null,
		indexedAt: new Date().toISOString(),
	};
}
