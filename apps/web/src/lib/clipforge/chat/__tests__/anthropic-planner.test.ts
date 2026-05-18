import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	buildProjectSegmentSummaryFixture,
	buildProjectSummaryFixture,
} from "@/lib/clipforge/__tests__/fixtures";
import { requestAnthropicChatPlan } from "@/lib/clipforge/chat/server/anthropic-planner";
import type { ChatPlannerContext, ProjectSummary } from "@/lib/clipforge/chat";

const summary: ProjectSummary = buildProjectSummaryFixture({
	total_duration_s: 12,
});

const context: ChatPlannerContext = {
	playhead_ms: 2000,
	selected_segment_ids: ["seg-1"],
	active_scene_id: "scene-main",
};

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.ANTHROPIC_API_KEY;
const originalModel = process.env.CLIPFORGE_ANTHROPIC_MODEL;

function restoreEnv(key: string, value: string | undefined) {
	if (typeof value === "string") {
		process.env[key] = value;
		return;
	}
	delete process.env[key];
}

function setFetchMock(handler: (...args: any[]) => any) {
	globalThis.fetch = handler as typeof fetch;
}

function anthropicSuccessResponse(text: string) {
	return new Response(
		JSON.stringify({
			id: "msg_test",
			type: "message",
			role: "assistant",
			content: [{ type: "text", text }],
			model: "claude-sonnet-4-6",
			stop_reason: "end_turn",
			usage: { input_tokens: 100, output_tokens: 50 },
		}),
		{ status: 200 },
	);
}

