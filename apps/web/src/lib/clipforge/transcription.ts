import type {
	ClipForgeTranscriptionProvider,
	ClipMediaMetadata,
	TranscriptSegment,
	TranscriptWord,
} from "@/types/clipforge";
import type { MediaAsset } from "@/types/assets";

export interface Transcriber {
	transcribe(
		input: ClipTranscriptionInput,
	): Promise<ClipTranscriptionResult>;
}

export interface ClipTranscriptionInput {
	mediaAsset: MediaAsset;
	audioData?: Float32Array;
	language?: string;
	srtText?: string;
}

export interface ClipTranscriptionResult {
	words: TranscriptWord[];
	segments: TranscriptSegment[];
	language?: string;
	provider: ClipForgeTranscriptionProvider;
	warnings?: string[];
}

export class SrtImportTranscriber implements Transcriber {
	async transcribe(
		input: ClipTranscriptionInput,
	): Promise<ClipTranscriptionResult> {
		const segments = parseSrtSegments({ srtText: input.srtText ?? "" });
		return {
			words: buildWordsFromSegments({ segments }),
			segments,
			language: input.language,
			provider: "srt-import",
		};
	}
}

export function buildEmptyMediaMetadata(): ClipMediaMetadata {
	return {
		words: [],
		segments: [],
		silenceRegions: [],
		transcriptionStatus: "idle",
		transcriptionProvider: null,
		transcriptionLanguage: null,
		transcriptionError: null,
		indexedAt: null,
	};
}

export function buildWordsFromSegments({
	segments,
}: {
	segments: TranscriptSegment[];
}): TranscriptWord[] {
	const words: TranscriptWord[] = [];

	for (const segment of segments) {
		const tokens = segment.text
			.trim()
			.split(/\s+/)
			.map((token) => token.trim())
			.filter(Boolean);
		if (tokens.length === 0) continue;

		const duration = Math.max(1, segment.end_ms - segment.start_ms);
		for (let index = 0; index < tokens.length; index++) {
			const start_ms =
				segment.start_ms + Math.floor((duration * index) / tokens.length);
			const end_ms =
				index === tokens.length - 1
					? segment.end_ms
					: segment.start_ms +
						Math.floor((duration * (index + 1)) / tokens.length);

			words.push({
				text: tokens[index],
				start_ms,
				end_ms: Math.max(start_ms + 1, end_ms),
			});
		}
	}

	return words;
}

export function normalizeSegmentsFromSeconds({
	segments,
}: {
	segments: Array<{ text: string; start: number; end: number }>;
}): TranscriptSegment[] {
	return segments
		.map((segment) => ({
			text: segment.text.trim(),
			start_ms: Math.round(segment.start * 1000),
			end_ms: Math.round(segment.end * 1000),
		}))
		.filter(
			(segment) =>
				segment.text.length > 0 &&
				Number.isFinite(segment.start_ms) &&
				Number.isFinite(segment.end_ms) &&
				segment.end_ms > segment.start_ms,
		);
}

export function parseSrtSegments({
	srtText,
}: {
	srtText: string;
}): TranscriptSegment[] {
	if (srtText.trim().length === 0) {
		return [];
	}

	const blocks = srtText
		.split(/\r?\n\r?\n/g)
		.map((block) => block.trim())
		.filter(Boolean);

	const segments: TranscriptSegment[] = [];

	for (const block of blocks) {
		const lines = block.split(/\r?\n/g).filter(Boolean);
		if (lines.length < 2) continue;

		const timeLine = lines[1];
		const times = timeLine.split("-->").map((part) => part.trim());
		if (times.length !== 2) continue;

		const start = parseSrtTimestamp({ value: times[0] });
		const end = parseSrtTimestamp({ value: times[1] });
		if (start === null || end === null || end <= start) continue;

		const text = lines.slice(2).join(" ").trim();
		if (text.length === 0) continue;

		segments.push({
			text,
			start_ms: start,
			end_ms: end,
		});
	}

	return segments;
}

function parseSrtTimestamp({ value }: { value: string }): number | null {
	const match = value.match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
	if (!match) return null;

	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	const seconds = Number(match[3]);
	const milliseconds = Number(match[4]);

	return ((hours * 60 * 60 + minutes * 60 + seconds) * 1000) + milliseconds;
}
