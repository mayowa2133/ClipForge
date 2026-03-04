import { describe, expect, test } from "bun:test";
import { HeuristicChatOpsProvider } from "@/lib/clipforge";
import type { ChatPlannerContext, ProjectSummary } from "@/lib/clipforge/chat";

function buildSummary(): ProjectSummary {
	return {
		total_duration_s: 50,
		caption_style_id: "clean-bottom",
		pause_stats: { region_count: 0, total_pause_ms: 0 },
		segments: [
			{
				segment_id: "seg-1",
				track_type: "video",
				segment_kind: "video",
				start_ms: 1000,
				end_ms: 3000,
				ordinal: 1,
				asset_id: "clip-1",
				text_content: "",
				transcript_snippet: "hey bro welcome",
			},
			{
				segment_id: "seg-2",
				track_type: "video",
				segment_kind: "video",
				start_ms: 3000,
				end_ms: 6000,
				ordinal: 2,
				asset_id: "clip-2",
				text_content: "",
				transcript_snippet: "summer vibes clipforge",
			},
			{
				segment_id: "caption-1",
				track_type: "text",
				segment_kind: "caption",
				start_ms: 1200,
				end_ms: 2000,
				ordinal: 1,
				asset_id: null,
				text_content: "teh hook demo",
				transcript_snippet: "teh hook demo",
			},
			{
				segment_id: "overlay-1",
				track_type: "text",
				segment_kind: "text-overlay",
				start_ms: 6500,
				end_ms: 9000,
				ordinal: 1,
				asset_id: null,
				text_content: "watch this",
				transcript_snippet: "watch this",
			},
		],
		media_assets: [
			{
				asset_id: "beach-1",
				name: "beach.mp4",
				type: "video",
			},
		],
		timeline_words: [
			{
				text: "hey",
				start_ms: 1000,
				end_ms: 1200,
				segment_id: "seg-1",
				media_id: "clip-1",
			},
			{
				text: "bro",
				start_ms: 1200,
				end_ms: 1450,
				segment_id: "seg-1",
				media_id: "clip-1",
			},
			{
				text: "welcome",
				start_ms: 1450,
				end_ms: 1900,
				segment_id: "seg-1",
				media_id: "clip-1",
			},
			{
				text: "summer",
				start_ms: 3200,
				end_ms: 3600,
				segment_id: "seg-2",
				media_id: "clip-2",
			},
			{
				text: "vibes",
				start_ms: 3600,
				end_ms: 3900,
				segment_id: "seg-2",
				media_id: "clip-2",
			},
			{
				text: "clipforge",
				start_ms: 3900,
				end_ms: 4400,
				segment_id: "seg-2",
				media_id: "clip-2",
			},
		],
	};
}

function buildContext(
	overrides: Partial<ChatPlannerContext> = {},
): ChatPlannerContext {
	return {
		playhead_ms: 0,
		selected_segment_ids: [],
		active_scene_id: "scene-main",
		...overrides,
	};
}

async function propose({
	provider,
	userText,
	context,
}: {
	provider: HeuristicChatOpsProvider;
	userText: string;
	context?: Partial<ChatPlannerContext>;
}) {
	return provider.proposeEdits({
		userText,
		projectSummary: buildSummary(),
		context: buildContext(context),
	});
}

