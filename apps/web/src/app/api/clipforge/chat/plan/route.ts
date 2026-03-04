import { NextResponse } from "next/server";
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

export async function POST(request: Request) {
	try {
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

		const result = await requestOpenAIChatPlan({
			userText,
			projectSummary: projectSummary as unknown as ProjectSummary,
			context,
			overrides,
		});

		return NextResponse.json(result);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "OpenAI chat planning failed.";
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
	return Object.entries(value.forced_segment_ids_by_reference).every(
		([key, segmentId]) => typeof key === "string" && typeof segmentId === "string",
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
