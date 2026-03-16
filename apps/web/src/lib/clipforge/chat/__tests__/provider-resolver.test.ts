import { describe, expect, test } from "bun:test";
import {
	createChatOpsProvider,
	SemanticSafeChatOpsProvider,
} from "@/lib/clipforge/chat";
import {
	buildProjectSegmentSummaryFixture,
	buildProjectSummaryFixture,
} from "@/lib/clipforge/__tests__/fixtures";

describe("createChatOpsProvider", () => {
	test("wraps heuristic mode with semantic safety", () => {
		expect(createChatOpsProvider({ mode: "heuristic" })).toBeInstanceOf(
			SemanticSafeChatOpsProvider,
		);
	});

	test("wraps openai mode with semantic safety", () => {
		expect(createChatOpsProvider({ mode: "openai" })).toBeInstanceOf(
			SemanticSafeChatOpsProvider,
		);
	});

	test("wraps auto mode with semantic safety", () => {
		expect(createChatOpsProvider({ mode: "auto" })).toBeInstanceOf(
			SemanticSafeChatOpsProvider,
		);
	});

	test("auto mode prefers the deterministic planner for supported edit intents", async () => {
		const provider = createChatOpsProvider({ mode: "auto" });
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					ops: [{ type: "MAKE_VERSION", duration_target_s: 20, aggressiveness: 0.7 }],
					provider: "openai",
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			)) as unknown as typeof fetch;

		try {
			const result = await provider.proposeEdits({
				userText: "speed up the opener 15%",
				projectSummary: buildProjectSummaryFixture({
					segments: [
						buildProjectSegmentSummaryFixture({
							segment_id: "seg-1",
							element_name: "Opener",
							asset_id: "asset-1",
							start_ms: 0,
							end_ms: 2000,
						}),
					],
				}),
				context: {
					playhead_ms: 0,
					selected_segment_ids: [],
					active_scene_id: "scene-main",
				},
			});

			expect(result.provider).toBe("heuristic");
			expect(result.fallbackUsed).toBe(false);
			expect(result.commands?.[0]).toMatchObject({
				kind: "set-clip-speed",
				target_segment_ids: ["seg-1"],
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
