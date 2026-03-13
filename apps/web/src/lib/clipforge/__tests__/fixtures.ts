import type {
	ProjectSegmentSummary,
	ProjectSummary,
} from "@/lib/clipforge/chat/types";

export function buildProjectSegmentSummaryFixture(
	overrides: Partial<ProjectSegmentSummary> = {},
): ProjectSegmentSummary {
	return {
		segment_id: "segment-1",
		track_id: "track-main",
		scene_id: "scene-main",
		track_type: "video",
		segment_kind: "video",
		start_ms: 0,
		end_ms: 1000,
		ordinal: 1,
		asset_id: "asset-1",
		element_name: "Segment 1",
		text_content: "",
		transcript_snippet: "",
		...overrides,
	};
}

export function buildProjectSummaryFixture(
	overrides: Partial<ProjectSummary> = {},
): ProjectSummary {
	const currentSceneId = overrides.current_scene_id ?? "scene-main";
	const segments = overrides.segments ?? [];

	return {
		total_duration_s: 10,
		current_scene_id: currentSceneId,
		caption_style_id: null,
		pause_stats: {
			region_count: 0,
			total_pause_ms: 0,
		},
		segments,
		current_scene_segments:
			overrides.current_scene_segments ??
			segments.filter((segment) => segment.scene_id === currentSceneId),
		other_scene_summaries: [],
		media_assets: [],
		selection: {
			selected_segment_ids: [],
			selected_segments: [],
		},
		playhead_neighborhood: {
			playhead_ms: 0,
			nearby_segments: [],
		},
		version_pack: null,
		audio_mix: null,
		overlay_defaults: null,
		brand_kit: null,
		available_project_kits: [],
		available_scene_recipes: [],
		media_analysis_markers: [],
		recent_ai_actions: [],
		recent_turn_summaries: [],
		timeline_words: [],
		...overrides,
	};
}
