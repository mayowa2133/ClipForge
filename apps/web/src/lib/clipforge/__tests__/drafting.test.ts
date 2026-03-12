import { describe, expect, test } from "bun:test";
import { buildDefaultProjectVersionPack } from "@/constants/project-constants";
import {
	buildCreativeBriefFromPrompt,
	buildDefaultClipForgeProjectData,
	planDraftRecipe,
} from "@/lib/clipforge";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type { ProjectKitTemplate } from "@/types/templates";

function buildProjectFixture(): TProject {
	const canvasSize = { width: 1080, height: 1920 };
	return {
		metadata: {
			id: "project-draft-1",
			name: "Draft Fixture",
			duration: 60,
			createdAt: new Date("2026-03-10T00:00:00.000Z"),
			updatedAt: new Date("2026-03-10T00:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-1",
				name: "Main",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-03-10T00:00:00.000Z"),
				updatedAt: new Date("2026-03-10T00:00:00.000Z"),
				tracks: [
					{
						id: "video-track-1",
						type: "video",
						name: "Main",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [
							{
								id: "video-1",
								type: "video",
								name: "Clip 1",
								mediaId: "video-1",
								startTime: 0,
								duration: 8,
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
		],
		currentSceneId: "scene-1",
		settings: {
			fps: 30,
			canvasSize,
			versionPack: buildDefaultProjectVersionPack({ canvasSize }),
			background: { type: "color", color: "#000000" },
		},
		version: 17,
		clipforge: {
			...buildDefaultClipForgeProjectData(),
			mediaMetadataById: {
				"video-1": {
					words: [
						{ text: "hello", start_ms: 0, end_ms: 400 },
						{ text: "world", start_ms: 400, end_ms: 900 },
					],
					segments: [{ text: "hello world", start_ms: 0, end_ms: 900 }],
					silenceRegions: [],
					transcriptionStatus: "ready",
					transcriptionProvider: "browser-whisper",
					transcriptionLanguage: "en",
					transcriptionError: null,
					indexedAt: "2026-03-10T00:00:00.000Z",
				},
			},
		},
	};
}

function buildMediaAsset({
	id,
	type,
	duration,
	beatAnalysis,
}: {
	id: string;
	type: "video" | "audio";
	duration?: number;
	beatAnalysis?: MediaAsset["beatAnalysis"];
}): MediaAsset {
	return {
		id,
		name: id,
		type,
		duration,
		beatAnalysis,
		file: new File(["fixture"], `${id}.${type === "video" ? "mp4" : "mp3"}`, {
			type: type === "video" ? "video/mp4" : "audio/mpeg",
		}),
	};
}

describe("drafting helpers", () => {
	test("buildCreativeBriefFromPrompt resolves deterministic defaults for a vague viral-tiktok prompt", () => {
		const brief = buildCreativeBriefFromPrompt({
			prompt: "make me a viral TikTok from this",
			project: buildProjectFixture(),
		});

		expect(brief.goal).toBe("viral-tiktok");
		expect(brief.tone).toBe("clean");
		expect(brief.durationTargetS).toBe(27);
		expect(brief.captionStyleId).toBe("clean-bottom");
		expect(brief.overlayStyleVariantId).toBe("clean-vlog");
		expect(brief.beatDivision).toBe(2);
		expect(brief.versionTargets).toEqual(["9:16"]);
	});

	test("buildCreativeBriefFromPrompt respects explicit style, duration, and version requests", () => {
		const brief = buildCreativeBriefFromPrompt({
			prompt:
				"make me a luxury morning routine tiktok in 18 seconds with bold captions for 1:1 and 16:9",
			project: buildProjectFixture(),
		});

		expect(brief.goal).toBe("luxury-routine");
		expect(brief.tone).toBe("luxury");
		expect(brief.durationTargetS).toBe(18);
		expect(brief.captionStyleId).toBe("bold-center");
		expect(brief.overlayStyleVariantId).toBe("luxury");
		expect(brief.versionTargets).toEqual(["9:16", "1:1", "16:9"]);
	});

	test("buildCreativeBriefFromPrompt resolves a saved trend reference when the prompt asks for that sound", () => {
		const project = buildProjectFixture();
		project.clipforge = {
			...project.clipforge!,
			trendSoundReferences: [
				{
					id: "trend-1",
					label: "Morning Luxury Sound",
					platform: "tiktok",
					creator: "Creator",
					sourceUrl: "https://tiktok.com/example",
					notes: "Use this vibe for luxury pacing.",
					createdAt: "2026-03-10T00:00:00.000Z",
				},
			],
		};

		const brief = buildCreativeBriefFromPrompt({
			prompt: "make this feel like that TikTok sound",
			project,
		});

		expect(brief.trendSoundReferenceId).toBe("trend-1");
	});

	test("planDraftRecipe includes core assembly steps and warnings when montage prerequisites are missing", () => {
		const project = buildProjectFixture();
		project.clipforge = {
			...project.clipforge!,
			mediaMetadataById: {},
		};
		const recipe = planDraftRecipe({
			brief: buildCreativeBriefFromPrompt({
				prompt: "make me a viral TikTok from this",
				project,
			}),
			project,
			mediaAssets: [buildMediaAsset({ id: "video-1", type: "video", duration: 8 })],
			beatSourceMediaId: null,
			beatMarkerCount: 0,
			projectKitTemplates: [],
		});

		expect(recipe.operations.map((step) => step.kind)).not.toContain("auto-edit");
		expect(recipe.operations.map((step) => step.kind)).toContain("make-version");
		expect(recipe.operations.map((step) => step.kind)).toContain("apply-caption-style");
		expect(recipe.operations.map((step) => step.kind)).toContain("apply-polish-profile");
		expect(recipe.operations.map((step) => step.kind)).not.toContain("auto-montage");
		expect(recipe.warnings).toContain(
			"No transcript metadata is available, so caption generation may be skipped.",
		);
		expect(recipe.warnings).toContain(
			"Retention shaping is unavailable, so structure falls back to clip order and basic duration tightening.",
		);
		expect(recipe.warnings).toContain(
			"No analyzed beat source is active, so beat-paced montage may be skipped.",
		);
	});

	test("planDraftRecipe includes caption generation and beat montage when prerequisites exist", () => {
		const project = buildProjectFixture();
		const recipe = planDraftRecipe({
			brief: buildCreativeBriefFromPrompt({
				prompt: "make me a viral TikTok from this",
				project,
			}),
			project,
			mediaAssets: [
				buildMediaAsset({ id: "video-1", type: "video", duration: 8 }),
				buildMediaAsset({
					id: "song-1",
					type: "audio",
					duration: 30,
					beatAnalysis: {
						bpm: 120,
						beats: [0, 0.5, 1, 1.5],
						downbeats: [0, 2],
						analyzedAt: "2026-03-10T00:00:00.000Z",
						version: 1,
					},
				}),
			],
			beatSourceMediaId: "song-1",
			beatMarkerCount: 16,
			projectKitTemplates: [],
		});

		expect(recipe.operations.map((step) => step.kind)).toContain("generate-captions");
		expect(recipe.operations.map((step) => step.kind)).toContain("auto-montage");
		expect(recipe.operations.map((step) => step.kind)).toContain("apply-polish-profile");
		const montageStep = recipe.operations.find((step) => step.kind === "auto-montage");
		expect(montageStep?.params.musicMediaId).toBe("song-1");
		expect(montageStep?.params.beatDivision).toBe(2);
	});

	test("planDraftRecipe surfaces a warning when a trend reference is used as a pacing cue only", () => {
		const project = buildProjectFixture();
		project.clipforge = {
			...project.clipforge!,
			trendSoundReferences: [
				{
					id: "trend-1",
					label: "Morning Luxury Sound",
					platform: "tiktok",
					creator: "Creator",
					sourceUrl: "https://tiktok.com/example",
					notes: "Use this vibe for luxury pacing.",
					createdAt: "2026-03-10T00:00:00.000Z",
				},
			],
		};

		const recipe = planDraftRecipe({
			brief: buildCreativeBriefFromPrompt({
				prompt: "make this feel like that TikTok sound",
				project,
			}),
			project,
			mediaAssets: [buildMediaAsset({ id: "video-1", type: "video", duration: 8 })],
			beatSourceMediaId: null,
			beatMarkerCount: 0,
			projectKitTemplates: [],
		});

		expect(recipe.warnings).toContain(
			'Using trend reference "Morning Luxury Sound" as a pacing/style cue only; you still need a valid bundled or imported audio track.',
		);
	});

	test("planDraftRecipe matches a project kit deterministically from the brief", () => {
		const project = buildProjectFixture();
		const projectKitTemplates: ProjectKitTemplate[] = [
			{
				id: "kit-luxury",
				name: "Luxury Routine Kit",
				kind: "project-kit",
				version: 1,
				createdAt: new Date("2026-03-10T00:00:00.000Z"),
				updatedAt: new Date("2026-03-10T00:00:00.000Z"),
				payload: {},
			},
		];

		const recipe = planDraftRecipe({
			brief: buildCreativeBriefFromPrompt({
				prompt: "make me a luxury routine tiktok",
				project,
			}),
			project,
			mediaAssets: [buildMediaAsset({ id: "video-1", type: "video", duration: 8 })],
			beatSourceMediaId: null,
			beatMarkerCount: 0,
			projectKitTemplates,
		});

		const step = recipe.operations.find((candidate) => candidate.kind === "apply-project-kit");
		expect(step?.params.kitId).toBe("kit-luxury");
	});

	test("planDraftRecipe prefers a ranked hook and keep/cut recommendations when scene assembly already exists", () => {
		const project = buildProjectFixture();
		const recipe = planDraftRecipe({
			brief: buildCreativeBriefFromPrompt({
				prompt: "make me a viral TikTok from this",
				project,
			}),
			project,
			mediaAssets: [buildMediaAsset({ id: "video-1", type: "video", duration: 8 })],
			beatSourceMediaId: null,
			beatMarkerCount: 0,
			projectKitTemplates: [],
			footageIntelligenceReport: {
				generatedAt: "2026-03-10T00:00:00.000Z",
				hookCandidates: [
					{
						id: "hook:video-1:0.000:1.200",
						trackId: "video-track-1",
						elementId: "video-1",
						startTime: 0,
						endTime: 1.2,
						score: 3.4,
						reasons: ["Starts early in the scene."],
					},
				],
				momentScores: [],
				keepCutRecommendations: [
					{
						id: "keep-cut:video-1",
						trackId: "video-track-1",
						elementId: "video-1",
						action: "trim",
						startTime: 0,
						endTime: 2.5,
						score: 2.1,
						reasons: ["Trim to the strongest sub-window."],
					},
				],
				warnings: [],
			},
		});

		expect(recipe.operations.map((step) => step.kind)).not.toContain("auto-edit");
		expect(recipe.hookCandidateId).toBe("hook:video-1:0.000:1.200");
		expect(recipe.retentionShape?.beats.map((beat) => beat.kind)).toEqual([
			"hook",
			"setup",
			"body",
			"payoff",
		]);
		const polishStep = recipe.operations.find(
			(step) => step.kind === "apply-polish-profile",
		);
		expect(polishStep?.params.profileId).toBe("bold-social");
		expect(recipe.keepCutRecommendationIds).toEqual(["keep-cut:video-1"]);
	});

	test("planDraftRecipe attaches a hook/body/payoff retention plan without a CTA by default", () => {
		const project = buildProjectFixture();
		const recipe = planDraftRecipe({
			brief: buildCreativeBriefFromPrompt({
				prompt: "make me a viral TikTok from this",
				project,
			}),
			project,
			mediaAssets: [buildMediaAsset({ id: "video-1", type: "video", duration: 8 })],
			beatSourceMediaId: "song-1",
			beatMarkerCount: 12,
			projectKitTemplates: [],
			footageIntelligenceReport: {
				generatedAt: "2026-03-10T00:00:00.000Z",
				hookCandidates: [
					{
						id: "hook-1",
						trackId: "video-track-1",
						elementId: "video-1",
						startTime: 0.6,
						endTime: 2.1,
						score: 4.2,
						reasons: ["Starts early in the scene.", "Dense transcript in the opener."],
					},
				],
				momentScores: [
					{
						id: "moment-hook",
						trackId: "video-track-1",
						elementId: "video-1",
						startTime: 0.6,
						endTime: 2.1,
						totalScore: 4.2,
						reasons: ["Strong opener."],
					},
					{
						id: "moment-payoff",
						trackId: "video-track-1",
						elementId: "video-1",
						startTime: 18,
						endTime: 21.4,
						totalScore: 4.8,
						reasons: ["High later payoff.", "Strong visual change."],
					},
				],
				keepCutRecommendations: [
					{
						id: "trim-setup-1",
						trackId: "video-track-1",
						elementId: "video-1",
						action: "trim",
						startTime: 1.8,
						endTime: 3.3,
						score: 1.8,
						reasons: ["Opening lacks forward motion."],
					},
				],
				warnings: [],
			},
		});

		expect(recipe.retentionShape?.hookCandidateId).toBe("hook-1");
		expect(recipe.retentionShape?.beats.map((beat) => beat.kind)).toEqual([
			"hook",
			"setup",
			"body",
			"payoff",
		]);
		expect(recipe.retentionShape?.payoffMomentIds).toEqual(["moment-payoff"]);
		expect(recipe.retentionShape?.steps.some((step) => step.kind === "reserve-cta")).toBe(false);
		expect(
			recipe.operations.find((step) => step.kind === "insert-overlay")?.params.startTime,
		).toBe(0.25);
	});

	test("planDraftRecipe reserves a CTA only when the brief implies one", () => {
		const project = buildProjectFixture();
		const recipe = planDraftRecipe({
			brief: buildCreativeBriefFromPrompt({
				prompt: "make me a product highlight TikTok and add a CTA at the end",
				project,
			}),
			project,
			mediaAssets: [buildMediaAsset({ id: "video-1", type: "video", duration: 8 })],
			beatSourceMediaId: null,
			beatMarkerCount: 0,
			projectKitTemplates: [],
			footageIntelligenceReport: {
				generatedAt: "2026-03-10T00:00:00.000Z",
				hookCandidates: [],
				momentScores: [],
				keepCutRecommendations: [],
				warnings: [],
			},
		});

		expect(recipe.retentionShape?.steps.some((step) => step.kind === "reserve-cta")).toBe(true);
		expect(recipe.retentionShape?.beats.at(-1)?.kind).toBe("cta");
		const outroStep = recipe.operations.find((step) => step.kind === "insert-scene-recipe");
		expect(outroStep?.params.recipeId).toBe("cta-outro");
	});

	test("planDraftRecipe falls back cleanly when no footage report is available", () => {
		const project = buildProjectFixture();
		const recipe = planDraftRecipe({
			brief: buildCreativeBriefFromPrompt({
				prompt: "make me a viral TikTok from this",
				project,
			}),
			project,
			mediaAssets: [buildMediaAsset({ id: "video-1", type: "video", duration: 8 })],
			beatSourceMediaId: null,
			beatMarkerCount: 0,
			projectKitTemplates: [],
			footageIntelligenceReport: null,
		});

		expect(recipe.retentionShape?.warnings).toContain(
			"Retention shaping is unavailable, so structure falls back to clip order and basic duration tightening.",
		);
		expect(recipe.warnings).toContain(
			"Retention shaping is unavailable, so structure falls back to clip order and basic duration tightening.",
		);
	});
});
