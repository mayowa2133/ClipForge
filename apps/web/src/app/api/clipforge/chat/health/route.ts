import { NextResponse } from "next/server";

export const runtime = "nodejs";

function hasValue(value: string | undefined): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

export async function GET() {
	try {
		const anthropicConfigured = hasValue(process.env.ANTHROPIC_API_KEY);
		const openaiConfigured = hasValue(process.env.OPENAI_API_KEY);

		const activeProvider: "anthropic" | "openai" | null = anthropicConfigured
			? "anthropic"
			: openaiConfigured
				? "openai"
				: null;

		const status = activeProvider ? "ready" : "degraded";
		const message = activeProvider
			? `${activeProvider} planner is configured and ready.`
			: "No LLM planner configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.";

		return NextResponse.json({
			modelRouteAvailable: true,
			activeProvider,
			anthropicConfigured,
			openaiConfigured,
			status,
			message,
			checkedAt: new Date().toISOString(),
		});
	} catch {
		return NextResponse.json(
			{
				modelRouteAvailable: false,
				activeProvider: null,
				anthropicConfigured: false,
				openaiConfigured: false,
				status: "unavailable",
				message: "Unable to check planner health.",
				checkedAt: new Date().toISOString(),
			},
			{ status: 200 },
		);
	}
}
