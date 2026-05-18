import { describe, expect, test } from "bun:test";
import { buildCreativeSystemPrompt } from "../creative-system-prompt";
import type { ProjectSummary } from "../types";

function buildMinimalSummary(
	overrides: Partial<ProjectSummary> = {},
): ProjectSummary {
	return {
		total_duration_s: 30,
		current_scene_id: "scene-1",
		caption_style_id: null,
		pause_stats: { region_count: 0, total_pause_ms: 0 },
		segments: [],
		current_scene_segments: [],
		other_scene_summaries: [],
		media_assets: [],
		selection: { selected_segment_ids: [], selected_segments: [] },
		playhead_neighborhood: { playhead_ms: 0, nearby_segments: [] },
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
			ready: false,
			status: "attention",
			reason: "Not evaluated.",
		},
		active_reference_video: null,
		reference_analysis_snapshot: null,
		reference_match_readiness: {
			ready: false,
			status: "blocked",
			reason: "No reference.",
		},
		assembly_source_pool: [],
		footage_match_readiness: {
			ready: false,
			status: "blocked",
			reason: "No footage.",
		},
		reference_shot_plan: null,
		candidate_source_matches: [],
		recent_ai_actions: [],
		recent_turn_summaries: [],
		timeline_words: [],
		...overrides,
	};
}

describe("buildCreativeSystemPrompt", () => {
	test("includes base few-shot examples", () => {
		const prompt = buildCreativeSystemPrompt({});
		expect(prompt).toContain("ClipForge edit planner");
		expect(prompt).toContain("REMOVE_SILENCE");
		expect(prompt).toContain("MAKE_VERSION");
	});

	test("includes creative strategy section", () => {
		const prompt = buildCreativeSystemPrompt({});
		expect(prompt).toContain("Creative editing strategy");
		expect(prompt).toContain("Retention shaping");
		expect(prompt).toContain("Creative intent mapping");
	});

	test("omits reference transfer when no reference present", () => {
		const summary = buildMinimalSummary();
		const prompt = buildCreativeSystemPrompt({ projectSummary: summary });
		expect(prompt).not.toContain("Reference video style transfer");
	});

	test("includes reference transfer when reference analysis is present", () => {
		const summary = buildMinimalSummary({
			reference_analysis_snapshot: {
				transition_cadence: "fast",
				average_shot_ms: 1200,
				caption_tone: "bold",
				caption_reveal_preset_id: null,
				audio_mood: "energetic",
				recommended_music_asset_id: null,
				recommended_sfx_asset_id: null,
				overlay_variant_id: null,
				polish_profile_id: null,
				finishing_look_id: null,
				publish_destination: null,
				target_version_id: null,
				hook_pattern: "visual-hook",
			},
		});
		const prompt = buildCreativeSystemPrompt({ projectSummary: summary });
		expect(prompt).toContain("Reference video style transfer");
		expect(prompt).toContain("fast pacing");
	});

	test("includes refinement guidance when refinementPass > 0", () => {
		const prompt = buildCreativeSystemPrompt({ refinementPass: 1 });
		expect(prompt).toContain("Refinement mode");
		expect(prompt).toContain("refinement_pass > 0");
	});

	test("omits refinement guidance for first pass", () => {
		const prompt = buildCreativeSystemPrompt({ refinementPass: 0 });
		expect(prompt).not.toContain("Refinement mode");
	});

	test("includes project signals when summary is provided", () => {
		const summary = buildMinimalSummary({
			total_duration_s: 45,
			pause_stats: { region_count: 12, total_pause_ms: 8500 },
			caption_style_id: "bold-center",
		});
		const prompt = buildCreativeSystemPrompt({ projectSummary: summary });
		expect(prompt).toContain("Total duration: 45s");
		expect(prompt).toContain("Silence:");
		expect(prompt).toContain("Active caption style: bold-center");
	});

	test("signals high silence percentage", () => {
		const summary = buildMinimalSummary({
			total_duration_s: 30,
			pause_stats: { region_count: 8, total_pause_ms: 12000 },
		});
		const prompt = buildCreativeSystemPrompt({ projectSummary: summary });
		expect(prompt).toContain("consider REMOVE_SILENCE");
	});

	test("includes beat marker availability signal", () => {
		const summary = buildMinimalSummary({
			media_analysis_markers: [
				{
					asset_id: "music-1",
					name: "track.mp3",
					beat_marker_count: 32,
					scene_cut_count: 0,
					activity_window_count: 0,
				},
			],
		});
		const prompt = buildCreativeSystemPrompt({ projectSummary: summary });
		expect(prompt).toContain("BEAT_SYNC_CUTS is possible");
	});

	test("signals when no captions are applied", () => {
		const summary = buildMinimalSummary({ caption_style_id: null });
		const prompt = buildCreativeSystemPrompt({ projectSummary: summary });
		expect(prompt).toContain("No captions applied yet");
	});

	test("includes reference style signals when present", () => {
		const summary = buildMinimalSummary({
			reference_analysis_snapshot: {
				transition_cadence: "slow",
				average_shot_ms: 3000,
				caption_tone: "luxury",
				caption_reveal_preset_id: null,
				audio_mood: "luxury",
				recommended_music_asset_id: null,
				recommended_sfx_asset_id: null,
				overlay_variant_id: null,
				polish_profile_id: null,
				finishing_look_id: null,
				publish_destination: null,
				target_version_id: null,
				hook_pattern: "text-tease",
			},
		});
		const prompt = buildCreativeSystemPrompt({ projectSummary: summary });
		expect(prompt).toContain("Reference style: slow pacing");
		expect(prompt).toContain("luxury caption tone");
		expect(prompt).toContain("hook pattern: text-tease");
	});
});
