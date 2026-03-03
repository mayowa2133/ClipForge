import type { TranscriptionSegment } from "@/types/transcription";
import type { TProject } from "@/types/project";
import type {
	ClipMediaMetadata,
	TranscriptWord,
} from "@/types/clipforge";
import type {
	TimelineElement,
	UploadAudioElement,
	VideoElement,
} from "@/types/timeline";

export interface TimelineTranscriptWord {
	text: string;
	start_ms: number;
	end_ms: number;
	segment_id: string;
	media_id?: string;
}

export function buildTimelineTranscriptSegments({
	project,
}: {
	project: TProject;
}): TranscriptionSegment[] {
	const activeScene =
		project.scenes.find((scene) => scene.id === project.currentSceneId) ??
		project.scenes[0];
	if (!activeScene) return [];

	const segments: TranscriptionSegment[] = [];

	for (const track of activeScene.tracks) {
		for (const element of track.elements) {
			if (!isTranscriptBackedElement(element)) continue;
			const metadata = project.clipforge?.mediaMetadataById[element.mediaId];
			if (!metadata) continue;

			const visibleRange = getElementVisibleRangeMs({ element });
			const overlappingWords = selectWordsForRange({
				words: metadata.words,
				start_ms: visibleRange.start_ms,
				end_ms: visibleRange.end_ms,
			});
			const overlappingSegments = metadata.segments.filter(
				(segment) =>
					segment.end_ms > visibleRange.start_ms &&
					segment.start_ms < visibleRange.end_ms,
			);

			for (const segment of overlappingSegments) {
				const overlapStart = Math.max(segment.start_ms, visibleRange.start_ms);
				const overlapEnd = Math.min(segment.end_ms, visibleRange.end_ms);
				if (overlapEnd <= overlapStart) continue;
				const text = selectTranscriptTextForRange({
					metadata,
					start_ms: overlapStart,
					end_ms: overlapEnd,
				});
				if (text.length === 0) continue;

				segments.push({
					text,
					start: (element.startTime * 1000 + (overlapStart - visibleRange.start_ms)) / 1000,
					end: (element.startTime * 1000 + (overlapEnd - visibleRange.start_ms)) / 1000,
				});
			}

			if (overlappingSegments.length === 0 && overlappingWords.length > 0) {
				const firstWord = overlappingWords[0];
				const lastWord = overlappingWords[overlappingWords.length - 1];
				segments.push({
					text: overlappingWords.map((word) => word.text).join(" "),
					start:
						(element.startTime * 1000 +
							(firstWord.start_ms - visibleRange.start_ms)) /
						1000,
					end:
						(element.startTime * 1000 +
							(lastWord.end_ms - visibleRange.start_ms)) /
						1000,
				});
			}
		}
	}

	return segments
		.filter((segment) => segment.end > segment.start && segment.text.trim().length > 0)
		.sort((a, b) => a.start - b.start);
}

export function buildTranscriptSnippetForElement({
	element,
	metadata,
	maxChars = 80,
}: {
	element: VideoElement | UploadAudioElement;
	metadata?: ClipMediaMetadata;
	maxChars?: number;
}): string {
	if (!metadata) return "";

	const visibleRange = getElementVisibleRangeMs({ element });
	const text = selectTranscriptTextForRange({
		metadata,
		start_ms: visibleRange.start_ms,
		end_ms: visibleRange.end_ms,
	});

	return text.slice(0, maxChars);
}

export function buildTimelineTranscriptWords({
	project,
}: {
	project: TProject;
}): TimelineTranscriptWord[] {
	const activeScene =
		project.scenes.find((scene) => scene.id === project.currentSceneId) ??
		project.scenes[0];
	if (!activeScene) return [];

	const words: TimelineTranscriptWord[] = [];

	for (const track of activeScene.tracks) {
		for (const element of track.elements) {
			if (!isTranscriptBackedElement(element)) continue;
			const metadata = project.clipforge?.mediaMetadataById[element.mediaId];
			if (!metadata || metadata.words.length === 0) continue;

			const visibleRange = getElementVisibleRangeMs({ element });
			const overlappingWords = selectWordsForRange({
				words: metadata.words,
				start_ms: visibleRange.start_ms,
				end_ms: visibleRange.end_ms,
			});

			for (const word of overlappingWords) {
				const overlapStart = Math.max(word.start_ms, visibleRange.start_ms);
				const overlapEnd = Math.min(word.end_ms, visibleRange.end_ms);
				if (overlapEnd <= overlapStart) continue;

				words.push({
					text: word.text,
					start_ms:
						Math.round(element.startTime * 1000) +
						(overlapStart - visibleRange.start_ms),
					end_ms:
						Math.round(element.startTime * 1000) +
						(overlapEnd - visibleRange.start_ms),
					segment_id: element.id,
					media_id: element.mediaId,
				});
			}
		}
	}

	return words
		.filter((word) => word.end_ms > word.start_ms && word.text.trim().length > 0)
		.sort((a, b) => a.start_ms - b.start_ms);
}

function selectTranscriptTextForRange({
	metadata,
	start_ms,
	end_ms,
}: {
	metadata: ClipMediaMetadata;
	start_ms: number;
	end_ms: number;
}): string {
	const words = selectWordsForRange({
		words: metadata.words,
		start_ms,
		end_ms,
	});
	if (words.length > 0) {
		return words.map((word) => word.text).join(" ").trim();
	}

	return metadata.segments
		.filter(
			(segment) => segment.end_ms > start_ms && segment.start_ms < end_ms,
		)
		.map((segment) => segment.text.trim())
		.filter(Boolean)
		.join(" ")
		.trim();
}

function selectWordsForRange({
	words,
	start_ms,
	end_ms,
}: {
	words: TranscriptWord[];
	start_ms: number;
	end_ms: number;
}): TranscriptWord[] {
	return words.filter(
		(word) => word.end_ms > start_ms && word.start_ms < end_ms,
	);
}

function getElementVisibleRangeMs({
	element,
}: {
	element: VideoElement | UploadAudioElement;
}): { start_ms: number; end_ms: number } {
	const start_ms = Math.max(0, Math.round(element.trimStart * 1000));
	const end_ms = Math.max(start_ms, Math.round((element.trimStart + element.duration) * 1000));
	return { start_ms, end_ms };
}

function isTranscriptBackedElement(
	element: TimelineElement,
): element is VideoElement | UploadAudioElement {
	if (element.type === "video") return true;
	return element.type === "audio" && element.sourceType === "upload";
}
