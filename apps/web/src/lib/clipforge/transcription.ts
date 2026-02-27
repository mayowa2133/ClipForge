import type {
	ClipMediaMetadata,
	TranscriptSegment,
	TranscriptWord,
} from "@/types/clipforge";

export interface Transcriber {
	transcribe(
		videoPath: string,
	): Promise<{ words: TranscriptWord[]; segments: TranscriptSegment[] }>;
}

export class SrtImportTranscriber implements Transcriber {
	constructor(private srtByPath: Record<string, string> = {}) {}

	async transcribe(
		videoPath: string,
	): Promise<{ words: TranscriptWord[]; segments: TranscriptSegment[] }> {
		const srtText = this.srtByPath[videoPath] ?? "";
		return parseSrt({ srtText });
	}
}

export class WhisperCliTranscriber implements Transcriber {
	async transcribe(
		_videoPath: string,
	): Promise<{ words: TranscriptWord[]; segments: TranscriptSegment[] }> {
		throw new Error(
			"Whisper CLI transcriber is not configured yet. Wire a local adapter in M3.",
		);
	}
}

export function buildEmptyMediaMetadata(): ClipMediaMetadata {
	return {
		words: [],
		segments: [],
		silenceRegions: [],
	};
}

function parseSrt({
	srtText,
}: {
	srtText: string;
}): { words: TranscriptWord[]; segments: TranscriptSegment[] } {
	if (srtText.trim().length === 0) {
		return { words: [], segments: [] };
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

	return { words: [], segments };
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
