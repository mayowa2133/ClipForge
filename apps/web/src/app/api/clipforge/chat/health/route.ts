import { NextResponse } from "next/server";

export const runtime = "nodejs";

function hasValue(value: string | undefined): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function isValidEndpoint(value: string | undefined): boolean {
	if (!hasValue(value)) return false;

	try {
		new URL(value as string);
		return true;
	} catch {
		return false;
	}
}

export async function GET() {
	try {
		const openaiConfigured = hasValue(process.env.OPENAI_API_KEY);
		const endpoint = process.env.CLIPFORGE_OPENAI_ENDPOINT;
		const endpointConfigured = isValidEndpoint(endpoint);
		const defaultModel = hasValue(process.env.CLIPFORGE_OPENAI_MODEL)
			? process.env.CLIPFORGE_OPENAI_MODEL?.trim() ?? null
			: null;
		const status =
			openaiConfigured && endpointConfigured ? "ready" : "degraded";
		const message =
			status === "ready"
				? "OpenAI planner is configured and ready."
				: "OpenAI planner route is available, but server configuration is incomplete.";

		return NextResponse.json({
			modelRouteAvailable: true,
			openaiConfigured,
			endpointConfigured,
			defaultModel,
			status,
			message,
			checkedAt: new Date().toISOString(),
		});
	} catch {
		return NextResponse.json(
			{
				modelRouteAvailable: false,
				openaiConfigured: false,
				endpointConfigured: false,
				defaultModel: null,
				status: "unavailable",
				message: "Unable to check planner health.",
				checkedAt: new Date().toISOString(),
			},
			{ status: 200 },
		);
	}
}
