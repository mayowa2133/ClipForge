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

export interface AnthropicPlanRequest {
	userText: string;
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	overrides?: ChatPlannerOverrides;
}

export interface AnthropicPlanSuccess {
	ops: unknown[];
	provider: "anthropic";
	warnings: string[];
	rawText: string | null;
}

export interface AnthropicPlanError extends Error {
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
}): AnthropicPlanError {
	const error = new Error(message) as AnthropicPlanError;
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

function extractAnthropicText(payload: unknown): string {
	if (!isRecord(payload)) return "";
	const content = payload.content;
	if (!Array.isArray(content)) return "";

	const textParts: string[] = [];
	for (const block of content) {
		if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
			textParts.push(block.text);
		}
	}
	return textParts.join("\n").trim();
}

export async function requestAnthropicChatPlan({
	userText,
	projectSummary,
	context,
	overrides,
}: AnthropicPlanRequest): Promise<AnthropicPlanSuccess> {
	if (typeof userText !== "string" || userText.trim().length === 0) {
		throw createPlanError({
			message: "Chat request must include userText.",
			status: 400,
		});
	}

	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw createPlanError({
			message: "Anthropic planner is not configured. Set ANTHROPIC_API_KEY.",
			status: 503,
		});
	}

	const model = process.env.CLIPFORGE_ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

	const warnings: string[] = [];
	let requestUserText = userText;
	if (requestUserText.length > 2000) {
		requestUserText = requestUserText.slice(0, 2000);
		warnings.push("User prompt was truncated to 2000 characters before planning.");
	}

	const truncated = truncateProjectSummary(projectSummary);
	warnings.push(...truncated.warnings);

	const response = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			max_tokens: 2048,
			system: CHAT_OPS_FEW_SHOT_PROMPT,
			messages: [
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
		let message = `Anthropic request failed with status ${response.status}.`;
		try {
			const payload = (await response.json()) as unknown;
			if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
				message = payload.error.message;
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
	const rawText = extractAnthropicText(payload);

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
		provider: "anthropic",
		warnings: [...warnings, ...parsed.warnings, ...guarded.warnings],
		rawText,
	};
}
