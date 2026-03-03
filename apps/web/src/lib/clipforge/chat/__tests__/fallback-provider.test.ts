import { describe, expect, test } from "bun:test";
import { FallbackChatOpsProvider } from "@/lib/clipforge/chat";
import type { ChatOpsProvider, ChatProposalResult, ProjectSummary } from "@/lib/clipforge/chat";

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

function buildProvider(result: ChatProposalResult): ChatOpsProvider {
	return {
		proposeEdits: async () => result,
	};
}

describe("FallbackChatOpsProvider", () => {
	test("returns the primary provider result when ops are present", async () => {
		const provider = new FallbackChatOpsProvider(
			buildProvider({
				ops: [{ type: "MAKE_VERSION", duration_target_s: 20, aggressiveness: 0.7 }],
				provider: "openai",
				fallbackUsed: false,
				warnings: [],
				rawText: "[]",
			}),
			buildProvider({
				ops: [],
				provider: "heuristic",
				fallbackUsed: false,
				warnings: [],
				rawText: null,
			}),
		);

		const result = await provider.proposeEdits({
			userText: "make it faster",
			projectSummary: summary,
		});

		expect(result.provider).toBe("openai");
		expect(result.fallbackUsed).toBe(false);
	});

	test("falls back when the primary returns no ops", async () => {
		const provider = new FallbackChatOpsProvider(
			buildProvider({
				ops: [],
				provider: "openai",
				fallbackUsed: false,
				warnings: [],
				rawText: "[]",
			}),
			buildProvider({
				ops: [{ type: "REMOVE_SILENCE", threshold_ms: 0.32, pad_ms: 0.09, min_keep_ms: 0.45 }],
				provider: "heuristic",
				fallbackUsed: false,
				warnings: [],
				rawText: null,
			}),
		);

		const result = await provider.proposeEdits({
			userText: "remove more pauses",
			projectSummary: summary,
		});

		expect(result.provider).toBe("heuristic");
		expect(result.fallbackUsed).toBe(true);
		expect(result.warnings[0]).toContain("Primary planner returned no ops");
	});

	test("falls back when the primary throws", async () => {
		const provider = new FallbackChatOpsProvider(
			{
				proposeEdits: async () => {
					throw new Error("upstream unavailable");
				},
			},
			buildProvider({
				ops: [],
				provider: "heuristic",
				fallbackUsed: false,
				warnings: [],
				rawText: null,
			}),
		);

		const result = await provider.proposeEdits({
			userText: "anything",
			projectSummary: summary,
		});

		expect(result.provider).toBe("heuristic");
		expect(result.fallbackUsed).toBe(true);
		expect(result.warnings[0]).toContain("upstream unavailable");
	});
});