describe("HeuristicChatOpsProvider", () => {
	test("returns deterministic ops for common edit intents in clause order", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "make it faster and remove more pauses and use bold center captions",
		});

		expect(result.ops.map((op) => op.type)).toEqual([
			"MAKE_VERSION",
			"REMOVE_SILENCE",
			"SET_CAPTION_STYLE",
		]);
		expect(result.provider).toBe("heuristic");
		expect(result.fallbackUsed).toBe(false);
	});

	test("creates ADD_TEXT_OVERLAY for overlay prompts", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: 'add text at the top that says "this"',
		});

		expect(result.ops).toEqual([
			{
				type: "ADD_TEXT_OVERLAY",
				text: "this",
				start_ms: 0,
				end_ms: 2500,
				position: "top",
				style_id: "overlay-top",
				font: "Arial",
				size: 64,
				color: "#FFFFFF",
				outline: true,
				background: false,
			},
		]);
	});

	test("creates playhead-anchored text overlays for 'here' prompts", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: 'put "watch this" here',
			context: { playhead_ms: 4200 },
		});

		expect(result.ops).toEqual([
			{
				type: "ADD_TEXT_OVERLAY",
				text: "watch this",
				start_ms: 4200,
				end_ms: 6700,
				position: "top",
				style_id: "overlay-top",
				font: "Arial",
				size: 64,
				color: "#FFFFFF",
				outline: true,
				background: false,
			},
		]);
	});

	test("creates precise CUT_RANGE from phrase matches", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "cut where i say 'bro'",
		});

		expect(result.ops).toEqual([
			{
				type: "CUT_RANGE",
				start_ms: 1080,
				end_ms: 1570,
			},
		]);
	});

	test("creates INSERT_BROLL when a named asset and timing are provided", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "add b-roll using beach.mp4 from 5s to 8s",
		});

		expect(result.ops).toEqual([
			{
				type: "INSERT_BROLL",
				media_id: "beach-1",
				start_ms: 5000,
				end_ms: 8000,
				lane: "overlay-primary",
				fit_mode: "cover",
				mute: true,
			},
		]);
	});

	test("creates phrase-anchored INSERT_BROLL from transcript timing", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: 'add b-roll using beach.mp4 when i say "summer" for 3s',
		});

		expect(result.ops).toEqual([
			{
				type: "INSERT_BROLL",
				media_id: "beach-1",
				start_ms: 3200,
				end_ms: 6200,
				lane: "overlay-primary",
				fit_mode: "cover",
				mute: true,
			},
		]);
	});

	test("supports TRIM_CLIP prompts", async () => {
		const provider = new HeuristicChatOpsProvider();
		const startTrim = await propose({
			provider,
			userText: "trim the first clip by 0.5s at the start",
		});
		const endTrim = await propose({
			provider,
			userText: "trim the second clip by 0.25s at the end",
		});

		expect(startTrim.ops).toEqual([
			{ type: "TRIM_CLIP", clip_id: "seg-1", in_ms: 500, out_ms: 0 },
		]);
		expect(endTrim.ops).toEqual([
			{ type: "TRIM_CLIP", clip_id: "seg-2", in_ms: 0, out_ms: 250 },
		]);
	});

	test("supports selection-based TRIM_CLIP prompts", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "trim this clip by 0.5s at the start",
			context: { selected_segment_ids: ["seg-2"] },
		});

		expect(result.ops).toEqual([
			{ type: "TRIM_CLIP", clip_id: "seg-2", in_ms: 500, out_ms: 0 },
		]);
	});

	test("supports MOVE_SEGMENT prompts", async () => {
		const provider = new HeuristicChatOpsProvider();
		const absoluteMove = await propose({
			provider,
			userText: "move the first clip to 5s",
		});
		const relativeMove = await propose({
			provider,
			userText: "move the second clip earlier by 1s",
		});

		expect(absoluteMove.ops).toEqual([
			{ type: "MOVE_SEGMENT", segment_id: "seg-1", to_ms: 5000 },
		]);
		expect(relativeMove.ops).toEqual([
			{ type: "MOVE_SEGMENT", segment_id: "seg-2", to_ms: 2000 },
		]);
	});

	test("supports playhead-based MOVE_SEGMENT prompts when no selection exists", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "move this earlier by 1s",
			context: { playhead_ms: 3500 },
		});

		expect(result.ops).toEqual([
			{ type: "MOVE_SEGMENT", segment_id: "seg-2", to_ms: 2000 },
		]);
	});

	test("supports SWAP_SEGMENTS prompts", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "swap the first and second clips",
		});

		expect(result.ops).toEqual([
			{ type: "SWAP_SEGMENTS", a_id: "seg-1", b_id: "seg-2" },
		]);
	});

	test("supports DELETE_SEGMENT phrase-anchored prompts", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "delete the clip where i say 'bro'",
		});

		expect(result.ops).toEqual([{ type: "DELETE_SEGMENT", segment_id: "seg-1" }]);
	});

	test("supports playhead-based DELETE_SEGMENT prompts", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "delete this clip",
			context: { playhead_ms: 5200 },
		});

		expect(result.ops).toEqual([{ type: "DELETE_SEGMENT", segment_id: "seg-2" }]);
	});

	test("supports DUPLICATE_SEGMENT prompts", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "duplicate the first clip after itself",
		});

		expect(result.ops).toEqual([
			{ type: "DUPLICATE_SEGMENT", segment_id: "seg-1", to_ms: 3000 },
		]);
	});

	test("supports FIX_CAPTION_TEXT prompts", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: 'replace "teh" with "the" in captions',
		});

		expect(result.ops).toEqual([
			{ type: "FIX_CAPTION_TEXT", segment_id: "caption-1", from: "teh", to: "the" },
		]);
	});

	test("supports selected-caption FIX_CAPTION_TEXT prompts", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: 'replace "teh" with "the" in this caption',
			context: { selected_segment_ids: ["caption-1"] },
		});

		expect(result.ops).toEqual([
			{ type: "FIX_CAPTION_TEXT", segment_id: "caption-1", from: "teh", to: "the" },
		]);
	});

	test("supports multi-op compound requests in order", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "make it faster and use bold center captions",
		});

		expect(result.ops.map((op) => op.type)).toEqual([
			"MAKE_VERSION",
			"SET_CAPTION_STYLE",
		]);
	});

	test("supports same-request carry-over for later clauses", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "trim the first clip by 0.5s at the start and move it to 5s",
		});

		expect(result.ops).toEqual([
			{ type: "TRIM_CLIP", clip_id: "seg-1", in_ms: 500, out_ms: 0 },
			{ type: "MOVE_SEGMENT", segment_id: "seg-1", to_ms: 5000 },
		]);
		expect(result.warnings).toEqual([]);
	});

	test("does not carry references across separate requests", async () => {
		const provider = new HeuristicChatOpsProvider();
		const first = await propose({
			provider,
			userText: "trim the first clip by 0.5s at the start",
		});
		const second = await propose({
			provider,
			userText: "move it to 5s",
		});

		expect(first.ops).toHaveLength(1);
		expect(second.ops).toEqual([]);
		expect(second.warnings).toEqual(['Skipped unsupported clause: "move it to 5s"']);
	});

	test("returns no B-roll op without required asset or quoted phrase syntax", async () => {
		const provider = new HeuristicChatOpsProvider();
		const missingTiming = await propose({
			provider,
			userText: "add b-roll using beach.mp4",
		});
		const missingAsset = await propose({
			provider,
			userText: 'add b-roll using missing.mp4 when i say "summer" for 3s',
		});
		const missingQuote = await propose({
			provider,
			userText: "cut where i say bro",
		});

		expect(missingTiming.ops).toEqual([]);
		expect(missingAsset.ops).toEqual([]);
		expect(missingQuote.ops).toEqual([]);
	});
});
