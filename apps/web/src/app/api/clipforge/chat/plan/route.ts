import { NextResponse } from "next/server";
import { aiRateLimitResponse } from "@/lib/clipforge/ai-rate-limit-guard";
import { requestAnthropicChatPlan } from "@/lib/clipforge/chat/server/anthropic-planner";
import { requestOpenAIChatPlan } from "@/lib/clipforge/chat/server/openai-planner";
import type {
	ChatPlannerContext,
	ChatPlannerOverrides,
	ProjectSummary,
} from "@/lib/clipforge/chat/types";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveProvider(requested?: string): "anthropic" | "openai" {
	if (requested === "anthropic" || requested === "openai") return requested;
	const explicit = process.env.CLIPFORGE_CHAT_PROVIDER;
	if (explicit === "anthropic" || explicit === "openai") return explicit;
	if (process.env.ANTHROPIC_API_KEY) return "anthropic";
	if (process.env.OPENAI_API_KEY) return "openai";
	return "anthropic";
}

export async function POST(request: Request) {
	try {
		const blocked = await aiRateLimitResponse(request);
		if (blocked) return blocked;

		const body = (await request.json()) as unknown;
		if (!isRecord(body)) {
			return NextResponse.json(
				{ error: "Chat plan payload must be an object." },
				{ status: 400 },
			);
		}

		const userText = body.userText;
		const projectSummary = body.projectSummary;
		const context = body.context;
		const overrides = body.overrides;
		const requestedProvider =
			typeof body.provider === "string" ? body.provider : undefined;
		if (
			typeof userText !== "string" ||
			!isRecord(projectSummary) ||
			!isPlannerContext(context) ||
			(overrides !== undefined && !isPlannerOverrides(overrides))
		) {
			return NextResponse.json(
				{
					error:
						"Chat plan payload must include userText, projectSummary, and context.",
				},
				{ status: 400 },
			);
		}

		const refinementPass =
			typeof body.refinementPass === "number" && Number.isFinite(body.refinementPass)
				? Math.max(0, Math.min(5, Math.round(body.refinementPass)))
				: 0;

		const provider = resolveProvider(requestedProvider);
		const planRequest = {
			userText,
			projectSummary: projectSummary as unknown as ProjectSummary,
			context,
			overrides,
			refinementPass,
		};

		const result =
			provider === "anthropic"
				? await requestAnthropicChatPlan(planRequest)
				: await requestOpenAIChatPlan(planRequest);

		return NextResponse.json(result);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Chat planning failed.";
		const status =
			error instanceof Error && "status" in error && typeof error.status === "number"
				? error.status
				: 500;
		const warnings =
			error instanceof Error &&
			"warnings" in error &&
			Array.isArray(error.warnings) &&
			error.warnings.every((warning) => typeof warning === "string")
				? error.warnings
				: undefined;
		const rawText =
			error instanceof Error &&
			"rawText" in error &&
			(typeof error.rawText === "string" || error.rawText === null)
				? error.rawText
				: undefined;

		return NextResponse.json(
			{
				error: message,
				warnings,
				rawText,
			},
			{ status },
		);
	}
}

function isPlannerOverrides(value: unknown): value is ChatPlannerOverrides {
	if (!isRecord(value)) {
		return false;
	}
	if (!isRecord(value.forced_segment_ids_by_reference)) {
		return false;
	}
	const segmentOverridesValid = Object.entries(value.forced_segment_ids_by_reference).every(
		([key, segmentId]) => typeof key === "string" && typeof segmentId === "string",
	);
	if (!segmentOverridesValid) {
		return false;
	}
	if (
		value.forced_choice_values_by_reference !== undefined &&
		!isRecord(value.forced_choice_values_by_reference)
	) {
		return false;
	}
	return Object.entries(value.forced_choice_values_by_reference ?? {}).every(
		([key, choiceValue]) =>
			typeof key === "string" && typeof choiceValue === "string",
	);
}

function isPlannerContext(value: unknown): value is ChatPlannerContext {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.playhead_ms === "number" &&
		Number.isFinite(value.playhead_ms) &&
		value.playhead_ms >= 0 &&
		Array.isArray(value.selected_segment_ids) &&
		value.selected_segment_ids.every((segmentId) => typeof segmentId === "string") &&
		(typeof value.active_scene_id === "string" || value.active_scene_id === null)
	);
}
