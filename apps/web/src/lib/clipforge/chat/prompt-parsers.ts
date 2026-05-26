import type { SegmentReference } from "@/lib/clipforge/segment-resolution";
import type { OverlayTextPosition } from "@/types/clipforge";

export interface ParsedTextOverlayRequest {
	text: string;
	position: OverlayTextPosition;
	start_ms: number;
	end_ms: number;
	anchor_mode: "default" | "explicit" | "playhead";
}

export interface ParsedPhraseCutRequest {
	phrase: string;
	occurrence: number;
}

export interface ParsedGazeCutRequest {
	/** Transcript phrase after which the gaze cut should be applied. */
	afterPhrase: string;
	occurrence: number;
}

export interface ParsedPhraseBrollRequest {
	assetName: string;
	phrase: string;
	duration_ms: number | null;
	occurrence: number;
}

export interface ParsedTrimClipRequest {
	reference: SegmentReference;
	amount_ms: number;
	edge: "start" | "end";
}

export interface ParsedMoveSegmentRequest {
	reference: SegmentReference;
	absolute_to_ms: number | null;
	relative_delta_ms: number | null;
	direction: "earlier" | "later" | null;
}

export interface ParsedSwapSegmentsRequest {
	aReference: SegmentReference;
	bReference: SegmentReference;
}

export interface ParsedDeleteSegmentRequest {
	reference: SegmentReference;
}

export interface ParsedDuplicateSegmentRequest {
	reference: SegmentReference;
	to_ms: number | null;
	after_itself: boolean;
}

export interface ParsedFixCaptionTextRequest {
	reference: SegmentReference;
	from: string;
	to: string;
}

export function parseOrdinalOccurrence({ text }: { text: string }): number {
	if (/\bthird\b|\b3rd\b/.test(text)) return 3;
	if (/\bsecond\b|\b2nd\b/.test(text)) return 2;
	if (/\bfirst\b|\b1st\b/.test(text)) return 1;
	return 1;
}

function parseExplicitOrdinal({
	text,
}: {
	text: string;
}): number | undefined {
	if (!/\b(first|second|third|1st|2nd|3rd|1|2|3)\b/i.test(text)) {
		return undefined;
	}
	return parseOrdinalOccurrence({ text: text.toLowerCase() });
}

