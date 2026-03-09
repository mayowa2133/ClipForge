import type { CaptionChunk, TranscriptionSegment } from "@/types/transcription";
import type { CaptionStyleTemplate } from "@/types/clipforge";

export interface CaptionLineBreakOptions {
	maxCharsPerLine?: number;
	maxLines?: number;
	minDisplaySeconds?: number;
	maxWordsPerChunk?: number;
}

const CAPTION_TEMPLATES: Record<string, CaptionStyleTemplate> = {
	"clean-bottom": {
		style_id: "clean-bottom",
		font: "Arial",
		size: 56,
		position: "bottom",
		outline: false,
		highlight_mode: "none",
	},
	"bold-center": {
		style_id: "bold-center",
		font: "Arial",
		size: 74,
		position: "center",
		outline: true,
		highlight_mode: "line",
	},
};

export function getCaptionTemplate({
	styleId,
}: {
	styleId: "clean-bottom" | "bold-center";
}): CaptionStyleTemplate {
	return CAPTION_TEMPLATES[styleId];
}

export function generateCaptionChunks({
	segments,
	options = {},
}: {
	segments: TranscriptionSegment[];
	options?: CaptionLineBreakOptions;
}): CaptionChunk[] {
	const maxCharsPerLine = options.maxCharsPerLine ?? 26;
	const maxLines = options.maxLines ?? 2;
	const minDisplaySeconds = options.minDisplaySeconds ?? 0.8;
	const maxWordsPerChunk = options.maxWordsPerChunk ?? 10;

	const chunks: CaptionChunk[] = [];
	let globalEnd = 0;

	for (const segment of segments) {
		const words = segment.text
			.trim()
			.split(/\s+/)
			.filter(Boolean);
		if (words.length === 0) continue;

		const segmentDuration = Math.max(0.01, segment.end - segment.start);
		let wordIndex = 0;

		while (wordIndex < words.length) {
			const endIndex = selectChunkEnd({
				words,
				startIndex: wordIndex,
				maxWordsPerChunk,
				maxCharsPerLine,
				maxLines,
			});
			const chunkWords = words.slice(wordIndex, endIndex);
			const lines = breakIntoLines({
				words: chunkWords,
				maxCharsPerLine,
			});

			const normalizedLines = lines.slice(0, maxLines);
			const text = normalizedLines.join("\n");
			const rawDuration =
				(chunkWords.length / words.length) * segmentDuration;
			const duration = Math.max(minDisplaySeconds, rawDuration);
			const intendedStart =
				segment.start + (wordIndex / words.length) * segmentDuration;
			const startTime = Math.max(intendedStart, globalEnd);

			chunks.push({
				text,
				startTime,
				duration,
			});

			globalEnd = startTime + duration;
			wordIndex = endIndex;
		}
	}

	return chunks;
}

export function generateCaptionChunksFromWords({
	words,
	options = {},
}: {
	words: Array<{ text: string; startTime: number; endTime: number }>;
	options?: CaptionLineBreakOptions;
}): CaptionChunk[] {
	const maxCharsPerLine = options.maxCharsPerLine ?? 26;
	const maxLines = options.maxLines ?? 2;
	const minDisplaySeconds = options.minDisplaySeconds ?? 0.8;
	const maxWordsPerChunk = options.maxWordsPerChunk ?? 10;

	const chunks: CaptionChunk[] = [];
	let index = 0;
	let globalEnd = 0;
	const normalizedWords = words.filter(
		(word) => word.endTime > word.startTime && word.text.trim().length > 0,
	);

	while (index < normalizedWords.length) {
		const endIndex = selectChunkEnd({
			words: normalizedWords.map((word) => word.text),
			startIndex: index,
			maxWordsPerChunk,
			maxCharsPerLine,
			maxLines,
		});
		const chunkWords = normalizedWords.slice(index, endIndex);
		const lines = breakIntoLines({
			words: chunkWords.map((word) => word.text),
			maxCharsPerLine,
		});
		const text = lines.slice(0, maxLines).join("\n");
		const firstWord = chunkWords[0];
		const lastWord = chunkWords[chunkWords.length - 1];
		if (!firstWord || !lastWord) break;
		const startTime = Math.max(firstWord.startTime, globalEnd);
		const duration = Math.max(
			minDisplaySeconds,
			Math.max(0.01, lastWord.endTime - startTime),
		);

		chunks.push({
			text,
			startTime,
			duration,
			words: chunkWords,
		});

		globalEnd = startTime + duration;
		index = endIndex;
	}

	return chunks;
}

function selectChunkEnd({
	words,
	startIndex,
	maxWordsPerChunk,
	maxCharsPerLine,
	maxLines,
}: {
	words: string[];
	startIndex: number;
	maxWordsPerChunk: number;
	maxCharsPerLine: number;
	maxLines: number;
}): number {
	const hardEnd = Math.min(words.length, startIndex + maxWordsPerChunk);
	let bestEnd = Math.min(words.length, startIndex + 1);

	for (let end = startIndex + 1; end <= hardEnd; end++) {
		const lines = breakIntoLines({
			words: words.slice(startIndex, end),
			maxCharsPerLine,
		});
		if (lines.length > maxLines) break;
		bestEnd = end;
	}

	return bestEnd;
}

function breakIntoLines({
	words,
	maxCharsPerLine,
}: {
	words: string[];
	maxCharsPerLine: number;
}): string[] {
	const lines: string[] = [];
	let currentLine = "";

	for (const word of words) {
		const candidate = currentLine.length === 0 ? word : `${currentLine} ${word}`;
		if (candidate.length <= maxCharsPerLine || currentLine.length === 0) {
			currentLine = candidate;
			continue;
		}

		lines.push(currentLine);
		currentLine = word;
	}

	if (currentLine.length > 0) {
		lines.push(currentLine);
	}

	if (lines.length >= 2) {
		const lastLine = lines[lines.length - 1];
		const prevLineIndex = lines.length - 2;
		if (
			lastLine.split(/\s+/).length === 1 &&
			lastLine.length <= 3 &&
			`${lines[prevLineIndex]} ${lastLine}`.length <= maxCharsPerLine
		) {
			lines[prevLineIndex] = `${lines[prevLineIndex]} ${lastLine}`;
			lines.pop();
		}
	}

	return lines;
}
