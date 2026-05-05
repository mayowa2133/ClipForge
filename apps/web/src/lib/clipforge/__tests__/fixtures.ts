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
		available_music_assets: [],
		available_sfx_assets: [],
		imported_audio_assets: [],
		trend_reference_summary: [],
		publish_destination: null,
		export_preflight_snapshot: null,
		packaging_readiness: {
			ready: true,
			status: "ready",
			reason: "No publish blockers detected.",
		},
		active_reference_video: null,
		reference_analysis_snapshot: null,
		reference_match_readiness: {
			ready: false,
			status: "attention",
			reason: "Reference analysis has not been generated yet.",
		},
		assembly_source_pool: [],
		footage_match_readiness: {
			ready: false,
			status: "attention",
			reason: "Choose source clips for AI draft assembly.",
		},
		reference_shot_plan: null,
		candidate_source_matches: [],
		recent_ai_actions: [],
		recent_turn_summaries: [],
		timeline_words: [],
		...overrides,
	};
}
