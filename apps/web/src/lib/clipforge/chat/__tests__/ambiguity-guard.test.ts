import { describe, expect, test } from "bun:test";
import { evaluateAmbiguityGuard } from "@/lib/clipforge/chat";
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
				transcript_snippet: "hey bro clipforge welcome",
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
				text_content: "demo title",
				transcript_snippet: "demo title",
			},
			{
				segment_id: "caption-2",
				track_type: "text",
				segment_kind: "caption",
				start_ms: 3400,
				end_ms: 4200,
				ordinal: 2,
				asset_id: null,
				text_content: "demo again",
				transcript_snippet: "demo again",
			},
		],
		media_assets: [],
		timeline_words: [
			{
				text: "clipforge",
				start_ms: 1450,
				end_ms: 1700,
				segment_id: "seg-1",
				media_id: "clip-1",
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

describe("evaluateAmbiguityGuard", () => {
	test('returns clarification for ambiguous phrase clip intent', () => {
		const result = evaluateAmbiguityGuard({
			userText: 'delete the clip where i say "clipforge"',
			projectSummary: buildSummary(),
			context: buildContext(),
		});

		expect(result.clarification?.kind).toBe("segment-target");
		expect(result.clarification?.options).toHaveLength(2);
	});

	test('returns clarification for ambiguous caption match intent', () => {
		const result = evaluateAmbiguityGuard({
			userText: 'replace "demo" with "sample" in captions',
			projectSummary: buildSummary(),
			context: buildContext(),
		});

		expect(result.clarification?.kind).toBe("segment-target");
		expect(result.clarification?.options).toHaveLength(2);
	});

	test("does not return clarification for explicit ordinal references", () => {
		const result = evaluateAmbiguityGuard({
			userText: "delete the second clip",
			projectSummary: buildSummary(),
			context: buildContext(),
		});

		expect(result.clarification).toBeNull();
	});

	test("returns clarification for ambiguous selected clips", () => {
		const result = evaluateAmbiguityGuard({
			userText: "delete this clip",
			projectSummary: buildSummary(),
			context: buildContext({ selected_segment_ids: ["seg-1", "seg-2"] }),
		});

		expect(result.clarification?.referenceLabel).toBe("selection:clip");
		expect(result.clarification?.options).toHaveLength(2);
	});

	test("returns clarification for playhead distance ties", () => {
		const summary = buildSummary();
		summary.segments = [
			{
				segment_id: "seg-a",
				track_type: "video",
				segment_kind: "video",
				start_ms: 1000,
				end_ms: 1500,
				ordinal: 1,
				asset_id: "clip-a",
				text_content: "",
				transcript_snippet: "",
			},
			{
				segment_id: "seg-b",
				track_type: "video",
				segment_kind: "video",
				start_ms: 3000,
				end_ms: 3500,
				ordinal: 2,
				asset_id: "clip-b",
				text_content: "",
				transcript_snippet: "",
			},
		];

		const result = evaluateAmbiguityGuard({
			userText: "move this earlier by 1s",
			projectSummary: summary,
			context: buildContext({ playhead_ms: 2000 }),
		});

		expect(result.clarification?.options).toHaveLength(2);
	});

	test("override bypasses clarification for the same reference label", () => {
		const result = evaluateAmbiguityGuard({
			userText: "delete this clip",
			projectSummary: buildSummary(),
			context: buildContext({ selected_segment_ids: ["seg-1", "seg-2"] }),
			overrides: {
				forced_segment_ids_by_reference: {
					"selection:clip": "seg-2",
				},
			},
		});

		expect(result.clarification).toBeNull();
	});

	test("stops on first ambiguous clause in a compound request", () => {
		const result = evaluateAmbiguityGuard({
			userText: 'delete the clip where i say "clipforge" and make it faster',
			projectSummary: buildSummary(),
			context: buildContext(),
		});

		expect(result.clarification?.options).toHaveLength(2);
	});
});
