import { isKnownTimelineOpType } from "@/lib/clipforge/timeline-ops-schema";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripCodeFences(text: string): string {
	const trimmed = text.trim();
	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return fenced?.[1]?.trim() ?? trimmed;
}

export function extractJsonArrayCandidate(text: string): string | null {
	const input = stripCodeFences(text);
	const startIndex = input.indexOf("[");
	if (startIndex < 0) return null;

	let depth = 0;
	let inString = false;
	let isEscaped = false;

	for (let index = startIndex; index < input.length; index += 1) {
		const char = input[index];
		if (!char) continue;

		if (inString) {
			if (isEscaped) {
				isEscaped = false;
				continue;
			}
			if (char === "\\") {
				isEscaped = true;
				continue;
			}
			if (char === "\"") {
				inString = false;
			}
			continue;
		}

		if (char === "\"") {
			inString = true;
			continue;
		}

		if (char === "[") {
			depth += 1;
			continue;
		}

		if (char === "]") {
			depth -= 1;
			if (depth === 0) {
				return input.slice(startIndex, index + 1);
			}
		}
	}

	return null;
}

export function parseModelOpsPayload(text: string): {
	ops: unknown[];
	warnings: string[];
	rawText: string;
} {
	const candidate = extractJsonArrayCandidate(text);
	if (!candidate) {
		throw new Error("Model response did not contain a JSON array.");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(candidate);
	} catch {
		throw new Error("Model response did not contain valid JSON.");
	}

	if (!Array.isArray(parsed)) {
		throw new Error("Model response JSON payload must be an array.");
	}

	const warnings: string[] = [];
	if (candidate.trim() !== stripCodeFences(text).trim()) {
		warnings.push("Model response included extra formatting; extracted the first JSON array.");
	}

	return {
		ops: parsed,
		warnings,
		rawText: text,
	};
}

export function structurallyGuardOps(ops: unknown[]): {
	ok: boolean;
	ops: unknown[];
	warnings: string[];
} {
	const warnings: string[] = [];
	if (!Array.isArray(ops)) {
		return {
			ok: false,
			ops: [],
			warnings: ["Model response payload was not an array."],
		};
	}

	if (ops.length > 8) {
		return {
			ok: false,
			ops: [],
			warnings: ["Model response exceeded the maximum allowed op count (8)."],
		};
	}

	for (const candidate of ops) {
		if (!isRecord(candidate)) {
			return {
				ok: false,
				ops: [],
				warnings: ["Model response contained a non-object op entry."],
			};
		}
		if (!isKnownTimelineOpType(candidate.type)) {
			return {
				ok: false,
				ops: [],
				warnings: [
					`Model response used an unsupported op type: ${String(candidate.type)}`,
				],
			};
		}
	}

	if (ops.length === 0) {
		warnings.push("Model returned no ops.");
	}

	return {
		ok: true,
		ops,
		warnings,
	};
}
