import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { POST } from "@/app/api/clipforge/chat/plan/route";

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

describe("POST /api/clipforge/chat/plan", () => {
	beforeEach(() => {
		process.env.OPENAI_API_KEY = "test-key";
		process.env.CLIPFORGE_OPENAI_MODEL = "gpt-test";
		process.env.CLIPFORGE_OPENAI_ENDPOINT = "https://example.test/v1/responses";
		globalThis.fetch = mock(async () =>
			new Response(
				JSON.stringify({
					output_text:
						'[{"type":"MAKE_VERSION","duration_target_s":30,"aggressiveness":0.75}]',
				}),
				{ status: 200 },
			),
		) as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		restoreEnv("OPENAI_API_KEY", originalApiKey);
		restoreEnv("CLIPFORGE_OPENAI_MODEL", originalModel);
		restoreEnv("CLIPFORGE_OPENAI_ENDPOINT", originalEndpoint);
	});

	test("returns planned ops for a valid payload", async () => {
		const response = await POST(
			new Request("http://localhost/api/clipforge/chat/plan", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					userText: "make it shorter",
					projectSummary: {
						total_duration_s: 10,
						caption_style_id: null,
						pause_stats: { region_count: 0, total_pause_ms: 0 },
						segments: [],
						media_assets: [],
						timeline_words: [],
					},
					context: {
						playhead_ms: 1500,
						selected_segment_ids: ["seg-1"],
						active_scene_id: "scene-main",
					},
				}),
			}),
		);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(200);
		expect(body.provider).toBe("openai");
		expect(Array.isArray(body.ops)).toBe(true);
	});

	test("rejects malformed context payloads", async () => {
		const response = await POST(
			new Request("http://localhost/api/clipforge/chat/plan", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					userText: "make it shorter",
					projectSummary: {
						total_duration_s: 10,
						caption_style_id: null,
						pause_stats: { region_count: 0, total_pause_ms: 0 },
						segments: [],
						media_assets: [],
						timeline_words: [],
					},
					context: {
						playhead_ms: -1,
						selected_segment_ids: [],
						active_scene_id: "scene-main",
					},
				}),
			}),
		);
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(400);
		expect(body.error).toBe(
			"Chat plan payload must include userText, projectSummary, and context.",
		);
	});
});
