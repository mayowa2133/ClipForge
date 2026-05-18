import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fetchChatPlannerHealth } from "@/lib/clipforge/chat";

const originalFetch = globalThis.fetch;

function setFetchMock(handler: (...args: any[]) => any) {
	globalThis.fetch = handler as typeof fetch;
}

describe("fetchChatPlannerHealth", () => {
	beforeEach(() => {
		setFetchMock(mock());
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("parses a valid health payload", async () => {
		setFetchMock(mock(async () =>
			new Response(
				JSON.stringify({
					modelRouteAvailable: true,
					activeProvider: "anthropic",
					anthropicConfigured: true,
					openaiConfigured: true,
					status: "ready",
					message: "anthropic planner is configured and ready.",
					checkedAt: "2026-03-03T10:00:00.000Z",
				}),
				{ status: 200 },
			),
		));

		await expect(fetchChatPlannerHealth()).resolves.toEqual({
			modelRouteAvailable: true,
			activeProvider: "anthropic",
			anthropicConfigured: true,
			openaiConfigured: true,
			status: "ready",
			message: "anthropic planner is configured and ready.",
			checkedAt: "2026-03-03T10:00:00.000Z",
		});
	});

	test("throws on malformed payloads", async () => {
		setFetchMock(mock(async () =>
			new Response(JSON.stringify({ status: "ready" }), { status: 200 }),
		));

		await expect(fetchChatPlannerHealth()).rejects.toThrow(
			"Planner health returned an invalid payload.",
		);
	});

	test("throws on non-2xx responses", async () => {
		setFetchMock(mock(async () =>
			new Response(JSON.stringify({ error: "Planner unavailable" }), {
				status: 503,
			}),
		));

		await expect(fetchChatPlannerHealth()).rejects.toThrow("Planner unavailable");
	});
});
