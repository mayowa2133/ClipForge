import { describe, expect, test } from "bun:test";
import { HeuristicChatOpsProvider } from "@/lib/clipforge";
import type { ChatPlannerContext, ProjectSummary } from "@/lib/clipforge/chat";

function buildSummary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
	const segments: ProjectSummary["segments"] = [
		{
			segment_id: "seg-1",
			track_id: "track-video",
			scene_id: "scene-main",
			track_type: "video",
			segment_kind: "video",
			start_ms: 1000,
			end_ms: 3000,
			ordinal: 1,
			asset_id: "clip-1",
			element_name: "Opener",
			text_content: "",
			transcript_snippet: "hey bro clipforge welcome",
		},
		{
			segment_id: "seg-2",
			track_id: "track-video",
			scene_id: "scene-main",
			track_type: "video",
			segment_kind: "video",
			start_ms: 3000,
			end_ms: 6000,
			ordinal: 2,
			asset_id: "clip-2",
			element_name: "Body",
			text_content: "",
			transcript_snippet: "summer vibes clipforge",
		},
		{
			segment_id: "caption-1",
			track_id: "track-text",
			scene_id: "scene-main",
			track_type: "text",
			segment_kind: "caption",
			start_ms: 1200,
			end_ms: 2000,
			ordinal: 1,
			asset_id: null,
			element_name: "Caption 1",
			text_content: "teh hook demo",
			transcript_snippet: "teh hook demo",
		},
		{
			segment_id: "caption-2",
			track_id: "track-text",
			scene_id: "scene-main",
			track_type: "text",
			segment_kind: "caption",
			start_ms: 3400,
			end_ms: 4200,
			ordinal: 2,
			asset_id: null,
			element_name: "Caption 2",
			text_content: "demo again",
			transcript_snippet: "demo again",
		},
		{
			segment_id: "overlay-1",
			track_id: "track-text",
			scene_id: "scene-main",
			track_type: "text",
			segment_kind: "text-overlay",
			start_ms: 6500,
			end_ms: 9000,
			ordinal: 1,
			asset_id: null,
			element_name: "Overlay 1",
			text_content: "watch this",
			transcript_snippet: "watch this",
		},
	];
	return {
		total_duration_s: 50,
		current_scene_id: "scene-main",
		caption_style_id: "clean-bottom",
		pause_stats: { region_count: 0, total_pause_ms: 0 },
		segments,
		current_scene_segments: segments,
		other_scene_summaries: [],
		media_assets: [
			{
				asset_id: "beach-1",
				name: "beach.mp4",
				type: "video",
			},
		],
		selection: {
			selected_segment_ids: [],
			selected_segments: [],
		},
		playhead_neighborhood: {
			playhead_ms: 0,
			nearby_segments: segments.slice(0, 2),
		},
		version_pack: {
			targets: [
				{ id: "9:16", enabled: true, canvasSize: { width: 1080, height: 1920 } },
				{ id: "1:1", enabled: true, canvasSize: { width: 1080, height: 1080 } },
				{ id: "16:9", enabled: false, canvasSize: { width: 1920, height: 1080 } },
			],
			activeTargetId: "9:16",
		},
		audio_mix: {
			masterVolume: 1,
			duckingEnabled: true,
			duckingAmount: 0.45,
			duckingAttackMs: 120,
			duckingReleaseMs: 280,
			audioPolishPresetId: "none",
		},
		overlay_defaults: {
			variantId: "clean-vlog",
			motionPresetId: "fade-up",
		},
		brand_kit: null,
		available_project_kits: [
			{ id: "kit-clean", name: "Clean Vlog Kit", kind: "project-kit" },
		],
		available_scene_recipes: [],
		media_analysis_markers: [],
		available_music_assets: [
			{
				asset_id: "clean-cruise",
				label: "Clean Cruise",
				kind: "music",
				mood: "clean",
				usage_kind: "music",
				bpm: 96,
				default_duration_ms: null,
				tags: ["clean"],
				allowed_destinations: ["generic-export", "tiktok", "instagram", "youtube"],
				rights_profile: "universal",
			},
			{
				asset_id: "energetic-bounce",
				label: "Energetic Bounce",
				kind: "music",
				mood: "energetic",
				usage_kind: "music",
				bpm: 132,
				default_duration_ms: null,
				tags: ["energetic"],
				allowed_destinations: ["generic-export", "tiktok", "instagram", "youtube"],
				rights_profile: "universal",
			},
		],
		available_sfx_assets: [
			{
				asset_id: "whoosh-soft",
				label: "Whoosh Soft",
				kind: "sfx",
				mood: null,
				usage_kind: "transition-air",
				bpm: null,
				default_duration_ms: 450,
				tags: ["transition"],
				allowed_destinations: ["generic-export", "tiktok", "instagram", "youtube"],
				rights_profile: "universal",
			},
			{
				asset_id: "subtle-hit",
				label: "Subtle Hit",
				kind: "sfx",
				mood: null,
				usage_kind: "transition-impact",
				bpm: null,
				default_duration_ms: 120,
				tags: ["subtle"],
				allowed_destinations: ["generic-export", "tiktok", "instagram", "youtube"],
				rights_profile: "universal",
			},
		],
		trend_reference_summary: [],
		publish_destination: null,
		export_preflight_snapshot: {
			ready: true,
			blocking_count: 0,
			warning_count: 0,
			actionable_actions: [],
			issue_codes: [],
		},
		packaging_readiness: {
			ready: true,
			status: "ready",
			reason: "No blockers.",
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
				text: "clipforge",
				start_ms: 1450,
				end_ms: 1700,
				segment_id: "seg-1",
				media_id: "clip-1",
			},
			{
				text: "welcome",
				start_ms: 1700,
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
		...overrides,
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

async function proposeWithSummary({
	provider,
	userText,
	projectSummary,
	context,
	overrides,
}: {
	provider: HeuristicChatOpsProvider;
	userText: string;
	projectSummary?: ProjectSummary;
	context?: Partial<ChatPlannerContext>;
	overrides?: Parameters<HeuristicChatOpsProvider["proposeEdits"]>[0]["overrides"];
}) {
	return provider.proposeEdits({
		userText,
		projectSummary: projectSummary ?? buildSummary(),
		context: buildContext(context),
		overrides,
	});
}

describe("HeuristicChatOpsProvider", () => {
	test("returns deterministic ops for common edit intents in clause order", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await proposeWithSummary({
			provider,
			// Silence regions present so the "remove pauses" clause resolves to a
			// REMOVE_SILENCE op rather than the analyze-first clarification.
			projectSummary: buildSummary({
				pause_stats: { region_count: 5, total_pause_ms: 4000 },
			}),
			userText: "make it faster and remove more pauses and use bold center captions",
		});

		expect((result.ops ?? []).map((op) => op.type)).toEqual([
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

	test("returns clarification for ambiguous selected clip references", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "delete this clip",
			context: { selected_segment_ids: ["seg-1", "seg-2"] },
		});

		expect(result.ops).toEqual([]);
		expect(result.clarification?.referenceLabel).toBe("selection:clip");
		expect(result.clarification?.options).toHaveLength(2);
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

	test("returns clarification for ambiguous caption replacements", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: 'replace "demo" with "sample" in captions',
		});

		expect(result.ops).toEqual([]);
		expect(result.clarification?.options).toHaveLength(2);
	});

	test("supports clarification overrides for a re-plan", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await provider.proposeEdits({
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
		expect(result.ops).toEqual([
			{
				type: "DELETE_SEGMENT",
				segment_id: "seg-2",
			},
		]);
	});

	test("stops and returns clarification when an early clause is ambiguous", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: 'delete the clip where i say "clipforge" and make it faster',
		});

		expect(result.ops).toEqual([]);
		expect(result.clarification?.options).toHaveLength(2);
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

		expect((result.ops ?? []).map((op) => op.type)).toEqual([
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

	test("emits a clip-speed command for opener speed requests", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await provider.proposeEdits({
			userText: "speed up the opener 15%",
			projectSummary: buildSummary(),
			context: buildContext(),
		});

		expect(result.commands).toEqual([
			{
				kind: "set-clip-speed",
				target_segment_ids: ["seg-1"],
				playback_rate: 1.15,
				ripple: true,
				scope: "selection",
			},
		]);
	});

	test("falls back to top-level segments when current scene video summaries are empty", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await provider.proposeEdits({
			userText: "Speed up the opener 15%",
			projectSummary: buildSummary({
				current_scene_segments: [],
			}),
			context: buildContext(),
		});

		expect(result.commands).toEqual([
			{
				kind: "set-clip-speed",
				target_segment_ids: ["seg-1"],
				playback_rate: 1.15,
				ripple: true,
				scope: "selection",
			},
		]);
	});

	test("emits a transition command for next-shot follow-ups using recent memory", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await provider.proposeEdits({
			userText: "add a subtle transition into the next shot",
			projectSummary: buildSummary({
				recent_ai_actions: [
					{
						kind: "set-clip-speed",
						summary: "Set clip speed to 115%.",
						targetSegmentIds: ["seg-1"],
						targetElementIds: [],
						sceneId: "scene-main",
						scope: "selection",
						createdAt: "2026-03-12T10:00:00.000Z",
					},
				],
				recent_turn_summaries: [
					"speed up the opener 15% -> Set clip speed to 115%.",
				],
			}),
			context: buildContext(),
		});

		expect(result.commands).toEqual([
			{
				kind: "set-transition-in",
				target_segment_ids: ["seg-2"],
				preset: "cross-dissolve",
				duration_ms: 300,
				scope: "scene",
			},
		]);
	});

	test("repeats the previous transition command across the next cuts", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await provider.proposeEdits({
			userText: "do that to the next two cuts",
			projectSummary: buildSummary({
				segments: [
					...buildSummary().segments,
					{
						segment_id: "seg-3",
						track_id: "track-video",
						scene_id: "scene-main",
						track_type: "video",
						segment_kind: "video",
						start_ms: 6000,
						end_ms: 8500,
						ordinal: 3,
						asset_id: "clip-3",
						element_name: "Clip 3",
						text_content: "",
						transcript_snippet: "third shot",
					},
					{
						segment_id: "seg-4",
						track_id: "track-video",
						scene_id: "scene-main",
						track_type: "video",
						segment_kind: "video",
						start_ms: 8500,
						end_ms: 11000,
						ordinal: 4,
						asset_id: "clip-4",
						element_name: "Clip 4",
						text_content: "",
						transcript_snippet: "fourth shot",
					},
				],
				current_scene_segments: [
					...buildSummary().segments,
					{
						segment_id: "seg-3",
						track_id: "track-video",
						scene_id: "scene-main",
						track_type: "video",
						segment_kind: "video",
						start_ms: 6000,
						end_ms: 8500,
						ordinal: 3,
						asset_id: "clip-3",
						element_name: "Clip 3",
						text_content: "",
						transcript_snippet: "third shot",
					},
					{
						segment_id: "seg-4",
						track_id: "track-video",
						scene_id: "scene-main",
						track_type: "video",
						segment_kind: "video",
						start_ms: 8500,
						end_ms: 11000,
						ordinal: 4,
						asset_id: "clip-4",
						element_name: "Clip 4",
						text_content: "",
						transcript_snippet: "fourth shot",
					},
				],
				recent_ai_actions: [
					{
						kind: "set-transition-in",
						summary: "Applied cross-dissolve transitions at 300ms.",
						targetSegmentIds: ["seg-2"],
						targetElementIds: [],
						sceneId: "scene-main",
						scope: "scene",
						createdAt: "2026-03-12T10:01:00.000Z",
					},
				],
				recent_turn_summaries: [
					"add a subtle transition into the next shot -> Applied cross-dissolve transitions at 300ms.",
				],
			}),
			context: buildContext(),
		});

		expect(result.commands).toEqual([
			{
				kind: "set-transition-in",
				target_segment_ids: ["seg-3", "seg-4"],
				preset: "cross-dissolve",
				duration_ms: 300,
				scope: "scene",
			},
		]);
	});

	test("emits an audio mix command for stronger music ducking", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await provider.proposeEdits({
			userText: "duck the music more",
			projectSummary: buildSummary(),
			context: buildContext(),
		});

		expect(result.commands).toEqual([
			{
				kind: "set-audio-mix",
				settings: {
					duckingEnabled: true,
					duckingAmount: 0.55,
				},
				scope: "project",
			},
		]);
	});

	test("emits a separate-audio command", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "separate audio from the opener",
		});

		expect(result.commands).toEqual([
			{
				kind: "separate-audio",
				target_segment_ids: ["seg-1"],
				scope: "selection",
			},
		]);
	});

	test("emits a freeze-frame command anchored to the playhead", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "freeze opener for 1.2s",
			context: { playhead_ms: 1600 },
		});

		expect(result.commands).toEqual([
			{
				kind: "insert-freeze-frame",
				target_segment_id: "seg-1",
				at_ms: 1600,
				duration_ms: 1200,
				ripple: true,
				scope: "selection",
			},
		]);
	});

	test("emits a finishing-look command", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "apply a warm finishing look to the opener",
		});

		expect(result.commands).toEqual([
			{
				kind: "apply-finishing-look",
				target_segment_ids: ["seg-1"],
				preset_id: "warm",
				scope: "selection",
			},
		]);
	});

	test("emits an effect command", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "add a blur effect to the opener",
		});

		expect(result.commands).toEqual([
			{
				kind: "apply-effect-preset",
				target_segment_ids: ["seg-1"],
				effect_kind: "blur",
				scope: "selection",
			},
		]);
	});

	test("emits an overlay preset command", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "add a timestamp card for 3s",
			context: { playhead_ms: 2400 },
		});

		expect(result.commands).toEqual([
			{
				kind: "insert-overlay-preset",
				preset_id: "timestamp-card",
				variant_id: null,
				motion_preset_id: null,
				start_ms: 2400,
				duration_ms: 3000,
				scope: "scene",
			},
		]);
	});

	test("emits an overlay-style command", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "make the overlays bold",
		});

		expect(result.commands).toEqual([
			{
				kind: "apply-overlay-style",
				target_element_ids: ["overlay-1"],
				variant_id: "bold-social",
				scope: "scene",
			},
		]);
	});

	test("emits a motion-preset command", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "make the overlays drift in",
		});

		expect(result.commands).toEqual([
			{
				kind: "apply-motion-preset",
				target_element_ids: ["overlay-1"],
				motion_preset_id: "drift-in",
				scope: "scene",
			},
		]);
	});

	test("emits a sound-sync command for graphics", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "use typing soft on graphics",
		});

		expect(result.commands).toEqual([
			{
				kind: "apply-sound-sync",
				target_element_ids: ["overlay-1"],
				pairing_id: "typing-soft",
				scope: "scene",
			},
		]);
	});

	test("emits a project-kit command", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "apply clean vlog kit",
		});

		expect(result.commands).toEqual([
			{
				kind: "apply-project-kit",
				kit_id: "kit-clean",
				scope: "project",
			},
		]);
	});

	test("emits a version-pack command", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "set versions to 9:16, 1:1",
		});

		expect(result.commands).toEqual([
			{
				kind: "set-version-pack",
				target_ids: ["9:16", "1:1"],
				active_target_id: "9:16",
				scope: "project",
			},
		]);
	});

	test("emits an auto-reframe command", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "reframe for 9:16",
		});

		expect(result.commands).toEqual([
			{
				kind: "auto-reframe-selection",
				target_version_id: "9:16",
				scope: "selection",
			},
		]);
	});

	test("asks for a transition preset when the intent is ambiguous", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "add a transition into the opener",
		});

		expect(result.commands).toEqual([]);
		expect(result.clarification?.kind).toBe("preset");
		expect(result.clarification?.referenceLabel).toBe("preset:transition");
	});

	test("asks for scope when overlay styling could mean selection or scene", async () => {
		const provider = new HeuristicChatOpsProvider();
		const overlaySelection = buildSummary().segments.find(
			(segment) => segment.segment_id === "overlay-1",
		);
		const overlayTwo = {
			segment_id: "overlay-2",
			track_id: "track-text",
			scene_id: "scene-main",
			track_type: "text",
			segment_kind: "text-overlay" as const,
			start_ms: 9100,
			end_ms: 11200,
			ordinal: 2,
			asset_id: null,
			element_name: "Overlay 2",
			text_content: "second overlay",
			transcript_snippet: "second overlay",
		};
		const summary = buildSummary({
			segments: [...buildSummary().segments, overlayTwo],
			current_scene_segments: [...buildSummary().current_scene_segments, overlayTwo],
			selection: {
				selected_segment_ids: ["overlay-1"],
				selected_segments: overlaySelection ? [overlaySelection] : [],
			},
		});
		const result = await proposeWithSummary({
			provider,
			userText: "make the overlays clean",
			projectSummary: summary,
			context: { selected_segment_ids: ["overlay-1"] },
		});

		expect(result.commands).toEqual([]);
		expect(result.clarification?.kind).toBe("scope");
		expect(result.clarification?.referenceLabel).toBe("scope:overlay-style");
	});

	test("asks for a version target when auto reframe has no explicit destination", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "reframe this",
		});

		expect(result.commands).toEqual([]);
		expect(result.clarification?.kind).toBe("version-target");
		expect(result.clarification?.referenceLabel).toBe("version-target:auto-reframe");
	});

	test("emits a reference-guided finish pass command", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await proposeWithSummary({
			provider,
			userText: "finish this like the reference",
			projectSummary: buildSummary({
				active_reference_video: {
					asset_id: "beach-1",
					name: "beach.mp4",
					status: "ready",
					analyzed_at: "2026-03-12T00:00:00.000Z",
					intent_summary: "fast pacing · bold captions · energetic music feel",
					warnings: [],
				},
				reference_analysis_snapshot: {
					transition_cadence: "fast",
					average_shot_ms: 1200,
					caption_tone: "bold",
					caption_reveal_preset_id: "pop-line",
					audio_mood: "energetic",
					recommended_music_asset_id: "energetic-bounce",
					recommended_sfx_asset_id: "subtle-hit",
					overlay_variant_id: "bold-social",
					polish_profile_id: "bold-social",
					finishing_look_id: "dramatic",
					publish_destination: "tiktok",
					target_version_id: "9:16",
					hook_pattern: "front-loaded hook",
				},
				reference_match_readiness: {
					ready: true,
					status: "ready",
					reason: "Reference is ready.",
				},
			}),
		});

		expect(result.commands).toEqual([
			{
				kind: "apply-reference-finish-pass",
				reference_asset_id: "beach-1",
				scope: "scene",
			},
		]);
	});

	test("emits a caption-only reference command for follow-up prompts", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await proposeWithSummary({
			provider,
			userText: "only match the captions",
			projectSummary: buildSummary({
				active_reference_video: {
					asset_id: "beach-1",
					name: "beach.mp4",
					status: "ready",
					analyzed_at: "2026-03-12T00:00:00.000Z",
					intent_summary: "fast pacing · bold captions · energetic music feel",
					warnings: [],
				},
				reference_match_readiness: {
					ready: true,
					status: "ready",
					reason: "Reference is ready.",
				},
			}),
		});

		expect(result.commands).toEqual([
			{
				kind: "match-reference-captions",
				reference_asset_id: "beach-1",
				scope: "scene",
			},
		]);
	});

	test("asks for a reference asset when none is active", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await proposeWithSummary({
			provider,
			userText: "finish this like the reference",
			projectSummary: buildSummary({
				media_assets: [
					{ asset_id: "beach-1", name: "beach.mp4", type: "video" },
					{ asset_id: "city-clip", name: "city.mp4", type: "video" },
				],
			}),
		});

		expect(result.commands).toEqual([]);
		expect(result.clarification?.kind).toBe("asset");
		expect(result.clarification?.referenceLabel).toBe("asset:reference-video");
	});

	test("builds a reference-guided draft plan", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await proposeWithSummary({
			provider,
			userText: "build my draft like the reference",
			projectSummary: buildSummary({
				active_reference_video: {
					asset_id: "beach-1",
					name: "beach.mp4",
					status: "ready",
					analyzed_at: "2026-03-12T00:00:00.000Z",
					intent_summary: "tight hook · fast body cadence · payoff ending",
					warnings: [],
				},
				reference_match_readiness: {
					ready: true,
					status: "ready",
					reason: "Reference is ready.",
				},
				assembly_source_pool: [
					{
						asset_id: "gym-clip-1",
						name: "gym clip 1",
						descriptor_summary: "steady medium-energy gym push shot",
					},
					{
						asset_id: "gym-clip-2",
						name: "gym clip 2",
						descriptor_summary: "faster gym sprint shot",
					},
					{
						asset_id: "street-clip-1",
						name: "street clip 1",
						descriptor_summary: "wider street b-roll",
					},
				],
				footage_match_readiness: {
					ready: true,
					status: "ready",
					reason: "Source pool is ready for assembly.",
				},
				reference_shot_plan: {
					hook_pattern: "front-loaded hook",
					ending_shape: "payoff",
					sections: [
						{
							match_id: "match-hook",
							label: "Hook",
							role: "hook",
							target_duration_ms: 900,
							description: "Fast first punch-in hook.",
						},
						{
							match_id: "match-payoff",
							label: "Payoff",
							role: "payoff",
							target_duration_ms: 1200,
							description: "Clean payoff ending.",
						},
					],
				},
				candidate_source_matches: [
					{
						match_id: "match-hook",
						section_label: "Hook",
						section_role: "hook",
						selected_asset_id: "gym-clip-1",
						selected_asset_name: "gym clip 1",
						reasons: ["Strong early activity."],
						candidate_asset_ids: ["gym-clip-1", "gym-clip-2"],
						locked: false,
					},
					{
						match_id: "match-payoff",
						section_label: "Payoff",
						section_role: "payoff",
						selected_asset_id: "street-clip-1",
						selected_asset_name: "street clip 1",
						reasons: ["Longest stable payoff clip."],
						candidate_asset_ids: ["street-clip-1", "gym-clip-2"],
						locked: false,
					},
				],
			}),
		});

		expect(result.commands ?? []).toHaveLength(1);
		expect(result.commands?.[0]).toMatchObject({
			kind: "build-reference-recreation-draft",
			reference_asset_id: "beach-1",
			source_asset_ids: ["gym-clip-1", "gym-clip-2", "street-clip-1"],
			include_finish_pass: true,
			require_transcript: false,
			scope: "project",
		});
	});

	test("excludes the chosen reference from recreation source ids", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await proposeWithSummary({
			provider,
			userText: "match the reference",
			projectSummary: buildSummary({
				media_assets: [
					{ asset_id: "reference-1", name: "finished.mp4", type: "video" },
					{ asset_id: "raw-1", name: "raw.mp4", type: "video" },
				],
				assembly_source_pool: [
					{
						asset_id: "reference-1",
						name: "finished.mp4",
						descriptor_summary: "edited reference video",
					},
					{
						asset_id: "raw-1",
						name: "raw.mp4",
						descriptor_summary: "raw talking-head source",
					},
				],
				imported_audio_assets: [
					{
						asset_id: "music-1",
						name: "MUSIC-background.mp3",
						type: "audio",
						duration_ms: 85_000,
					},
				],
			}),
			overrides: {
				forced_segment_ids_by_reference: {},
				forced_choice_values_by_reference: {
					"asset:reference-video": "reference-1",
				},
			},
		});

		expect(result.commands?.[0]).toMatchObject({
			kind: "build-reference-recreation-draft",
			reference_asset_id: "reference-1",
			source_asset_ids: ["raw-1"],
			music_asset_id: "music-1",
		});
	});

	test("focuses the hook when refining a reference draft", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await proposeWithSummary({
			provider,
			userText: "make the hook closer to the reference",
			projectSummary: buildSummary({
				active_reference_video: {
					asset_id: "beach-1",
					name: "beach.mp4",
					status: "ready",
					analyzed_at: "2026-03-12T00:00:00.000Z",
					intent_summary: "tight hook · fast body cadence · payoff ending",
					warnings: [],
				},
				reference_match_readiness: {
					ready: true,
					status: "ready",
					reason: "Reference is ready.",
				},
				assembly_source_pool: [
					{
						asset_id: "gym-clip-1",
						name: "gym clip 1",
						descriptor_summary: "steady medium-energy gym push shot",
					},
					{
						asset_id: "gym-clip-2",
						name: "gym clip 2",
						descriptor_summary: "faster gym sprint shot",
					},
				],
				footage_match_readiness: {
					ready: true,
					status: "ready",
					reason: "Source pool is ready for assembly.",
				},
				reference_shot_plan: {
					hook_pattern: "front-loaded hook",
					ending_shape: "payoff",
					sections: [
						{
							match_id: "match-hook",
							label: "Hook",
							role: "hook",
							target_duration_ms: 900,
							description: "Fast first punch-in hook.",
						},
					],
				},
				candidate_source_matches: [
					{
						match_id: "match-hook",
						section_label: "Hook",
						section_role: "hook",
						selected_asset_id: "gym-clip-1",
						selected_asset_name: "gym clip 1",
						reasons: ["Strong early activity."],
						candidate_asset_ids: ["gym-clip-1", "gym-clip-2"],
						locked: false,
					},
				],
			}),
		});

		expect(result.commands ?? []).toHaveLength(1);
		expect(result.commands?.[0]).toMatchObject({
			kind: "build-reference-draft",
			focus_match_ids: ["match-hook"],
		});
	});

	test("swaps a reference draft section to the second named source clip", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await proposeWithSummary({
			provider,
			userText: "use the second gym clip instead",
			projectSummary: buildSummary({
				active_reference_video: {
					asset_id: "beach-1",
					name: "beach.mp4",
					status: "ready",
					analyzed_at: "2026-03-12T00:00:00.000Z",
					intent_summary: "tight hook · fast body cadence · payoff ending",
					warnings: [],
				},
				assembly_source_pool: [
					{
						asset_id: "gym-clip-1",
						name: "gym clip 1",
						descriptor_summary: "steady medium-energy gym push shot",
					},
					{
						asset_id: "gym-clip-2",
						name: "gym clip 2",
						descriptor_summary: "faster gym sprint shot",
					},
				],
				candidate_source_matches: [
					{
						match_id: "match-hook",
						section_label: "Hook",
						section_role: "hook",
						selected_asset_id: "gym-clip-1",
						selected_asset_name: "gym clip 1",
						reasons: ["Strong early activity."],
						candidate_asset_ids: ["gym-clip-1", "gym-clip-2"],
						locked: false,
					},
				],
			}),
		});

		expect(result.commands).toEqual([
			{
				kind: "replace-with-source-match",
				match_id: "match-hook",
				asset_id: "gym-clip-2",
				scope: "scene",
			},
		]);
	});

	test("locks the ending match for reference assembly follow-ups", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await proposeWithSummary({
			provider,
			userText: "keep the current ending",
			projectSummary: buildSummary({
				active_reference_video: {
					asset_id: "beach-1",
					name: "beach.mp4",
					status: "ready",
					analyzed_at: "2026-03-12T00:00:00.000Z",
					intent_summary: "tight hook · fast body cadence · payoff ending",
					warnings: [],
				},
				candidate_source_matches: [
					{
						match_id: "match-hook",
						section_label: "Hook",
						section_role: "hook",
						selected_asset_id: "gym-clip-1",
						selected_asset_name: "gym clip 1",
						reasons: ["Strong early activity."],
						candidate_asset_ids: ["gym-clip-1", "gym-clip-2"],
						locked: false,
					},
					{
						match_id: "match-ending",
						section_label: "Ending",
						section_role: "payoff",
						selected_asset_id: "street-clip-1",
						selected_asset_name: "street clip 1",
						reasons: ["Clean payoff ending."],
						candidate_asset_ids: ["street-clip-1", "gym-clip-2"],
						locked: false,
					},
				],
			}),
		});

		expect(result.commands).toEqual([
			{
				kind: "lock-reference-match",
				match_id: "match-ending",
				scope: "project",
			},
		]);
	});
});

