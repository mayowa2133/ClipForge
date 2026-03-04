import { describe, expect, test } from "bun:test";
import { AmbiguitySafeChatOpsProvider } from "@/lib/clipforge/chat";
import type {
	ChatOpsProvider,
	ChatPlannerContext,
	ChatProposalResult,
	ProjectSummary,
} from "@/lib/clipforge/chat";

const summary: ProjectSummary = {
	total_duration_s: 10,
	caption_style_id: null,
	pause_stats: {
		region_count: 0,
		total_pause_ms: 0,
	},
	segments: [
		{
			segment_id: "seg-1",
			track_type: "video",
			segment_kind: "video",
			start_ms: 0,
			end_ms: 2000,
			ordinal: 1,
			asset_id: "clip-1",
			text_content: "",
			transcript_snippet: "clipforge one",
		},
		{
			segment_id: "seg-2",
			track_type: "video",
			segment_kind: "video",
			start_ms: 2000,
			end_ms: 4000,
			ordinal: 2,
			asset_id: "clip-2",
			text_content: "",
			transcript_snippet: "clipforge two",
		},
	],
	media_assets: [],
	timeline_words: [
		{
			text: "clipforge",
			start_ms: 500,
			end_ms: 700,
			segment_id: "seg-1",
			media_id: "clip-1",
		},
		{
			text: "clipforge",
			start_ms: 2500,
			end_ms: 2700,
			segment_id: "seg-2",
			media_id: "clip-2",
		},
	],
};

const context: ChatPlannerContext = {
	playhead_ms: 0,
	selected_segment_ids: [],
	active_scene_id: "scene-main",
};

function buildProvider(result: ChatProposalResult): ChatOpsProvider {
	return {
		proposeEdits: async () => result,
	};
}

describe("AmbiguitySafeChatOpsProvider", () => {
	test("passes through provider clarification unchanged", async () => {
		const provider = new AmbiguitySafeChatOpsProvider(
			buildProvider({
				ops: [],
				provider: "heuristic",
				fallbackUsed: false,
				warnings: ["a"],
				clarification: {
					kind: "segment-target",
					prompt: "pick one",
					referenceLabel: "selection:clip",
					options: [],
				},
				rawText: null,
			}),
		);

		const result = await provider.proposeEdits({
			userText: "delete this clip",
			projectSummary: summary,
			context,
		});

		expect(result.clarification?.referenceLabel).toBe("selection:clip");
		expect(result.warnings).toEqual(["a"]);
	});

	test("returns base result when guard finds no ambiguity", async () => {
		const provider = new AmbiguitySafeChatOpsProvider(
			buildProvider({
				ops: [{ type: "DELETE_SEGMENT", segment_id: "seg-2" }],
				provider: "openai",
				fallbackUsed: false,
				warnings: [],
				clarification: null,
				rawText: "[]",
			}),
		);

		const result = await provider.proposeEdits({
			userText: "delete the second clip",
			projectSummary: summary,
			context,
		});

		expect(result.clarification).toBeNull();
		expect(result.ops).toHaveLength(1);
		expect(result.provider).toBe("openai");
	});

	test("drops ops and returns clarification when guard detects ambiguity", async () => {
		const provider = new AmbiguitySafeChatOpsProvider(
			buildProvider({
				ops: [{ type: "DELETE_SEGMENT", segment_id: "seg-1" }],
				provider: "openai",
				fallbackUsed: false,
				warnings: ["model chose first"],
				clarification: null,
				rawText: "[]",
			}),
		);

		const result = await provider.proposeEdits({
			userText: 'delete the clip where i say "clipforge"',
			projectSummary: summary,
			context,
		});

		expect(result.ops).toEqual([]);
		expect(result.clarification?.kind).toBe("segment-target");
		expect(result.provider).toBe("openai");
		expect(result.fallbackUsed).toBe(false);
		expect(result.warnings.some((warning) => warning.includes("safety guard"))).toBe(
			true,
		);
	});
});
