import { NextResponse } from "next/server";
import { requestOpenAIChatPlan } from "@/lib/clipforge/chat/server/openai-planner";
import type { ProjectSummary } from "@/lib/clipforge/chat/types";

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
		if (typeof userText !== "string" || !isRecord(projectSummary)) {
			return NextResponse.json(
				{ error: "Chat plan payload must include userText and projectSummary." },
				{ status: 400 },
			);
		}

		const result = await requestOpenAIChatPlan({
			userText,
			projectSummary: projectSummary as unknown as ProjectSummary,
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