describe("planGazeCutClause", () => {
	const gazeMarker = {
		asset_id: "clip-1",
		name: "interview.mp4",
		beat_marker_count: 0,
		scene_cut_count: 0,
		activity_window_count: 0,
		gaze_window_count: 4,
		camera_look_ratio: 0.55,
		gaze_windows: [
			{ start_s: 0, end_s: 2, category: "camera" as const, confidence: 0.8 },
			{ start_s: 2, end_s: 4, category: "off-camera" as const, confidence: 0.75 },
			{ start_s: 4, end_s: 6, category: "off-camera" as const, confidence: 0.7 },
			{ start_s: 6, end_s: 8, category: "camera" as const, confidence: 0.8 },
		],
	};

	test("cuts the off-camera window after a transcript phrase", async () => {
		const provider = new HeuristicChatOpsProvider();
		// "bro" ends at 1450ms (1.45s) — the first off-camera window after 1.45s
		// is [2s, 4s], then extended through consecutive [4s, 6s] → merged [2s, 6s]
		const result = await proposeWithSummary({
			provider,
			userText: "cut where I'm looking down after I say 'bro'",
			projectSummary: buildSummary({ media_analysis_markers: [gazeMarker] }),
		});

		expect(result.ops).toEqual([
			{
				type: "CUT_RANGE",
				start_ms: 2000,
				end_ms: 6000,
			},
		]);
	});

	test("returns no ops when phrase is not in transcript", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await proposeWithSummary({
			provider,
			userText: "cut where I'm looking away after I say 'nonexistent phrase'",
			projectSummary: buildSummary({ media_analysis_markers: [gazeMarker] }),
		});
		expect(result.ops).toEqual([]);
	});

	test("returns no ops when no gaze analysis is available", async () => {
		const provider = new HeuristicChatOpsProvider();
		const result = await propose({
			provider,
			userText: "cut where I'm looking down after I say 'bro'",
		});
		expect(result.ops).toEqual([]);
	});

	test("returns no ops when there is no off-camera window after the phrase", async () => {
		const provider = new HeuristicChatOpsProvider();
		// "welcome" ends at 1900ms (1.9s); only on-camera windows exist after that point
		const result = await proposeWithSummary({
			provider,
			userText: "cut where I'm still looking away after I say 'welcome'",
			projectSummary: buildSummary({
				media_analysis_markers: [
					{
						asset_id: "clip-1",
						name: "interview.mp4",
						beat_marker_count: 0,
						scene_cut_count: 0,
						activity_window_count: 0,
						gaze_window_count: 2,
						camera_look_ratio: 0.9,
						gaze_windows: [
							{ start_s: 0, end_s: 1.5, category: "off-camera" as const, confidence: 0.7 },
							{ start_s: 2, end_s: 50, category: "camera" as const, confidence: 0.85 },
						],
					},
				],
			}),
		});
		expect(result.ops).toEqual([]);
	});
});
