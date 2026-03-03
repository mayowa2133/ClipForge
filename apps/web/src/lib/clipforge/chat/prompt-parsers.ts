import type { OverlayTextPosition } from "@/types/clipforge";

export interface ParsedTextOverlayRequest {
	text: string;
	position: OverlayTextPosition;
	start_ms: number;
	end_ms: number;
}

export interface ParsedPhraseCutRequest {
	phrase: string;
	occurrence: number;
}

export interface ParsedPhraseBrollRequest {
	assetName: string;
	phrase: string;
	duration_ms: number | null;
	occurrence: number;
}

export function parseOrdinalOccurrence({ text }: { text: string }): number {
	if (/\bthird time\b/.test(text)) return 3;
	if (/\bsecond time\b/.test(text)) return 2;
	if (/\bfirst time\b/.test(text)) return 1;
	return 1;
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
		text.match(/\badd\s+(?:a\s+)?(?:text|caption)\s+["']([^"']+)["']/i);
	if (!contentMatch) return null;

	if (
		!/(?:\badd\b.*\b(?:text|caption)\b|\bput\s+["'])/i.test(text)
	) {
		return null;
	}

	const position: OverlayTextPosition =
		/\bbottom\b/.test(normalized)
			? "bottom"
			: /\bcenter\b|\bmiddle\b/.test(normalized)
				? "center"
				: "top";

	const anchorMatch = text.match(/\b(?:at|from)\s+(\d+(?:\.\d+)?)s?\b/i);
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
	};
}

export function parsePhraseCutRequest({
	text,
}: {
	text: string;
}): ParsedPhraseCutRequest | null {
	if (
		!/\b(cut where i say|cut when i say|remove the part where i say|remove when i say)\b/i.test(
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
