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
		openaiConfigured,
		endpointConfigured,
		defaultModel,
		status,
		message,
		checkedAt,
	} = payload;

	if (
		typeof modelRouteAvailable !== "boolean" ||
		typeof openaiConfigured !== "boolean" ||
		typeof endpointConfigured !== "boolean" ||
		!(typeof defaultModel === "string" || defaultModel === null) ||
		!isHealthStatus(status) ||
		typeof message !== "string" ||
		typeof checkedAt !== "string"
	) {
		throw new Error("Planner health returned an invalid payload.");
	}

	return {
		modelRouteAvailable,
		openaiConfigured,
		endpointConfigured,
		defaultModel,
		status,
		message,
		checkedAt,
	};
}
