import type { ChatPlannerHealth } from "@/lib/clipforge/chat/types";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHealthStatus(value: unknown): value is ChatPlannerHealth["status"] {
	return value === "ready" || value === "degraded" || value === "unavailable";
}

export async function fetchChatPlannerHealth(): Promise<ChatPlannerHealth> {
	const response = await fetch("/api/clipforge/chat/health", {
		method: "GET",
	});

	if (!response.ok) {
		let message = "Unable to check planner health.";
		try {
			const body = (await response.json()) as unknown;
			if (isRecord(body) && typeof body.error === "string") {
				message = body.error;
			}
		} catch {
			// Keep the default message for malformed error payloads.
		}
		throw new Error(message);
	}

	const payload = (await response.json()) as unknown;
	if (!isRecord(payload)) {
		throw new Error("Planner health returned an invalid payload.");
	}

	const {
		modelRouteAvailable,
		activeProvider,
		anthropicConfigured,
		openaiConfigured,
		status,
		message,
		checkedAt,
	} = payload;

	if (
		typeof modelRouteAvailable !== "boolean" ||
		!(activeProvider === "anthropic" || activeProvider === "openai" || activeProvider === null) ||
		typeof anthropicConfigured !== "boolean" ||
		typeof openaiConfigured !== "boolean" ||
		!isHealthStatus(status) ||
		typeof message !== "string" ||
		typeof checkedAt !== "string"
	) {
		throw new Error("Planner health returned an invalid payload.");
	}

	return {
		modelRouteAvailable,
		activeProvider,
		anthropicConfigured,
		openaiConfigured,
		status,
		message,
		checkedAt,
	};
}
