import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { buildProjectSummaryFixture } from "@/lib/clipforge/__tests__/fixtures";
import { AnthropicChatOpsProvider } from "@/lib/clipforge/chat/providers/anthropic";
import type { ChatPlannerContext, ProjectSummary } from "@/lib/clipforge/chat";

const summary: ProjectSummary = buildProjectSummaryFixture();

const context: ChatPlannerContext = {
	playhead_ms: 3000,
	selected_segment_ids: ["seg-1"],
	active_scene_id: "scene-main",
};

const originalFetch = globalThis.fetch;

function setFetchMock(handler: (...args: any[]) => any) {
	globalThis.fetch = handler as typeof fetch;
}

describe("AnthropicChatOpsProvider", () => {
	beforeEach(() => {
		setFetchMock(mock());
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("maps a successful route response into a structured proposal", async () => {
		let requestBody = "";
		setFetchMock(mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
			requestBody = typeof init?.body === "string" ? init.body : "";
			return new Response(
				JSON.stringify({
					ops: [
						{
							type: "MAKE_VERSION",
							duration_target_s: 25,
							aggressiveness: 0.7,
						},
					],
					provider: "anthropic",
					warnings: ["Truncated timeline words."],
					rawText: "[...]",
				}),
				{ status: 200 },
			);
		}));

		const provider = new AnthropicChatOpsProvider();
		const result = await provider.proposeEdits({
			userText: "make it shorter",
			projectSummary: summary,
			context,
		});

		expect(result.provider).toBe("anthropic");
		expect(result.ops).toHaveLength(1);
		expect(result.warnings).toEqual(["Truncated timeline words."]);
		expect(result.fallbackUsed).toBe(false);
		expect(result.clarification).toBeNull();
	});

	test("sends provider: anthropic in the request body", async () => {
		let requestBody = "";
		setFetchMock(mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
			requestBody = typeof init?.body === "string" ? init.body : "";
			return new Response(
				JSON.stringify({
					ops: [],
					provider: "anthropic",
				}),
				{ status: 200 },
			);
		}));

		const provider = new AnthropicChatOpsProvider();
		await provider.proposeEdits({
			userText: "test",
			projectSummary: summary,
			context,
		});

		expect(requestBody).toContain('"provider":"anthropic"');
	});

	test("sends context fields in the request body", async () => {
		let requestBody = "";
		setFetchMock(mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
			requestBody = typeof init?.body === "string" ? init.body : "";
			return new Response(
				JSON.stringify({
					ops: [],
					provider: "anthropic",
				}),
				{ status: 200 },
			);
		}));

		const provider = new AnthropicChatOpsProvider();
		await provider.proposeEdits({
			userText: "anything",
			projectSummary: summary,
			context,
		});

		expect(requestBody).toContain('"playhead_ms":3000');
		expect(requestBody).toContain('"selected_segment_ids":["seg-1"]');
	});

	test("posts to the default route path", async () => {
		let requestUrl = "";
		setFetchMock(mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
			requestUrl = typeof input === "string" ? input : input.toString();
			return new Response(
				JSON.stringify({ ops: [], provider: "anthropic" }),
				{ status: 200 },
			);
		}));

		const provider = new AnthropicChatOpsProvider();
		await provider.proposeEdits({
			userText: "test",
			projectSummary: summary,
			context,
		});

		expect(requestUrl).toBe("/api/clipforge/chat/plan");
	});

	test("respects custom route path", async () => {
		let requestUrl = "";
		setFetchMock(mock(async (input: RequestInfo | URL, _init?: RequestInit) => {
			requestUrl = typeof input === "string" ? input : input.toString();
			return new Response(
				JSON.stringify({ ops: [], provider: "anthropic" }),
				{ status: 200 },
			);
		}));

		const provider = new AnthropicChatOpsProvider({
			routePath: "/custom/plan",
		});
		await provider.proposeEdits({
			userText: "test",
			projectSummary: summary,
			context,
		});

		expect(requestUrl).toBe("/custom/plan");
	});

	test("throws on route failures", async () => {
		setFetchMock(mock(async () =>
			new Response(JSON.stringify({ error: "Planner unavailable" }), {
				status: 503,
			}),
		));

		const provider = new AnthropicChatOpsProvider();
		await expect(
			provider.proposeEdits({
				userText: "anything",
				projectSummary: summary,
				context,
			}),
		).rejects.toThrow("Planner unavailable");
	});

	test("throws generic message when error response has no error field", async () => {
		setFetchMock(mock(async () =>
			new Response(JSON.stringify({}), { status: 500 }),
		));

		const provider = new AnthropicChatOpsProvider();
		await expect(
			provider.proposeEdits({
				userText: "anything",
				projectSummary: summary,
				context,
			}),
		).rejects.toThrow("Anthropic planner request failed with status 500.");
	});

	test("throws on invalid payloads", async () => {
		setFetchMock(mock(async () =>
			new Response(JSON.stringify({ provider: "anthropic" }), { status: 200 }),
		));

		const provider = new AnthropicChatOpsProvider();
		await expect(
			provider.proposeEdits({
				userText: "anything",
				projectSummary: summary,
				context,
			}),
		).rejects.toThrow("Anthropic planner returned an invalid payload.");
	});

	test("handles null rawText in the response", async () => {
		setFetchMock(mock(async () =>
			new Response(
				JSON.stringify({
					ops: [{ type: "MAKE_VERSION", duration_target_s: 10, aggressiveness: 0.5 }],
					provider: "anthropic",
					rawText: null,
				}),
				{ status: 200 },
			),
		));

		const provider = new AnthropicChatOpsProvider();
		const result = await provider.proposeEdits({
			userText: "test",
			projectSummary: summary,
			context,
		});

		expect(result.rawText).toBeNull();
	});

	test("filters non-string warnings from the response", async () => {
		setFetchMock(mock(async () =>
			new Response(
				JSON.stringify({
					ops: [],
					provider: "anthropic",
					warnings: ["valid warning", 42, null, "another warning"],
				}),
				{ status: 200 },
			),
		));

		const provider = new AnthropicChatOpsProvider();
		const result = await provider.proposeEdits({
			userText: "test",
			projectSummary: summary,
			context,
		});

		expect(result.warnings).toEqual(["valid warning", "another warning"]);
	});
});
