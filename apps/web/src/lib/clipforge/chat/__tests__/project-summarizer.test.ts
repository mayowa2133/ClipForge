import { describe, expect, test } from "bun:test";
import {
	buildDefaultClipForgeProjectData,
	buildProjectSummary,
} from "@/lib/clipforge";
import type { TProject } from "@/types/project";

describe("buildProjectSummary", () => {
	test("uses indexed clip metadata for transcript snippets and enriches segment metadata", () => {
		const project: TProject = {
			metadata: {
				id: "project-1",
				name: "Summary",
				duration: 3,
				createdAt: new Date("2026-02-27T00:00:00.000Z"),
				updatedAt: new Date("2026-02-27T00:00:00.000Z"),
			},
			scenes: [
				{
					id: "scene-1",
					name: "Main",
					isMain: true,
					bookmarks: [],
					createdAt: new Date("2026-02-27T00:00:00.000Z"),
					updatedAt: new Date("2026-02-27T00:00:00.000Z"),
					tracks: [
						{
							id: "video-1",
							type: "video",
							name: "Video",
							isMain: true,
							muted: false,
							hidden: false,
							elements: [
								{
									id: "clip-1",
									type: "video",
									name: "Clip",
									mediaId: "media-1",
									startTime: 0,
									duration: 1,
									trimStart: 0,
									trimEnd: 0,
									muted: false,
									hidden: false,
									transform: {
										scale: 1,
										position: { x: 0, y: 0 },
										rotate: 0,
									},
									opacity: 1,
								},
							],
						},
						{
							id: "text-1",
							type: "text",
							name: "Captions",
							hidden: false,
							elements: [
								{
									id: "caption-1",
									type: "text",
									name: "Caption line",
									content: "hello world",
									startTime: 1,
									duration: 1,
									trimStart: 0,
									trimEnd: 0,
									background: {
										color: "transparent",
										cornerRadius: 0,
										paddingX: 0,
										paddingY: 0,
										offsetX: 0,
										offsetY: 0,
									},
									fontSize: 48,
									fontFamily: "Arial",
									color: "#fff",
									textAlign: "center",
									fontWeight: "normal",
									fontStyle: "normal",
									textDecoration: "none",
									transform: {
										scale: 1,
										position: { x: 0, y: 0 },
										rotate: 0,
									},
									opacity: 1,
									blendMode: "normal",
									hidden: false,
								},
							],
						},
					],
				},
			],
			currentSceneId: "scene-1",
			settings: {
				fps: 30,
				canvasSize: { width: 1920, height: 1080 },
				background: { type: "color", color: "#000" },
			},
			version: 8,
			clipforge: {
				...buildDefaultClipForgeProjectData(),
				mediaMetadataById: {
					"media-1": {
						words: [
							{ text: "hello", start_ms: 0, end_ms: 500 },
							{ text: "world", start_ms: 500, end_ms: 1000 },
						],
						segments: [{ text: "hello world", start_ms: 0, end_ms: 1000 }],
						silenceRegions: [],
						transcriptionStatus: "ready",
						transcriptionProvider: "browser-whisper",
						transcriptionLanguage: "en",
						transcriptionError: null,
						indexedAt: "2026-02-27T00:00:00.000Z",
					},
				},
			},
		};

		const summary = buildProjectSummary({ project });

		expect(summary.segments[0]).toMatchObject({
			segment_id: "clip-1",
			segment_kind: "video",
			ordinal: 1,
			asset_id: "media-1",
			text_content: "",
			transcript_snippet: "hello world",
		});
		expect(summary.segments[1]).toMatchObject({
			segment_id: "caption-1",
			segment_kind: "caption",
			ordinal: 1,
			asset_id: null,
			text_content: "hello world",
			transcript_snippet: "hello world",
		});
		expect(summary.timeline_words).toEqual([
			{
				text: "hello",
				start_ms: 0,
				end_ms: 500,
				segment_id: "clip-1",
				media_id: "media-1",
			},
			{
				text: "world",
				start_ms: 500,
				end_ms: 1000,
				segment_id: "clip-1",
				media_id: "media-1",
			},
		]);
	});

	test("surfaces selection, playhead, templates, and recent chat memory", () => {
		const project: TProject = {
			metadata: {
				id: "project-2",
				name: "Memory Summary",
				duration: 6,
				createdAt: new Date("2026-03-01T00:00:00.000Z"),
				updatedAt: new Date("2026-03-01T00:00:00.000Z"),
			},
			scenes: [
				{
					id: "scene-main",
					name: "Main",
					isMain: true,
					bookmarks: [],
					createdAt: new Date("2026-03-01T00:00:00.000Z"),
					updatedAt: new Date("2026-03-01T00:00:00.000Z"),
					tracks: [
						{
							id: "video-main",
							type: "video",
							name: "Video",
							isMain: true,
							muted: false,
							hidden: false,
							elements: [
								{
									id: "clip-a",
									type: "video",
									name: "Clip A",
									mediaId: "media-a",
									startTime: 0,
									duration: 2,
									trimStart: 0,
									trimEnd: 0,
									transform: {
										scale: 1,
										position: { x: 0, y: 0 },
										rotate: 0,
									},
									opacity: 1,
								},
								{
									id: "clip-b",
									type: "video",
									name: "Clip B",
									mediaId: "media-b",
									startTime: 2,
									duration: 2,
									trimStart: 0,
									trimEnd: 0,
									transform: {
										scale: 1,
										position: { x: 0, y: 0 },
										rotate: 0,
									},
									opacity: 1,
								},
							],
						},
					],
				},
				{
					id: "scene-b",
					name: "B-Roll",
					isMain: false,
					bookmarks: [],
					createdAt: new Date("2026-03-01T00:00:00.000Z"),
					updatedAt: new Date("2026-03-01T00:00:00.000Z"),
					tracks: [],
				},
			],
			currentSceneId: "scene-main",
			settings: {
				fps: 30,
				canvasSize: { width: 1920, height: 1080 },
				background: { type: "color", color: "#000000" },
				audio: {
					masterVolume: 1,
					duckingEnabled: true,
					duckingAmount: 0.45,
					duckingAttackMs: 120,
					duckingReleaseMs: 280,
					audioPolishPresetId: "none",
				},
				overlayDefaults: {
					variantId: "clean-vlog",
					motionPresetId: "fade-up",
				},
				versionPack: {
					targets: [
						{
							id: "9:16",
							enabled: true,
							canvasSize: { width: 1080, height: 1920 },
						},
					],
					activeTargetId: "9:16",
				},
			},
			version: 8,
			clipforge: {
				...buildDefaultClipForgeProjectData(),
				chatMemory: {
					activeTargets: ["clip-b"],
					styleIntent: null,
					publishIntent: null,
					finishIntent: null,
					destinationIntent: null,
					referenceIntent: null,
					recentTurnSummaries: [
						{
							prompt: "add a subtle transition",
							summary:
								"add a subtle transition -> Applied cross-dissolve transitions at 300ms.",
							commandKinds: ["set-transition-in"],
							createdAt: "2026-03-01T10:01:00.000Z",
						},
					],
					recentAppliedCommandSummaries: [
						{
							kind: "set-transition-in",
							summary: "Applied cross-dissolve transitions at 300ms.",
							targetSegmentIds: ["clip-b"],
							targetElementIds: [],
							sceneId: "scene-main",
							scope: "scene",
							createdAt: "2026-03-01T10:01:00.000Z",
						},
					],
					recentAssetChoices: [],
					recentReferenceComparisons: [],
				},
			},
		};

		const summary = buildProjectSummary({
			project,
			playheadMs: 2300,
			selectedSegmentIds: ["clip-b"],
			projectKitTemplates: [
				{ id: "kit-1", name: "Clean Vlog", kind: "project-kit", version: 1, createdAt: new Date(), updatedAt: new Date(), payload: {} },
			],
			sceneRecipeTemplates: [
				{ id: "recipe-1", name: "Hook Scene", kind: "scene-recipe", version: 1, createdAt: new Date(), updatedAt: new Date(), payload: { elements: [], duration: 4, defaults: {} } },
			],
		});

		expect(summary.selection.selected_segment_ids).toEqual(["clip-b"]);
		expect(summary.playhead_neighborhood.nearby_segments.map((segment) => segment.segment_id)).toContain("clip-b");
		expect(summary.other_scene_summaries[0]?.scene_id).toBe("scene-b");
		expect(summary.available_project_kits[0]?.id).toBe("kit-1");
		expect(summary.available_scene_recipes[0]?.id).toBe("recipe-1");
		expect(summary.recent_ai_actions[0]?.kind).toBe("set-transition-in");
		expect(summary.recent_turn_summaries[0]).toContain("add a subtle transition");
	});

	test("surfaces the active reference video and readiness snapshot", () => {
		const project: TProject = {
			metadata: {
				id: "project-reference",
				name: "Reference Summary",
				duration: 6,
				createdAt: new Date("2026-03-01T00:00:00.000Z"),
				updatedAt: new Date("2026-03-01T00:00:00.000Z"),
			},
			scenes: [
				{
					id: "scene-main",
					name: "Main",
					isMain: true,
					bookmarks: [],
					createdAt: new Date("2026-03-01T00:00:00.000Z"),
					updatedAt: new Date("2026-03-01T00:00:00.000Z"),
					tracks: [],
				},
			],
			currentSceneId: "scene-main",
			settings: {
				fps: 30,
				canvasSize: { width: 1080, height: 1920 },
				background: { type: "color", color: "#000" },
			},
			version: 8,
			clipforge: {
				...buildDefaultClipForgeProjectData(),
				activeReferenceVideoAssetId: "reference-1",
				mediaMetadataById: {
					"reference-1": {
						words: [
							{ text: "watch", start_ms: 0, end_ms: 200 },
							{ text: "this", start_ms: 200, end_ms: 420 },
						],
						segments: [{ text: "watch this", start_ms: 0, end_ms: 420 }],
						silenceRegions: [],
						transcriptionStatus: "ready",
						transcriptionProvider: "browser-whisper",
						transcriptionLanguage: "en",
						transcriptionError: null,
						indexedAt: "2026-03-01T00:00:00.000Z",
					},
				},
				referenceAnalysisByAssetId: {
					"reference-1": {
						analyzedAt: "2026-03-01T00:00:00.000Z",
						status: "ready",
						sectionPlan: [
							{ label: "Hook", start_ms: 0, end_ms: 1000, role: "hook" },
						],
						shotPattern: {
							average_shot_ms: 1200,
							transition_cadence: "fast",
							scene_cut_count: 5,
							activity_intensity: "high",
						},
						captionProfile: {
							presence: "heavy",
							reveal_preset_id: "pop-line",
							tone: "bold",
							average_words_per_segment: 3.2,
						},
						audioProfile: {
							music_mood: "energetic",
							recommended_music_asset_id: "energetic-bounce",
							recommended_sfx_asset_id: "subtle-hit",
							bpm: 128,
							energy: "high",
						},
						overlayProfile: {
							density: "light",
							variant_id: "bold-social",
							motion_preset_id: "slide-up",
						},
						finishingProfile: {
							polish_profile_id: "bold-social",
							finishing_look_id: "dramatic",
						},
						publishProfile: {
							publish_destination: "tiktok",
							target_version_id: "9:16",
							packaging_hint: "Short-form packaging.",
							hook_pattern: "front-loaded hook",
						},
						warnings: [],
					},
				},
			},
		};

		const summary = buildProjectSummary({
			project,
			mediaAssets: [
				{
					id: "reference-1",
					name: "reference.mp4",
					type: "video",
					duration: 6,
					width: 1080,
					height: 1920,
					file: new File(["video"], "reference.mp4", { type: "video/mp4" }),
				},
			],
		});

		expect(summary.active_reference_video?.asset_id).toBe("reference-1");
		expect(summary.reference_analysis_snapshot?.caption_tone).toBe("bold");
		expect(summary.reference_match_readiness.ready).toBe(true);
	});
});
