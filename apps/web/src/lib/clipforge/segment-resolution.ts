import { findPhraseOccurrences } from "@/lib/clipforge/phrase-resolution";
import type {
	ChatSegmentKind,
	ProjectSegmentSummary,
	ProjectSummary,
} from "@/lib/clipforge/chat/types";

export type SegmentReferenceTarget =
	| "clip"
	| "segment"
	| "caption"
	| "text"
	| "overlay";

export interface SegmentReference {
	target: SegmentReferenceTarget;
	occurrence?: number;
	useLast?: boolean;
	phrase?: string;
	content?: string;
}

export function findAddressableSegments({
	projectSummary,
	target,
}: {
	projectSummary: Pick<ProjectSummary, "segments">;
	target: SegmentReferenceTarget;
}): ProjectSegmentSummary[] {
	const kind = mapTargetToKind({ target });
	if (!kind) return [];

	return projectSummary.segments
		.filter((segment) => segment.segment_kind === kind)
		.sort((a, b) => a.start_ms - b.start_ms);
}

export function resolveSegmentReference({
	projectSummary,
	reference,
}: {
	projectSummary: Pick<ProjectSummary, "segments" | "timeline_words">;
	reference: SegmentReference;
}): ProjectSegmentSummary | null {
	if (reference.phrase) {
		const matches = findPhraseOccurrences({
			projectSummary,
			phrase: reference.phrase,
		});
		const targetMatch = reference.useLast
			? matches.at(-1)
			: matches.find(
				(match) => match.occurrence === (reference.occurrence ?? 1),
			);
		if (!targetMatch) {
			return null;
		}

		return (
			projectSummary.segments
				.filter((segment) => segment.segment_kind === "video")
				.sort((a, b) => a.start_ms - b.start_ms)
				.find(
					(segment) =>
						targetMatch.start_ms >= segment.start_ms &&
						targetMatch.start_ms < segment.end_ms,
				) ?? null
		);
	}

	const candidates = findAddressableSegments({
		projectSummary,
		target: reference.target,
	});
	if (candidates.length === 0) {
		return null;
	}
	if (reference.useLast) {
		return candidates.at(-1) ?? null;
	}

	const occurrence = reference.occurrence ?? 1;
	return candidates[occurrence - 1] ?? null;
}

export function resolveCaptionReference({
	projectSummary,
	reference,
	fromText,
}: {
	projectSummary: Pick<ProjectSummary, "segments">;
	reference: SegmentReference;
	fromText?: string;
}): ProjectSegmentSummary | null {
	let candidates = findAddressableSegments({
		projectSummary,
		target: "caption",
	});
	const textQuery = (reference.content ?? fromText ?? "").trim().toLowerCase();
	if (textQuery.length > 0) {
		candidates = candidates.filter((segment) =>
			segment.text_content.toLowerCase().includes(textQuery),
		);
	}
	if (candidates.length === 0) {
		return null;
	}
	if (reference.useLast) {
		return candidates.at(-1) ?? null;
	}

	const occurrence = reference.occurrence ?? 1;
	return candidates[occurrence - 1] ?? null;
}

function mapTargetToKind({
	target,
}: {
	target: SegmentReferenceTarget;
}): ChatSegmentKind | null {
	if (target === "clip" || target === "segment") {
		return "video";
	}
	if (target === "caption") {
		return "caption";
	}
	if (target === "text" || target === "overlay") {
		return "text-overlay";
	}
	return null;
}
