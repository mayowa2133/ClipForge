import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	buildProjectSegmentSummaryFixture,
	buildProjectSummaryFixture,
} from "@/lib/clipforge/__tests__/fixtures";
import { requestOpenAIChatPlan } from "@/lib/clipforge/chat/server/openai-planner";
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
const originalApiKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.CLIPFORGE_OPENAI_MODEL;
const originalEndpoint = process.env.CLIPFORGE_OPENAI_ENDPOINT;

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

describe("requestOpenAIChatPlan", () => {
	beforeEach(() => {
		process.env.OPENAI_API_KEY = "test-key";
		process.env.CLIPFORGE_OPENAI_MODEL = "gpt-test";
		process.env.CLIPFORGE_OPENAI_ENDPOINT = "https://example.test/v1/responses";
		setFetchMock(mock());
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		restoreEnv("OPENAI_API_KEY", originalApiKey);
		restoreEnv("CLIPFORGE_OPENAI_MODEL", originalModel);
		restoreEnv("CLIPFORGE_OPENAI_ENDPOINT", originalEndpoint);
	});

	test("returns guarded ops from a valid model response", async () => {
		setFetchMock(mock(async () =>
			new Response(
				JSON.stringify({
					output_text:
						'[{"type":"MAKE_VERSION","duration_target_s":30,"aggressiveness":0.75}]',
				}),
				{ status: 200 },
			),
		));

		const result = await requestOpenAIChatPlan({
			userText: "make it shorter",
			projectSummary: summary,
			context,
		});

		expect(result.provider).toBe("openai");
		expect(result.ops).toEqual([
			{
				type: "MAKE_VERSION",
				duration_target_s: 30,
				aggressiveness: 0.75,
			},
		]);
	});

	test("throws when the api key is missing", async () => {
		delete process.env.OPENAI_API_KEY;

		await expect(
			requestOpenAIChatPlan({
				userText: "make it shorter",
				projectSummary: summary,
				context,
			}),
		).rejects.toMatchObject({
			status: 503,
		});
	});

	test("throws on upstream failures", async () => {
		setFetchMock(mock(async () =>
			new Response(JSON.stringify({ error: "Upstream failed" }), { status: 500 }),
		));

		await expect(
			requestOpenAIChatPlan({
				userText: "make it shorter",
				projectSummary: summary,
				context,
			}),
		).rejects.toMatchObject({
			status: 502,
		});
	});

	test("throws on invalid model output", async () => {
		setFetchMock(mock(async () =>
			new Response(JSON.stringify({ output_text: "Not JSON" }), { status: 200 }),
		));

		await expect(
			requestOpenAIChatPlan({
				userText: "make it shorter",
				projectSummary: summary,
				context,
			}),
		).rejects.toMatchObject({
			status: 422,
		});
	});

	test("adds truncation warnings for oversized payloads", async () => {
		setFetchMock(mock(async () =>
			new Response(JSON.stringify({ output_text: "[]" }), { status: 200 }),
		));

		const result = await requestOpenAIChatPlan({
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

		expect(result.warnings.length).toBeGreaterThanOrEqual(3);
	});
});
