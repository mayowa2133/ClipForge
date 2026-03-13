import type {
	ChatClarificationOption,
	ChatClarificationKind,
	ChatClarificationRequest,
	ChatSegmentKind,
	ProjectSegmentSummary,
} from "./types";

function truncatePreview(text: string): string {
	const normalized = text.trim().replace(/\s+/g, " ");
	if (normalized.length <= 48) {
		return normalized;
	}
	return `${normalized.slice(0, 45)}...`;
}

export function formatTimeRangeMs(start: number, end: number): string {
	return `${formatTimeMs(start)}–${formatTimeMs(end)}`;
}

function formatTimeMs(value: number): string {
	const totalSeconds = Math.max(0, Math.floor(value / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getPreviewText(segment: ProjectSegmentSummary): string {
	if (segment.text_content.trim().length > 0) {
		return truncatePreview(segment.text_content);
	}
	if (segment.transcript_snippet.trim().length > 0) {
		return truncatePreview(segment.transcript_snippet);
	}
	return segment.segment_kind;
}

function getKindLabel(kind: ChatSegmentKind): string {
	if (kind === "caption") return "Caption";
	if (kind === "text-overlay") return "Overlay";
	if (kind === "audio") return "Audio";
	if (kind === "sticker") return "Sticker";
	return "Clip";
}

export function formatClarificationOptionLabel(
	option: Pick<ChatClarificationOption, "segment_kind" | "start_ms" | "end_ms" | "label">,
): string {
	const kindLabel = getKindLabel(option.segment_kind ?? "unknown");
	return `${kindLabel} ${option.label} · ${formatTimeRangeMs(option.start_ms ?? 0, option.end_ms ?? 0)}`;
}

export function buildClarificationRequest({
	referenceLabel,
	candidates,
}: {
	referenceLabel: string;
	candidates: ProjectSegmentSummary[];
}): ChatClarificationRequest {
	const options = candidates.map((segment, index) => {
		const option: ChatClarificationOption = {
			id: `${segment.segment_id}-${index + 1}`,
			value: segment.segment_id,
			label: String(index + 1),
			segment_id: segment.segment_id,
			segment_kind: segment.segment_kind,
			start_ms: segment.start_ms,
			end_ms: segment.end_ms,
			text_preview: getPreviewText(segment),
		};
		return {
			...option,
			label: formatClarificationOptionLabel(option),
		};
	});

	return {
		kind: "target",
		prompt: "Multiple timeline targets match this request. Choose one target to continue.",
		referenceLabel,
		options,
	};
}

export function buildChoiceClarificationRequest({
	kind,
	prompt,
	referenceLabel,
	options,
}: {
	kind: Exclude<ChatClarificationKind, "target">;
	prompt: string;
	referenceLabel: string;
	options: Array<Pick<ChatClarificationOption, "value" | "label" | "text_preview">>;
}): ChatClarificationRequest {
	return {
		kind,
		prompt,
		referenceLabel,
		options: options.map((option, index) => ({
			id: `${referenceLabel}:${option.value}:${index + 1}`,
			value: option.value,
			label: option.label,
			text_preview: option.text_preview,
		})),
	};
}
