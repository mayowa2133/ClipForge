import type { CreativeBrief } from "@/types/clipforge";
import type { ProjectSummary } from "@/lib/clipforge/chat/types";

interface CreativeBriefPlanRequest {
	userText: string;
	heuristicBrief: CreativeBrief;
	projectSummary: ProjectSummary;
}

export interface CreativeBriefPlanSuccess {
	brief: CreativeBrief;
	provider: "openai";
	warnings: string[];
	rawText: string | null;
}

export interface CreativeBriefPlanError extends Error {
	status?: number;
	warnings?: string[];
	rawText?: string | null;
}

const CREATIVE_BRIEF_SYSTEM_PROMPT = `You produce JSON only for ClipForge short-form video draft planning.

Return a single JSON object with this shape:
{
  "goal": "viral-tiktok" | "vlog" | "luxury-routine" | "talking-head" | "product-highlight",
  "tone": "clean" | "bold" | "luxury" | "energetic" | "minimal",
  "durationTargetS": number | null,
  "captionStyleId": string | null,
  "overlayStyleVariantId": string | null,
  "motionPresetId": string | null,
  "beatDivision": 1 | 2 | 4 | null,
  "versionTargets": Array<"9:16" | "1:1" | "16:9">,
  "trendSoundReferenceId": string | null,
  "notes": string | null
}

Use the heuristic brief as a safe default. Only change fields when the user prompt or project context clearly supports it. Do not invent media IDs or trend sound IDs.`;

