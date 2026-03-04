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

export type SegmentReferenceMode =
	| "explicit"
	| "selection"
	| "playhead"
	| "carry-over";

export interface SegmentReference {
	target: SegmentReferenceTarget;
	mode?: SegmentReferenceMode;
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

export function findSegmentReferenceCandidates({
	projectSummary,
	reference,
}: {
	projectSummary: Pick<ProjectSummary, "segments" | "timeline_words">;
	reference: SegmentReference;
}): ProjectSegmentSummary[] {
	if (reference.mode && reference.mode !== "explicit") {
		return [];
	}
	if (reference.phrase) {
		const matches = findPhraseOccurrences({
			projectSummary,
			phrase: reference.phrase,
		});
		if (matches.length === 0) {
			return [];
		}

		if (reference.useLast) {
			const match = matches.at(-1);
			return match
				? findEnclosingVideoSegments({
						projectSummary,
						startMs: match.start_ms,
					}).slice(0, 1)
				: [];
		}

		if (typeof reference.occurrence === "number") {
			const match = matches.find((item) => item.occurrence === reference.occurrence);
			return match
				? findEnclosingVideoSegments({
						projectSummary,
						startMs: match.start_ms,
					}).slice(0, 1)
				: [];
		}

		const seen = new Set<string>();
		const candidates: ProjectSegmentSummary[] = [];
		for (const match of matches) {
			for (const segment of findEnclosingVideoSegments({
				projectSummary,
				startMs: match.start_ms,
			})) {
				if (seen.has(segment.segment_id)) continue;
				seen.add(segment.segment_id);
				candidates.push(segment);
			}
		}
		return candidates;
	}

	const candidates = findAddressableSegments({
		projectSummary,
		target: reference.target,
	});
	if (candidates.length === 0) {
		return [];
	}
	if (reference.useLast) {
		const match = candidates.at(-1);
		return match ? [match] : [];
	}
	if (typeof reference.occurrence === "number" && reference.occurrence > 0) {
		const match = candidates[reference.occurrence - 1];
		return match ? [match] : [];
	}
	return candidates;
}

export function findCaptionReferenceCandidates({
	projectSummary,
	reference,
	fromText,
}: {
	projectSummary: Pick<ProjectSummary, "segments">;
	reference: SegmentReference;
	fromText?: string;
}): ProjectSegmentSummary[] {
	if (reference.mode && reference.mode !== "explicit") {
		return [];
	}
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
		return [];
	}
	if (reference.useLast) {
		const match = candidates.at(-1);
		return match ? [match] : [];
	}
	if (typeof reference.occurrence === "number" && reference.occurrence > 0) {
		const match = candidates[reference.occurrence - 1];
		return match ? [match] : [];
	}
	return candidates;
}

export function resolveSegmentReference({
	projectSummary,
	reference,
}: {
	projectSummary: Pick<ProjectSummary, "segments" | "timeline_words">;
	reference: SegmentReference;
}): ProjectSegmentSummary | null {
	const candidates = findSegmentReferenceCandidates({
		projectSummary,
		reference,
	});
	return candidates.length === 1 ? candidates[0] : null;
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
	const candidates = findCaptionReferenceCandidates({
		projectSummary,
		reference,
		fromText,
	});
	return candidates.length === 1 ? candidates[0] : null;
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

function findEnclosingVideoSegments({
	projectSummary,
	startMs,
}: {
	projectSummary: Pick<ProjectSummary, "segments">;
	startMs: number;
}): ProjectSegmentSummary[] {
	return projectSummary.segments
		.filter(
			(segment) =>
				segment.segment_kind === "video" &&
				startMs >= segment.start_ms &&
				startMs < segment.end_ms,
		)
		.sort((a, b) => a.start_ms - b.start_ms);
}
