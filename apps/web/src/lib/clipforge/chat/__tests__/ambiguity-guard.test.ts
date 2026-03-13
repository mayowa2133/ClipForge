import { describe, expect, test } from "bun:test";
import {
	buildProjectSegmentSummaryFixture,
	buildProjectSummaryFixture,
} from "@/lib/clipforge/__tests__/fixtures";
import { evaluateAmbiguityGuard } from "@/lib/clipforge/chat";
import type { ChatPlannerContext, ProjectSummary } from "@/lib/clipforge/chat";

function buildSummary(): ProjectSummary {
	const segments = [
		buildProjectSegmentSummaryFixture({
			segment_id: "seg-1",
			element_name: "Clip 1",
			start_ms: 1000,
			end_ms: 3000,
			asset_id: "clip-1",
			transcript_snippet: "hey bro clipforge welcome",
		}),
		buildProjectSegmentSummaryFixture({
			segment_id: "seg-2",
			element_name: "Clip 2",
			start_ms: 3000,
			end_ms: 6000,
			ordinal: 2,
			asset_id: "clip-2",
			transcript_snippet: "summer vibes clipforge",
		}),
		buildProjectSegmentSummaryFixture({
			segment_id: "caption-1",
			track_id: "track-text",
			track_type: "text",
			segment_kind: "caption",
			element_name: "Caption 1",
			start_ms: 1200,
			end_ms: 2000,
			ordinal: 1,
			asset_id: null,
			text_content: "demo title",
			transcript_snippet: "demo title",
		}),
		buildProjectSegmentSummaryFixture({
			segment_id: "caption-2",
			track_id: "track-text",
			track_type: "text",
			segment_kind: "caption",
			element_name: "Caption 2",
			start_ms: 3400,
			end_ms: 4200,
			ordinal: 2,
			asset_id: null,
			text_content: "demo again",
			transcript_snippet: "demo again",
		}),
	];

	return buildProjectSummaryFixture({
		total_duration_s: 50,
		caption_style_id: "clean-bottom",
		segments,
		current_scene_segments: segments,
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
	});
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

		expect(result.clarification?.kind).toBe("target");
		expect(result.clarification?.options).toHaveLength(2);
	});

	test('returns clarification for ambiguous caption match intent', () => {
		const result = evaluateAmbiguityGuard({
			userText: 'replace "demo" with "sample" in captions',
			projectSummary: buildSummary(),
			context: buildContext(),
		});

		expect(result.clarification?.kind).toBe("target");
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
			buildProjectSegmentSummaryFixture({
				segment_id: "seg-a",
				element_name: "Clip A",
				start_ms: 1000,
				end_ms: 1500,
				asset_id: "clip-a",
			}),
			buildProjectSegmentSummaryFixture({
				segment_id: "seg-b",
				element_name: "Clip B",
				start_ms: 3000,
				end_ms: 3500,
				ordinal: 2,
				asset_id: "clip-b",
			}),
		];
		summary.current_scene_segments = summary.segments;

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
