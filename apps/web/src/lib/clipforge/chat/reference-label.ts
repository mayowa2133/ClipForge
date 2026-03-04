import type { SegmentReference } from "@/lib/clipforge/segment-resolution";

export function buildReferenceLabel({
	reference,
	fromText,
}: {
	reference: SegmentReference;
	fromText?: string;
}): string {
	if (reference.mode === "selection") {
		return `selection:${reference.target}`;
	}
	if (reference.mode === "playhead") {
		return `playhead:${reference.target}`;
	}
	if (reference.mode === "carry-over") {
		return `carry-over:${reference.target}`;
	}
	if (reference.phrase) {
		return `phrase:${reference.target}:${reference.phrase.toLowerCase()}`;
	}
	if (reference.content) {
		return `content:${reference.target}:${reference.content.toLowerCase()}`;
	}
	if (fromText && reference.target === "caption") {
		return `caption-match:${fromText.toLowerCase()}`;
	}
	return `explicit:${reference.target}:${reference.occurrence ?? "any"}:${
		reference.useLast ? "last" : "no-last"
	}`;
}
