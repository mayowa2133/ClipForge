import { describe, expect, test } from "bun:test";
import { evaluateSemanticPlanSafety } from "@/lib/clipforge/chat/plan-safety";
import type { ChatPlannerContext, ProjectSummary } from "@/lib/clipforge/chat/types";
import type { TimelineDiffOp } from "@/types/clipforge";

const summary: ProjectSummary = {
	total_duration_s: 12,
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
			transcript_snippet: "clipforge intro",
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
			transcript_snippet: "clipforge outro",
		},
		{
			segment_id: "cap-1",
			track_type: "text",
			segment_kind: "caption",
			start_ms: 1000,
			end_ms: 1900,
			ordinal: 1,
			asset_id: null,
			text_content: "demo line",
			transcript_snippet: "",
		},
	],
	media_assets: [
		{
			asset_id: "asset-1",
			name: "clip-1.mp4",
			type: "video",
		},
	],
	timeline_words: [
		{
			text: "clipforge",
			start_ms: 700,
			end_ms: 1000,
			segment_id: "seg-1",
			media_id: "asset-1",
		},
		{
			text: "clipforge",
			start_ms: 4700,
			end_ms: 5000,
			segment_id: "seg-2",
			media_id: "asset-2",
		},
	],
};

const context: ChatPlannerContext = {
	playhead_ms: 1000,
	selected_segment_ids: [],
	active_scene_id: "scene-main",
};

function evaluate({
	userText,
	ops,
}: {
	userText: string;
	ops: TimelineDiffOp[];
}) {
	return evaluateSemanticPlanSafety({
		userText,
		projectSummary: summary,
		context,
		ops,
	});
}

describe("evaluateSemanticPlanSafety", () => {
	test("repairs a missing target id from deterministic intent", () => {
		const result = evaluate({
			userText: "trim the first clip by 0.5s at the start",
			ops: [
				{
					type: "TRIM_CLIP",
					clip_id: "missing",
					in_ms: 500,
					out_ms: 0,
				},
			],
		});

		expect(result.clarification).toBeNull();
		expect(result.ops).toHaveLength(1);
		expect(result.ops[0]).toMatchObject({
			type: "TRIM_CLIP",
			clip_id: "seg-1",
		});
		expect(result.safety.repairedCount).toBeGreaterThan(0);
	});

	test("returns clarification when recovery target is ambiguous", () => {
		const result = evaluate({
			userText: 'delete the clip where i say "clipforge"',
			ops: [
				{
					type: "DELETE_SEGMENT",
					segment_id: "missing",
				},
			],
		});

		expect(result.ops).toEqual([]);
		expect(result.clarification?.kind).toBe("segment-target");
		expect(result.safety.blocked).toBe(true);
		expect(
			result.safety.notices.some(
				(notice) => notice.code === "blocked_ambiguous_repair_target",
			),
		).toBe(true);
	});

	test("drops unrecoverable missing targets", () => {
		const result = evaluate({
			userText: "make it faster",
			ops: [
				{
					type: "DELETE_SEGMENT",
					segment_id: "missing",
				},
			],
		});

		expect(result.clarification).toBeNull();
		expect(result.ops).toEqual([]);
		expect(result.safety.blocked).toBe(true);
		expect(result.safety.droppedCount).toBeGreaterThan(0);
	});

	test("normalizes overlay values deterministically", () => {
		const result = evaluate({
			userText: 'add text here that says "watch this"',
			ops: [
				{
					type: "ADD_TEXT_OVERLAY",
					text: "x".repeat(200),
					start_ms: -100,
					end_ms: 25000,
					position: "side" as any,
					style_id: "invalid" as any,
					font: "",
					size: 5,
					color: "blue",
					outline: true,
					background: false,
				},
			],
		});

		expect(result.clarification).toBeNull();
		expect(result.ops).toHaveLength(1);
		expect(result.ops[0]).toMatchObject({
			type: "ADD_TEXT_OVERLAY",
			position: "top",
			style_id: "overlay-top",
			font: "Arial",
			size: 24,
			color: "#FFFFFF",
		});
		expect((result.ops[0] as any).text.length).toBe(140);
	});

	test("drops ops that target segments deleted earlier in the same plan", () => {
		const result = evaluate({
			userText: "delete the first clip and move it to 5s",
			ops: [
				{
					type: "DELETE_SEGMENT",
					segment_id: "seg-1",
				},
				{
					type: "MOVE_SEGMENT",
					segment_id: "seg-1",
					to_ms: 5000,
				},
			],
		});

		expect(result.clarification).toBeNull();
		expect(result.ops).toHaveLength(1);
		expect(result.ops[0]?.type).toBe("DELETE_SEGMENT");
		expect(
			result.safety.notices.some(
				(notice) => notice.code === "dropped_target_deleted_by_prior_op",
			),
		).toBe(true);
	});

	test("preserves deterministic op order for retained ops", () => {
		const result = evaluate({
			userText: "trim the first clip by 0.5s at the start and move it to 5s",
			ops: [
				{
					type: "TRIM_CLIP",
					clip_id: "seg-1",
					in_ms: 500,
					out_ms: 0,
				},
				{
					type: "MOVE_SEGMENT",
					segment_id: "seg-1",
					to_ms: 5000,
				},
			],
		});

		expect(result.clarification).toBeNull();
		expect(result.ops.map((op) => op.type)).toEqual(["TRIM_CLIP", "MOVE_SEGMENT"]);
	});
});
