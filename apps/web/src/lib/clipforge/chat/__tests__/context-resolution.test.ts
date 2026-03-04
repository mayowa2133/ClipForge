import { describe, expect, test } from "bun:test";
import {
	createEmptyResolutionState,
	findPlayheadCandidates,
	findSelectionCandidates,
	resolveImplicitReference,
	resolvePlayheadAnchor,
	resolveSelectionAnchor,
	updateResolutionStateFromSegment,
} from "@/lib/clipforge/chat";
import type { ChatPlannerContext, ProjectSummary } from "@/lib/clipforge/chat";

function buildSummary(): ProjectSummary {
	return {
		total_duration_s: 12,
		caption_style_id: null,
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
				transcript_snippet: "hello world",
			},
			{
				segment_id: "caption-1",
				track_type: "text",
				segment_kind: "caption",
				start_ms: 1200,
				end_ms: 1800,
				ordinal: 1,
				asset_id: null,
				text_content: "hello world",
				transcript_snippet: "hello world",
			},
			{
				segment_id: "seg-2",
				track_type: "video",
				segment_kind: "video",
				start_ms: 4000,
				end_ms: 6000,
				ordinal: 2,
				asset_id: "clip-2",
				text_content: "",
				transcript_snippet: "next clip",
			},
		],
		media_assets: [],
		timeline_words: [],
	};
}

describe("context-resolution", () => {
	test("resolveSelectionAnchor returns the first selected segment matching the allowed kind", () => {
		const summary = buildSummary();
		const context: ChatPlannerContext = {
			playhead_ms: 0,
			selected_segment_ids: ["caption-1", "seg-2"],
			active_scene_id: "scene-main",
		};

		const result = resolveSelectionAnchor({
			projectSummary: summary,
			context,
			allowedKinds: ["video"],
		});

		expect(result?.segment_id).toBe("seg-2");
	});

	test("resolvePlayheadAnchor prefers an enclosing segment and falls back to nearest start", () => {
		const summary = buildSummary();

		const enclosing = resolvePlayheadAnchor({
			projectSummary: summary,
			context: {
				playhead_ms: 1500,
				selected_segment_ids: [],
				active_scene_id: "scene-main",
			},
			allowedKinds: ["video"],
		});
		const nearest = resolvePlayheadAnchor({
			projectSummary: summary,
			context: {
				playhead_ms: 3500,
				selected_segment_ids: [],
				active_scene_id: "scene-main",
			},
			allowedKinds: ["video"],
		});

		expect(enclosing?.segment_id).toBe("seg-1");
		expect(nearest?.segment_id).toBe("seg-2");
	});

	test("resolveImplicitReference respects selection, carry-over, and playhead modes", () => {
		const summary = buildSummary();
		const context: ChatPlannerContext = {
			playhead_ms: 4500,
			selected_segment_ids: ["seg-1"],
			active_scene_id: "scene-main",
		};
		const baseState = createEmptyResolutionState();
		const carryState = updateResolutionStateFromSegment(
			baseState,
			summary.segments[0]!,
		);

		const selection = resolveImplicitReference({
			projectSummary: summary,
			context,
			state: baseState,
			allowedKinds: ["video"],
			token: "selection",
		});
		const carryOver = resolveImplicitReference({
			projectSummary: summary,
			context,
			state: carryState,
			allowedKinds: ["video"],
			token: "carry-over",
		});
		const playhead = resolveImplicitReference({
			projectSummary: summary,
			context: { ...context, selected_segment_ids: [] },
			state: baseState,
			allowedKinds: ["video"],
			token: "playhead",
		});

		expect(selection?.segment_id).toBe("seg-1");
		expect(carryOver?.segment_id).toBe("seg-1");
		expect(playhead?.segment_id).toBe("seg-2");
	});

	test("candidate helpers preserve ambiguity instead of auto-picking", () => {
		const summary = buildSummary();
		const context: ChatPlannerContext = {
			playhead_ms: 1500,
			selected_segment_ids: ["seg-1", "seg-2"],
			active_scene_id: "scene-main",
		};

		const selectionCandidates = findSelectionCandidates({
			projectSummary: summary,
			context,
			allowedKinds: ["video"],
		});
		const playheadCandidates = findPlayheadCandidates({
			projectSummary: summary,
			context,
			allowedKinds: ["video", "caption"],
		});

		expect(selectionCandidates.map((segment) => segment.segment_id)).toEqual([
			"seg-1",
			"seg-2",
		]);
		expect(playheadCandidates.map((segment) => segment.segment_id)).toEqual([
			"seg-1",
			"caption-1",
		]);
	});
});
