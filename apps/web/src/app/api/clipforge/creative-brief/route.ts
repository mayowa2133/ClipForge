import { NextResponse } from "next/server";
import { requestOpenAICreativeBrief } from "@/lib/clipforge/chat/server/creative-brief-planner";
import type { CreativeBrief } from "@/types/clipforge";
import type { ProjectSummary } from "@/lib/clipforge/chat/types";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCreativeBrief(value: unknown): value is CreativeBrief {
	if (!isRecord(value)) return false;
	return (
		typeof value.goal === "string" &&
		typeof value.tone === "string" &&
		(typeof value.durationTargetS === "number" || value.durationTargetS === null) &&
		(typeof value.captionStyleId === "string" || value.captionStyleId === null) &&
		(typeof value.overlayStyleVariantId === "string" ||
			value.overlayStyleVariantId === null) &&
		(typeof value.motionPresetId === "string" || value.motionPresetId === null) &&
		(value.beatDivision === 1 ||
			value.beatDivision === 2 ||
			value.beatDivision === 4 ||
			value.beatDivision === null) &&
		Array.isArray(value.versionTargets) &&
		(typeof value.notes === "string" || value.notes === null)
	);
}

export async function POST(request: Request) {
	try {
		const body = (await request.json()) as unknown;
		if (!isRecord(body)) {
			return NextResponse.json(
				{ error: "Creative brief payload must be an object." },
				{ status: 400 },
			);
		}

		const { userText, heuristicBrief, projectSummary } = body;
		if (
			typeof userText !== "string" ||
			!isCreativeBrief(heuristicBrief) ||
			!isRecord(projectSummary)
		) {
			return NextResponse.json(
				{
					error:
						"Creative brief payload must include userText, heuristicBrief, and projectSummary.",
				},
				{ status: 400 },
			);
		}

		const result = await requestOpenAICreativeBrief({
			userText,
			heuristicBrief,
			projectSummary: projectSummary as unknown as ProjectSummary,
		});

		return NextResponse.json(result);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "OpenAI creative brief planning failed.";
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
