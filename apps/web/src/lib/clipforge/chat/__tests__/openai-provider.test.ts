import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OpenAIChatOpsProvider } from "@/lib/clipforge/chat";
import type { ProjectSummary } from "@/lib/clipforge/chat";

const summary: ProjectSummary = {
	total_duration_s: 10,
	caption_style_id: null,
	pause_stats: {
		region_count: 0,
		total_pause_ms: 0,
	},
	segments: [],
	media_assets: [],
	timeline_words: [],
};

const originalFetch = globalThis.fetch;

function setFetchMock(handler: (...args: any[]) => any) {
	globalThis.fetch = handler as typeof fetch;
}

describe("OpenAIChatOpsProvider", () => {
	beforeEach(() => {
		setFetchMock(mock());
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("maps a successful route response into a structured proposal", async () => {
		setFetchMock(mock(async () =>
			new Response(
				JSON.stringify({
					ops: [
						{
							type: "MAKE_VERSION",
							duration_target_s: 25,
							aggressiveness: 0.7,
						},
					],
					provider: "openai",
					warnings: ["Truncated timeline words."],
					rawText: "[...]",
				}),
				{ status: 200 },
			),
		));

		const provider = new OpenAIChatOpsProvider();
		const result = await provider.proposeEdits({
			userText: "make it shorter",
			projectSummary: summary,
		});

		expect(result.provider).toBe("openai");
		expect(result.ops).toHaveLength(1);
		expect(result.warnings).toEqual(["Truncated timeline words."]);
	});

	test("throws on route failures", async () => {
		setFetchMock(mock(async () =>
			new Response(JSON.stringify({ error: "Planner unavailable" }), {
				status: 503,
			}),
		));

		const provider = new OpenAIChatOpsProvider();
		await expect(
			provider.proposeEdits({
				userText: "anything",
				projectSummary: summary,
			}),
		).rejects.toThrow("Planner unavailable");
	});

	test("throws on invalid payloads", async () => {
		setFetchMock(mock(async () =>
			new Response(JSON.stringify({ provider: "openai" }), { status: 200 }),
		));

		const provider = new OpenAIChatOpsProvider();
		await expect(
			provider.proposeEdits({
				userText: "anything",
				projectSummary: summary,
			}),
		).rejects.toThrow("OpenAI planner returned an invalid payload.");
	});
});
