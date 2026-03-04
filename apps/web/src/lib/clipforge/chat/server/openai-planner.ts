import { CHAT_OPS_FEW_SHOT_PROMPT } from "@/lib/clipforge/chat/few-shot-prompt";
import {
	parseModelOpsPayload,
	structurallyGuardOps,
} from "@/lib/clipforge/chat/json-ops-parser";
import type {
	ChatPlannerContext,
	ChatPlannerOverrides,
	ProjectSummary,
} from "@/lib/clipforge/chat/types";

export interface ModelPlanRequest {
	userText: string;
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	overrides?: ChatPlannerOverrides;
}

export interface ModelPlanSuccess {
	ops: unknown[];
	provider: "openai";
	warnings: string[];
	rawText: string | null;
}

export interface ModelPlanError extends Error {
	status?: number;
	warnings?: string[];
	rawText?: string | null;
}

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
}): ModelPlanError {
	const error = new Error(message) as ModelPlanError;
	error.status = status;
	error.warnings = warnings;
	error.rawText = rawText;
	return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateProjectSummary(projectSummary: ProjectSummary): {
	projectSummary: ProjectSummary;
	warnings: string[];
} {
	const warnings: string[] = [];
	let segments = projectSummary.segments;
	if (segments.length > 500) {
		warnings.push("Project summary segments were truncated to 500 entries.");
		segments = segments.slice(0, 500);
	}

	let timelineWords = projectSummary.timeline_words;
	if (timelineWords.length > 5000) {
		warnings.push("Project summary timeline words were truncated to 5000 entries.");
		timelineWords = timelineWords.slice(0, 5000);
	}

	return {
		projectSummary: {
			...projectSummary,
			segments,
			timeline_words: timelineWords,
		},
		warnings,
	};
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
			if (!isRecord(content)) continue;
			if (typeof content.text === "string") {
				textParts.push(content.text);
			}
		}
	}

	return textParts.join("\n").trim();
}

export async function requestOpenAIChatPlan({
	userText,
	projectSummary,
	context,
	overrides,
}: ModelPlanRequest): Promise<ModelPlanSuccess> {
	if (typeof userText !== "string" || userText.trim().length === 0) {
		throw createPlanError({
			message: "Chat request must include userText.",
			status: 400,
		});
	}

	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw createPlanError({
			message: "OpenAI planner is not configured. Set OPENAI_API_KEY.",
			status: 503,
		});
	}

	const model = process.env.CLIPFORGE_OPENAI_MODEL ?? "gpt-4.1-mini";
	const endpoint =
		process.env.CLIPFORGE_OPENAI_ENDPOINT ?? "https://api.openai.com/v1/responses";

	const warnings: string[] = [];
	let requestUserText = userText;
	if (requestUserText.length > 2000) {
		requestUserText = requestUserText.slice(0, 2000);
		warnings.push("User prompt was truncated to 2000 characters before planning.");
	}

	const truncated = truncateProjectSummary(projectSummary);
	warnings.push(...truncated.warnings);

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
					content: CHAT_OPS_FEW_SHOT_PROMPT,
				},
				{
					role: "user",
					content: JSON.stringify({
						userText: requestUserText,
						projectSummary: truncated.projectSummary,
						context,
						overrides: overrides ?? null,
					}),
				},
			],
		}),
	});

	if (!response.ok) {
		let message = `OpenAI request failed with status ${response.status}.`;
		try {
			const payload = (await response.json()) as unknown;
			if (isRecord(payload) && typeof payload.error === "string") {
				message = payload.error;
			}
		} catch {
			// Keep default status message.
		}
		throw createPlanError({
			message,
			status: 502,
		});
	}

	const payload = (await response.json()) as unknown;
	const rawText = extractOutputText(payload);

	let parsed;
	try {
		parsed = parseModelOpsPayload(rawText);
	} catch (error) {
		throw createPlanError({
			message:
				error instanceof Error ? error.message : "Failed to parse model response.",
			status: 422,
			warnings,
			rawText,
		});
	}

	const guarded = structurallyGuardOps(parsed.ops);
	if (!guarded.ok) {
		throw createPlanError({
			message: "Model response failed structural op guardrails.",
			status: 422,
			warnings: [...warnings, ...parsed.warnings, ...guarded.warnings],
			rawText,
		});
	}

	return {
		ops: guarded.ops,
		provider: "openai",
		warnings: [...warnings, ...parsed.warnings, ...guarded.warnings],
		rawText,
	};
}
