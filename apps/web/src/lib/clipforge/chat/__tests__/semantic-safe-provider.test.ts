import { describe, expect, test } from "bun:test";
import { SemanticSafeChatOpsProvider } from "@/lib/clipforge/chat";
import type {
	ChatOpsProvider,
	ChatPlannerContext,
	ChatProposalResult,
	ProjectSummary,
} from "@/lib/clipforge/chat";

const summary: ProjectSummary = {
	total_duration_s: 8,
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
			end_ms: 4000,
			ordinal: 1,
			asset_id: "asset-1",
			text_content: "",
			transcript_snippet: "one",
		},
		{
			segment_id: "seg-2",
			track_type: "video",
			segment_kind: "video",
			start_ms: 4000,
			end_ms: 8000,
			ordinal: 2,
			asset_id: "asset-2",
			text_content: "",
			transcript_snippet: "two",
		},
	],
	media_assets: [],
	timeline_words: [],
};

const context: ChatPlannerContext = {
	playhead_ms: 1000,
	selected_segment_ids: [],
	active_scene_id: "scene-main",
};

function providerReturning(result: ChatProposalResult): ChatOpsProvider {
	return {
		proposeEdits: async () => result,
	};
}

describe("SemanticSafeChatOpsProvider", () => {
	test("passes through upstream clarification unchanged", async () => {
		const provider = new SemanticSafeChatOpsProvider(
			providerReturning({
				ops: [],
				provider: "heuristic",
				fallbackUsed: false,
				warnings: [],
				clarification: {
					kind: "segment-target",
					prompt: "pick one",
					referenceLabel: "selection:clip",
					options: [],
				},
				safety: null,
				rawText: null,
			}),
		);

		const result = await provider.proposeEdits({
			userText: "delete this clip",
			projectSummary: summary,
			context,
		});

		expect(result.clarification?.referenceLabel).toBe("selection:clip");
		expect(result.ops).toEqual([]);
	});

	test("returns normalized ops and safety diagnostics", async () => {
		const provider = new SemanticSafeChatOpsProvider(
			providerReturning({
				ops: [
					{
						type: "TRIM_CLIP",
						clip_id: "missing",
						in_ms: 500,
						out_ms: 0,
					},
				],
				provider: "openai",
				fallbackUsed: false,
				warnings: [],
				clarification: null,
				rawText: "[]",
			}),
		);

		const result = await provider.proposeEdits({
			userText: "trim the first clip by 0.5s at the start",
			projectSummary: summary,
			context,
		});

		expect(result.clarification).toBeNull();
		expect(result.ops).toHaveLength(1);
		expect((result.ops[0] as any).clip_id).toBe("seg-1");
		expect(result.safety?.repairedCount).toBeGreaterThan(0);
	});

	test("replaces upstream ops with clarification when safety detects ambiguity", async () => {
		const provider = new SemanticSafeChatOpsProvider(
			providerReturning({
				ops: [
					{
						type: "DELETE_SEGMENT",
						segment_id: "missing",
					},
				],
				provider: "openai",
				fallbackUsed: false,
				warnings: [],
				clarification: null,
				rawText: "[]",
			}),
		);

		const result = await provider.proposeEdits({
			userText: "delete this clip",
			projectSummary: summary,
			context: {
				...context,
				selected_segment_ids: ["seg-1", "seg-2"],
			},
		});

		expect(result.ops).toEqual([]);
		expect(result.clarification?.kind).toBe("segment-target");
		expect(result.provider).toBe("openai");
		expect(result.fallbackUsed).toBe(false);
	});
});