export function parseTextOverlayRequest({
	text,
}: {
	text: string;
}): ParsedTextOverlayRequest | null {
	const normalized = text.toLowerCase();
	const contentMatch =
		text.match(/that says\s+["']([^"']+)["']/i) ??
		text.match(/\bput\s+["']([^"']+)["']/i) ??
		text.match(/\badd\s+(?:a\s+|the\s+)?(?:text|caption|title|label|heading)\s+["']([^"']+)["']/i) ??
		text.match(/\bshow\s+(?:the\s+)?(?:text|title|caption)\s+["']([^"']+)["']/i);
	if (!contentMatch) return null;

	if (!/(?:\badd\b.*\b(?:text|caption|title|label|heading)\b|\bput\s+["']|\bshow\s+(?:the\s+)?(?:text|title|caption))/i.test(text)) {
		return null;
	}

	const position: OverlayTextPosition =
		/\bbottom\b/.test(normalized)
			? "bottom"
			: /\bcenter\b|\bmiddle\b/.test(normalized)
				? "center"
				: "top";

	const anchorMatch = text.match(/\b(?:at|from)\s+(\d+(?:\.\d+)?)s?\b/i);
	const hasPlayheadAnchor = /\bhere\b|\bat the playhead\b|\bat this point\b/i.test(text);
	const durationMatch = text.match(/\bfor\s+(\d+(?:\.\d+)?)s?\b/i);
	const startMs = anchorMatch ? Math.round(Number(anchorMatch[1]) * 1000) : 0;
	const durationMs = durationMatch
		? Math.round(Number(durationMatch[1]) * 1000)
		: 2500;

	return {
		text: contentMatch[1].trim(),
		position,
		start_ms: startMs,
		end_ms: startMs + Math.max(250, durationMs),
		anchor_mode: anchorMatch ? "explicit" : hasPlayheadAnchor ? "playhead" : "default",
	};
}

export function parsePhraseCutRequest({
	text,
}: {
	text: string;
}): ParsedPhraseCutRequest | null {
	if (
		!/(\bcut where i say\b|\bcut when i say\b|\bremove the part where i say\b|\bremove when i say\b)/i.test(
			text,
		)
	) {
		return null;
	}

	const phraseMatch = text.match(/["']([^"']+)["']/);
	if (!phraseMatch) return null;

	return {
		phrase: phraseMatch[1].trim(),
		occurrence: parseOrdinalOccurrence({ text: text.toLowerCase() }),
	};
}

export function parsePhraseBrollRequest({
	text,
}: {
	text: string;
}): ParsedPhraseBrollRequest | null {
	const match =
		text.match(
			/(?:add|insert)\s+(?:a\s+)?b-?roll\s+using\s+(.+?)\s+(?:when i say|over)\s+["']([^"']+)["'](?:\s+for\s+(\d+(?:\.\d+)?)s?)?/i,
		) ??
		text.match(
			/use\s+(.+?)\s+as\s+b-?roll\s+when i say\s+["']([^"']+)["'](?:\s+for\s+(\d+(?:\.\d+)?)s?)?/i,
		);
	if (!match) return null;

	const durationMs =
		match[3] && Number.isFinite(Number(match[3]))
			? Math.round(Number(match[3]) * 1000)
			: null;

	return {
		assetName: match[1].trim(),
		phrase: match[2].trim(),
		duration_ms: durationMs,
		occurrence: parseOrdinalOccurrence({ text: text.toLowerCase() }),
	};
}

export function parseTrimClipRequest({
	text,
}: {
	text: string;
}): ParsedTrimClipRequest | null {
	const match = text.match(
		/^trim\s+(.+?)\s+by\s+(\d+(?:\.\d+)?)s?\s+at\s+the\s+(start|end)$/i,
	);
	if (!match) return null;

	const reference = parseSegmentReferenceText({ text: match[1] });
	if (!reference) return null;

	return {
		reference,
		amount_ms: Math.round(Number(match[2]) * 1000),
		edge: match[3].toLowerCase() === "start" ? "start" : "end",
	};
}

export function parseMoveSegmentRequest({
	text,
}: {
	text: string;
}): ParsedMoveSegmentRequest | null {
	const absoluteMatch = text.match(/^move\s+(.+?)\s+to\s+(\d+(?:\.\d+)?)s?$/i);
	if (absoluteMatch) {
		const reference = parseSegmentReferenceText({ text: absoluteMatch[1] });
		if (!reference) return null;
		return {
			reference,
			absolute_to_ms: Math.round(Number(absoluteMatch[2]) * 1000),
			relative_delta_ms: null,
			direction: null,
		};
	}

	const relativeMatch = text.match(
		/^move\s+(.+?)\s+(earlier|later)\s+by\s+(\d+(?:\.\d+)?)s?$/i,
	);
	if (!relativeMatch) return null;

	const reference = parseSegmentReferenceText({ text: relativeMatch[1] });
	if (!reference) return null;

	return {
		reference,
		absolute_to_ms: null,
		relative_delta_ms: Math.round(Number(relativeMatch[3]) * 1000),
		direction: relativeMatch[2].toLowerCase() === "earlier" ? "earlier" : "later",
	};
}

export function parseSwapSegmentsRequest({
	text,
}: {
	text: string;
}): ParsedSwapSegmentsRequest | null {
	const pairedOrdinalMatch = text.match(
		/^swap\s+the\s+(first|second|third|1|2|3)\s+and\s+(first|second|third|1|2|3)\s+clips?$/i,
	);
	if (pairedOrdinalMatch) {
		const aReference = parseSegmentReferenceText({
			text: `the ${pairedOrdinalMatch[1]} clip`,
		});
		const bReference = parseSegmentReferenceText({
			text: `the ${pairedOrdinalMatch[2]} clip`,
		});
		if (!aReference || !bReference) return null;
		return { aReference, bReference };
	}

	const numberedMatch = text.match(/^swap\s+clip\s+(1|2|3|first|second|third)\s+with\s+clip\s+(1|2|3|first|second|third)$/i);
	if (numberedMatch) {
		const aReference = parseSegmentReferenceText({ text: `the ${numberedMatch[1]} clip` });
		const bReference = parseSegmentReferenceText({ text: `the ${numberedMatch[2]} clip` });
		if (!aReference || !bReference) return null;
		return { aReference, bReference };
	}

	const match = text.match(/^swap\s+(.+?)\s+(?:with|and)\s+(.+)$/i);
	if (!match) return null;

	const aReference = parseSegmentReferenceText({ text: match[1] });
	const bReference = parseSegmentReferenceText({ text: match[2] });
	if (!aReference || !bReference) return null;

	return { aReference, bReference };
}

export function parseDeleteSegmentRequest({
	text,
}: {
	text: string;
}): ParsedDeleteSegmentRequest | null {
	if (/\bremove the part where i say\b/i.test(text)) {
		return null;
	}
	const match = text.match(/^(?:delete|remove)\s+(.+)$/i);
	if (!match) return null;

	const reference = parseSegmentReferenceText({ text: match[1] });
	if (!reference) return null;

	return { reference };
}

export function parseDuplicateSegmentRequest({
	text,
}: {
	text: string;
}): ParsedDuplicateSegmentRequest | null {
	const absoluteMatch = text.match(/^duplicate\s+(.+?)\s+to\s+(\d+(?:\.\d+)?)s?$/i);
	if (absoluteMatch) {
		const reference = parseSegmentReferenceText({ text: absoluteMatch[1] });
		if (!reference) return null;
		return {
			reference,
			to_ms: Math.round(Number(absoluteMatch[2]) * 1000),
			after_itself: false,
		};
	}

	const relativeMatch = text.match(/^duplicate\s+(.+?)\s+after\s+itself$/i);
	if (!relativeMatch) return null;

	const reference = parseSegmentReferenceText({ text: relativeMatch[1] });
	if (!reference) return null;

	return {
		reference,
		to_ms: null,
		after_itself: true,
	};
}

export function parseFixCaptionTextRequest({
	text,
}: {
	text: string;
}): ParsedFixCaptionTextRequest | null {
	const replaceMatch = text.match(
		/^replace\s+["']([^"']+)["']\s+with\s+["']([^"']+)["']\s+in\s+(captions|this caption|that caption)$/i,
	);
	if (replaceMatch) {
		return {
			reference:
				replaceMatch[3].toLowerCase() === "captions"
					? { target: "caption", mode: "explicit" }
					: parseSegmentReferenceText({ text: replaceMatch[3] }) ?? {
							target: "caption",
							mode: "selection",
						},
			from: replaceMatch[1],
			to: replaceMatch[2],
		};
	}

	const changeMatch = text.match(
		/^change\s+(caption|this caption|that caption)\s+["']([^"']+)["']\s+to\s+["']([^"']+)["']$/i,
	);
	if (changeMatch) {
		return {
			reference:
				changeMatch[1].toLowerCase() === "caption"
					? { target: "caption", mode: "explicit", content: changeMatch[2] }
					: (parseSegmentReferenceText({ text: changeMatch[1] }) ?? {
							target: "caption",
							mode: "selection",
						}),
			from: changeMatch[2],
			to: changeMatch[3],
		};
	}

	const fixMatch = text.match(/^fix\s+the\s+(.+?)\s+to\s+say\s+["']([^"']+)["']$/i);
	if (!fixMatch) return null;
	const reference = parseSegmentReferenceText({ text: fixMatch[1] });
	if (!reference || reference.target !== "caption") return null;

	return {
		reference,
		from: reference.content ?? "",
		to: fixMatch[2],
	};
}

export function parseSegmentReferenceText({
	text,
}: {
	text: string;
}): SegmentReference | null {
	const trimmed = text.trim();
	if (trimmed.length === 0) return null;
	const normalized = trimmed.toLowerCase();

	if (/^(?:this|that|this clip|that clip|this segment|that segment|the selected clip)$/i.test(trimmed)) {
		return {
			target:
				/\bclip\b/.test(normalized) || /\bselected clip\b/.test(normalized)
					? "clip"
					: "segment",
			mode: "selection",
		};
	}

	if (/^(?:this caption|that caption)$/i.test(trimmed)) {
		return {
			target: "caption",
			mode: "selection",
		};
	}

	if (/^(?:it|that one)$/i.test(trimmed)) {
		return {
			target: "segment",
			mode: "carry-over",
		};
	}

	if (/^(?:here|at the playhead|at this point)$/i.test(trimmed)) {
		return {
			target: "segment",
			mode: "playhead",
		};
	}

	const phraseMatch = normalized.match(
		/^the\s+(clip|segment)\s+(?:where i say|that says)\s+["']([^"']+)["']$/i,
	);
	if (phraseMatch) {
		return {
			target: phraseMatch[1].toLowerCase() === "clip" ? "clip" : "segment",
			mode: "explicit",
			phrase: phraseMatch[2].trim(),
			occurrence: parseExplicitOrdinal({ text: normalized }),
			useLast: /\blast\b/.test(normalized),
		};
	}

	const captionContentMatch = normalized.match(
		/^the\s+(?:(first|second|third)\s+)?caption\s+(?:that says|containing)\s+["']([^"']+)["']$/i,
	);
	if (captionContentMatch) {
		return {
			target: "caption",
			mode: "explicit",
			occurrence: captionContentMatch[1]
				? parseOrdinalOccurrence({ text: captionContentMatch[1] })
				: undefined,
			content: captionContentMatch[2].trim(),
		};
	}

	const bareMatch = normalized.match(
		/^(?:the\s+)?(?:(first|second|third|last|1|2|3)\s+)?(clip|segment|caption|text|overlay|text overlay)s?$/i,
	);
	if (bareMatch) {
		const ordinalToken = bareMatch[1]?.toLowerCase();
		const nounToken = bareMatch[2].toLowerCase();
		const target =
			nounToken === "clip"
				? "clip"
				: nounToken === "caption"
					? "caption"
					: nounToken === "text" || nounToken === "overlay" || nounToken === "text overlay"
						? "overlay"
						: "segment";

		return {
			target,
			mode: "explicit",
			occurrence:
				ordinalToken && ordinalToken !== "last"
					? parseOrdinalOccurrence({ text: ordinalToken })
					: undefined,
			useLast: ordinalToken === "last",
		};
	}

	return null;
}

/**
 * Parse a request to cut/trim the section where the speaker is looking away
 * (down, off-camera, etc.) after they say a specific phrase.
 *
 * Matches patterns like:
 *   "cut where I'm looking down after I say 'X'"
 *   "remove the part where I'm still looking away after 'X'"
 *   "trim where I'm still looking down after saying 'X'"
 */
export function parseGazeCutRequest({
	text,
}: {
	text: string;
}): ParsedGazeCutRequest | null {
	// Must mention gaze-direction behaviour
	const hasGazeSignal =
		/\b(?:looking\s+(?:down|away|off[- ]?camera|off\s+camera)|not\s+looking\s+(?:at\s+(?:the\s+)?camera|up)|still\s+looking\s+(?:down|away))\b/i.test(
			text,
		);
	if (!hasGazeSignal) return null;

	// Must have "after" reference to a phrase
	const hasAfterSignal =
		/\bafter\s+(?:i\s+)?(?:say|said|saying)\b|\bafter\s+["']/i.test(text);
	if (!hasAfterSignal) return null;

	// Extract the quoted phrase. Prefer the phrase that immediately follows
	// "say/said/saying" to avoid false matches on apostrophes in contractions
	// (e.g. "I'm looking down after I say 'hey'" — 'I'm' has an apostrophe
	// that would otherwise be the first match).
	const afterSayMatch = text.match(
		/\bafter\s+(?:i\s+)?(?:say|said|saying)\s+["']([^"']{1,80})["']/i,
	);
	const afterQuoteMatch = text.match(/\bafter\s+["']([^"']{1,80})["']/i);
	// Fall back to any quoted span that's ≤ 80 chars (avoid long contraction traps)
	const anyQuoteMatch = text.match(/["']([^"']{1,80})["']/g);
	const lastQuote = anyQuoteMatch
		? anyQuoteMatch[anyQuoteMatch.length - 1]?.match(/["']([^"']+)["']/)
		: null;

	const phrase =
		(afterSayMatch?.[1] ?? afterQuoteMatch?.[1] ?? lastQuote?.[1] ?? "").trim();
	if (!phrase) return null;

	return {
		afterPhrase: phrase,
		occurrence: parseOrdinalOccurrence({ text: text.toLowerCase() }),
	};
}