function createPlanError({
	message,
	status,
	warnings,
	rawText,
}: {
	message: string;
	status: number;
	warnings?: string[];
	rawText?: string | null;
}): CreativeBriefPlanError {
	const error = new Error(message) as CreativeBriefPlanError;
	error.status = status;
	error.warnings = warnings;
	error.rawText = rawText;
	return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractOutputText(payload: unknown): string {
	if (!isRecord(payload)) return "";
	if (typeof payload.output_text === "string") {
		return payload.output_text;
	}

	const output = payload.output;
	if (!Array.isArray(output)) return "";

	const textParts: string[] = [];
	for (const item of output) {
		if (!isRecord(item) || !Array.isArray(item.content)) continue;
		for (const content of item.content) {
			if (isRecord(content) && typeof content.text === "string") {
				textParts.push(content.text);
			}
		}
	}
	return textParts.join("\n").trim();
}

function parseJsonObject({ rawText }: { rawText: string }): Record<string, unknown> {
	const trimmed = rawText.trim();
	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	const candidate = fenced?.[1]?.trim() ?? trimmed;
	const parsed = JSON.parse(candidate) as unknown;
	if (!isRecord(parsed)) {
		throw new Error("Creative brief planner returned non-object JSON.");
	}
	return parsed;
}

function readEnum<T extends string>({
	value,
	allowed,
	fallback,
}: {
	value: unknown;
	allowed: readonly T[];
	fallback: T;
}): T {
	return typeof value === "string" && allowed.includes(value as T)
		? (value as T)
		: fallback;
}

function readNullableString({
	value,
	fallback,
}: {
	value: unknown;
	fallback: string | null;
}): string | null {
	if (value === null) return null;
	return typeof value === "string" ? value : fallback;
}

function sanitizeCreativeBrief({
	candidate,
	fallback,
}: {
	candidate: Record<string, unknown>;
	fallback: CreativeBrief;
}): CreativeBrief {
	const targets = Array.isArray(candidate.versionTargets)
		? candidate.versionTargets.filter(
				(value): value is CreativeBrief["versionTargets"][number] =>
					value === "9:16" || value === "1:1" || value === "16:9",
			)
		: fallback.versionTargets;

	const durationTarget =
		typeof candidate.durationTargetS === "number" &&
		Number.isFinite(candidate.durationTargetS)
			? Math.max(5, Math.min(90, Math.round(candidate.durationTargetS)))
			: candidate.durationTargetS === null
				? null
				: fallback.durationTargetS;

	const beatDivision =
		candidate.beatDivision === 1 ||
		candidate.beatDivision === 2 ||
		candidate.beatDivision === 4 ||
		candidate.beatDivision === null
			? candidate.beatDivision
			: fallback.beatDivision;

	return {
		goal: readEnum({
			value: candidate.goal,
			allowed: [
				"viral-tiktok",
				"vlog",
				"luxury-routine",
				"talking-head",
				"product-highlight",
			],
			fallback: fallback.goal,
		}),
		tone: readEnum({
			value: candidate.tone,
			allowed: ["clean", "bold", "luxury", "energetic", "minimal"],
			fallback: fallback.tone,
		}),
		durationTargetS: durationTarget,
		captionStyleId: readNullableString({
			value: candidate.captionStyleId,
			fallback: fallback.captionStyleId,
		}),
		overlayStyleVariantId: readNullableString({
			value: candidate.overlayStyleVariantId,
			fallback: fallback.overlayStyleVariantId,
		}),
		motionPresetId: readNullableString({
			value: candidate.motionPresetId,
			fallback: fallback.motionPresetId,
		}),
		beatDivision,
		versionTargets: targets.length > 0 ? targets : fallback.versionTargets,
		trendSoundReferenceId: readNullableString({
			value: candidate.trendSoundReferenceId,
			fallback: fallback.trendSoundReferenceId ?? null,
		}),
		notes: readNullableString({
			value: candidate.notes,
			fallback: fallback.notes,
		}),
	};
}

export async function requestOpenAICreativeBrief({
	userText,
	heuristicBrief,
	projectSummary,
}: CreativeBriefPlanRequest): Promise<CreativeBriefPlanSuccess> {
	if (typeof userText !== "string" || userText.trim().length === 0) {
		throw createPlanError({
			message: "Creative brief request must include userText.",
			status: 400,
		});
	}

	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw createPlanError({
			message: "OpenAI creative brief planner is not configured. Set OPENAI_API_KEY.",
			status: 503,
		});
	}

	const warnings: string[] = [];
	const model = process.env.CLIPFORGE_OPENAI_MODEL ?? "gpt-4.1-mini";
	const endpoint =
		process.env.CLIPFORGE_OPENAI_ENDPOINT ?? "https://api.openai.com/v1/responses";
	const requestUserText =
		userText.length > 2000 ? userText.slice(0, 2000) : userText;
	if (requestUserText.length !== userText.length) {
		warnings.push("User prompt was truncated to 2000 characters before creative planning.");
	}

	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			input: [
				{
					role: "system",
					content: CREATIVE_BRIEF_SYSTEM_PROMPT,
				},
				{
					role: "user",
					content: JSON.stringify({
						userText: requestUserText,
						heuristicBrief,
						projectSummary: {
							total_duration_s: projectSummary.total_duration_s,
							segment_count: projectSummary.segments.length,
							current_scene_segments:
								projectSummary.current_scene_segments.slice(0, 60),
							version_pack: projectSummary.version_pack,
							trend_reference_summary: projectSummary.trend_reference_summary,
							active_reference_video: projectSummary.active_reference_video,
							footage_match_readiness: projectSummary.footage_match_readiness,
						},
					}),
				},
			],
		}),
	});

	if (!response.ok) {
		let message = `OpenAI creative brief request failed with status ${response.status}.`;
		try {
			const payload = (await response.json()) as unknown;
			if (isRecord(payload) && typeof payload.error === "string") {
				message = payload.error;
			}
		} catch {
			// Keep default status message.
		}
		throw createPlanError({ message, status: 502 });
	}

	const payload = (await response.json()) as unknown;
	const rawText = extractOutputText(payload);
	try {
		const parsed = parseJsonObject({ rawText });
		return {
			brief: sanitizeCreativeBrief({
				candidate: parsed,
				fallback: heuristicBrief,
			}),
			provider: "openai",
			warnings,
			rawText,
		};
	} catch (error) {
		throw createPlanError({
			message:
				error instanceof Error
					? error.message
					: "Failed to parse creative brief model response.",
			status: 422,
			warnings,
			rawText,
		});
	}
}