describe("requestAnthropicChatPlan", () => {
	beforeEach(() => {
		process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
		process.env.CLIPFORGE_ANTHROPIC_MODEL = "claude-test";
		setFetchMock(mock());
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		restoreEnv("ANTHROPIC_API_KEY", originalApiKey);
		restoreEnv("CLIPFORGE_ANTHROPIC_MODEL", originalModel);
	});

	test("returns guarded ops from a valid model response", async () => {
		setFetchMock(mock(async () =>
			anthropicSuccessResponse(
				'[{"type":"MAKE_VERSION","duration_target_s":30,"aggressiveness":0.75}]',
			),
		));

		const result = await requestAnthropicChatPlan({
			userText: "make it shorter",
			projectSummary: summary,
			context,
		});

		expect(result.provider).toBe("anthropic");
		expect(result.ops).toEqual([
			{
				type: "MAKE_VERSION",
				duration_target_s: 30,
				aggressiveness: 0.75,
			},
		]);
	});

	test("sends correct headers to the Anthropic API", async () => {
		let capturedHeaders: Record<string, string> = {};
		setFetchMock(mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const headers = init?.headers;
			if (headers && typeof headers === "object" && !Array.isArray(headers)) {
				capturedHeaders = headers as Record<string, string>;
			}
			return anthropicSuccessResponse("[]");
		}));

		await requestAnthropicChatPlan({
			userText: "test",
			projectSummary: summary,
			context,
		});

		expect(capturedHeaders["x-api-key"]).toBe("test-anthropic-key");
		expect(capturedHeaders["anthropic-version"]).toBe("2023-06-01");
		expect(capturedHeaders["Content-Type"]).toBe("application/json");
	});

	test("sends request to the correct Anthropic endpoint", async () => {
		let requestUrl = "";
		setFetchMock(mock(async (input: RequestInfo | URL) => {
			requestUrl = typeof input === "string" ? input : input.toString();
			return anthropicSuccessResponse("[]");
		}));

		await requestAnthropicChatPlan({
			userText: "test",
			projectSummary: summary,
			context,
		});

		expect(requestUrl).toBe("https://api.anthropic.com/v1/messages");
	});

	test("uses the configured model in the request body", async () => {
		let requestBody = "";
		setFetchMock(mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
			requestBody = typeof init?.body === "string" ? init.body : "";
			return anthropicSuccessResponse("[]");
		}));

		await requestAnthropicChatPlan({
			userText: "test",
			projectSummary: summary,
			context,
		});

		expect(requestBody).toContain('"model":"claude-test"');
	});

	test("throws when the api key is missing", async () => {
		delete process.env.ANTHROPIC_API_KEY;

		await expect(
			requestAnthropicChatPlan({
				userText: "make it shorter",
				projectSummary: summary,
				context,
			}),
		).rejects.toMatchObject({
			status: 503,
		});
	});

	test("throws when userText is empty", async () => {
		await expect(
			requestAnthropicChatPlan({
				userText: "",
				projectSummary: summary,
				context,
			}),
		).rejects.toMatchObject({
			status: 400,
		});
	});

	test("throws on upstream API failures", async () => {
		setFetchMock(mock(async () =>
			new Response(
				JSON.stringify({
					type: "error",
					error: { type: "overloaded_error", message: "Overloaded" },
				}),
				{ status: 529 },
			),
		));

		await expect(
			requestAnthropicChatPlan({
				userText: "make it shorter",
				projectSummary: summary,
				context,
			}),
		).rejects.toMatchObject({
			status: 502,
		});
	});

	test("extracts error message from Anthropic error response", async () => {
		setFetchMock(mock(async () =>
			new Response(
				JSON.stringify({
					type: "error",
					error: { type: "invalid_request_error", message: "Invalid model" },
				}),
				{ status: 400 },
			),
		));

		await expect(
			requestAnthropicChatPlan({
				userText: "test",
				projectSummary: summary,
				context,
			}),
		).rejects.toThrow("Invalid model");
	});

	test("throws on invalid/unparseable model output", async () => {
		setFetchMock(mock(async () =>
			anthropicSuccessResponse("This is not valid JSON at all"),
		));

		await expect(
			requestAnthropicChatPlan({
				userText: "make it shorter",
				projectSummary: summary,
				context,
			}),
		).rejects.toMatchObject({
			status: 422,
		});
	});

	test("includes rawText on parse failure errors", async () => {
		setFetchMock(mock(async () =>
			anthropicSuccessResponse("Not JSON"),
		));

		try {
			await requestAnthropicChatPlan({
				userText: "test",
				projectSummary: summary,
				context,
			});
			expect.unreachable("should have thrown");
		} catch (error: any) {
			expect(error.rawText).toBe("Not JSON");
		}
	});

	test("adds truncation warnings for oversized payloads", async () => {
		setFetchMock(mock(async () =>
			anthropicSuccessResponse("[]"),
		));

		const result = await requestAnthropicChatPlan({
			userText: "x".repeat(2100),
			projectSummary: {
				...summary,
				segments: Array.from({ length: 501 }, (_, index) =>
					buildProjectSegmentSummaryFixture({
						segment_id: `seg-${index}`,
						element_name: `Clip ${index + 1}`,
						start_ms: index * 10,
						end_ms: index * 10 + 10,
						ordinal: index + 1,
						asset_id: `asset-${index}`,
						transcript_snippet: "x",
					}),
				),
				current_scene_segments: Array.from({ length: 501 }, (_, index) =>
					buildProjectSegmentSummaryFixture({
						segment_id: `seg-${index}`,
						element_name: `Clip ${index + 1}`,
						start_ms: index * 10,
						end_ms: index * 10 + 10,
						ordinal: index + 1,
						asset_id: `asset-${index}`,
						transcript_snippet: "x",
					}),
				),
				timeline_words: Array.from({ length: 5001 }, (_, index) => ({
					text: "x",
					start_ms: index,
					end_ms: index + 1,
					segment_id: "seg-0",
				})),
			},
			context,
		});

		expect(result.warnings.length).toBeGreaterThanOrEqual(2);
		expect(
			result.warnings.some((w) => w.includes("truncated")),
		).toBe(true);
	});

	test("extracts text from multi-block content response", async () => {
		setFetchMock(mock(async () =>
			new Response(
				JSON.stringify({
					id: "msg_test",
					type: "message",
					role: "assistant",
					content: [
						{ type: "text", text: '[{"type":"MAKE_VERSION",' },
						{ type: "text", text: '"duration_target_s":15,"aggressiveness":0.5}]' },
					],
					model: "claude-sonnet-4-6",
					stop_reason: "end_turn",
					usage: { input_tokens: 100, output_tokens: 50 },
				}),
				{ status: 200 },
			),
		));

		const result = await requestAnthropicChatPlan({
			userText: "shorten it",
			projectSummary: summary,
			context,
		});

		expect(result.ops).toEqual([
			{
				type: "MAKE_VERSION",
				duration_target_s: 15,
				aggressiveness: 0.5,
			},
		]);
	});

	test("returns empty ops for an empty array response", async () => {
		setFetchMock(mock(async () =>
			anthropicSuccessResponse("[]"),
		));

		const result = await requestAnthropicChatPlan({
			userText: "do nothing",
			projectSummary: summary,
			context,
		});

		expect(result.ops).toEqual([]);
		expect(result.provider).toBe("anthropic");
	});
});
