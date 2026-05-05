import { describe, expect, test } from "bun:test";
import { buildReferenceRecreationDraft } from "@/lib/clipforge/reference-recreation";
import { buildDefaultClipForgeProjectData } from "@/lib/clipforge/project-data";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";

function makeFile(name: string, type: string): File {
	return new File([""], name, { type });
}

function buildProject(): TProject {
	const clipforge = buildDefaultClipForgeProjectData();
	clipforge.mediaMetadataById.source = {
		words: [
			{ text: "this", start_ms: 0, end_ms: 200 },
			{ text: "is", start_ms: 230, end_ms: 330 },
			{ text: "your", start_ms: 360, end_ms: 520 },
			{ text: "sign", start_ms: 560, end_ms: 820 },
			{ text: "to", start_ms: 1100, end_ms: 1220 },
			{ text: "start", start_ms: 1260, end_ms: 1500 },
			{ text: "now", start_ms: 1540, end_ms: 1800 },
			{ text: "because", start_ms: 2300, end_ms: 2650 },
			{ text: "waiting", start_ms: 2700, end_ms: 3100 },
			{ text: "costs", start_ms: 3160, end_ms: 3500 },
			{ text: "you", start_ms: 3560, end_ms: 3820 },
		],
		segments: [
			{
				text: "this is your sign to start now because waiting costs you",
				start_ms: 0,
				end_ms: 3820,
			},
		],
		silenceRegions: [{ start_ms: 1900, end_ms: 2200 }],
		transcriptionStatus: "ready",
		transcriptionProvider: "srt-import",
		transcriptionLanguage: "en",
		transcriptionError: null,
		indexedAt: new Date().toISOString(),
	};

	return {
		metadata: {
			id: "project",
			name: "Project",
			duration: 0,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		scenes: [
			{
				id: "scene",
				name: "Scene",
				isMain: true,
				tracks: [],
				bookmarks: [],
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		],
		currentSceneId: "scene",
		settings: {
			fps: 30,
			canvasSize: { width: 1920, height: 1080 },
			background: { type: "color", color: "#000000" },
		},
		version: 1,
		clipforge,
	};
}

function buildAssets(): MediaAsset[] {
	return [
		{
			id: "reference",
			name: "edited.mov",
			type: "video",
			file: makeFile("edited.mov", "video/quicktime"),
			duration: 4,
			width: 1080,
			height: 1920,
			visualAnalysis: {
				sceneCuts: [1.1, 2.4, 3.2],
				activityWindows: [],
				analyzedAt: new Date().toISOString(),
				version: 1,
			},
		},
		{
			id: "source",
			name: "raw.mov",
			type: "video",
			file: makeFile("raw.mov", "video/quicktime"),
			duration: 8,
			width: 1920,
			height: 1080,
		},
		{
			id: "music",
			name: "instrumental.mp3",
			type: "audio",
			file: makeFile("instrumental.mp3", "audio/mpeg"),
			duration: 10,
			musicSourceType: "user-imported",
			rightsProfile: "unknown",
		},
	];
}

describe("reference recreation", () => {
	test("builds a vertical draft with jump cuts, word captions, voiceover, and imported music", () => {
		const result = buildReferenceRecreationDraft({
			project: buildProject(),
			mediaAssets: buildAssets(),
			referenceAssetId: "reference",
			sourceAssetIds: ["source"],
			musicAssetId: "music",
		});

		const scene = result.project.scenes[0];
		const videoTrack = scene?.tracks.find((track) => track.type === "video");
		const textTrack = scene?.tracks.find((track) => track.type === "text");
		const audioTrack = scene?.tracks.find((track) => track.type === "audio");

		expect(result.plan.target_duration_ms).toBe(4000);
		expect(result.plan.cut_points_ms).toEqual([1100, 2400, 3200]);
		expect(result.project.settings.canvasSize).toEqual({
			width: 1080,
			height: 1920,
		});
		expect(videoTrack?.elements.length).toBeGreaterThan(1);
		expect(textTrack?.elements[0]?.content).toBe("THIS");
		expect(
			audioTrack?.elements.some((element) => element.role === "voiceover"),
		).toBe(true);
		expect(
			audioTrack?.elements.some((element) => element.role === "music"),
		).toBe(true);
		expect(result.project.settings.audio?.noiseReductionEnabled).toBe(true);
		expect(result.project.settings.audio?.windReductionEnabled).toBe(true);
		expect(result.project.settings.audio?.noiseReductionStrength).toBe(0.72);
		expect(result.project.clipforge?.activeReferenceRecreationPlanId).toBe(
			result.plan.plan_id,
		);
	});

	test("auto-selects imported music when the command does not provide a music id", () => {
		const result = buildReferenceRecreationDraft({
			project: buildProject(),
			mediaAssets: buildAssets(),
			referenceAssetId: "reference",
			sourceAssetIds: ["source"],
		});

		expect(result.plan.music_asset_id).toBe("music");
		const audioTrack = result.project.scenes[0]?.tracks.find(
			(track) => track.type === "audio",
		);
		expect(
			audioTrack?.elements.some((element) => element.role === "music"),
		).toBe(true);
	});

	test("builds word captions from a stitched compound voice transcript when word timings are missing", () => {
		const project = buildProject();
		const clipforge = project.clipforge;
		if (!clipforge) {
			throw new Error("Expected ClipForge project data.");
		}
		clipforge.mediaMetadataById.source = {
			...clipforge.mediaMetadataById.source,
			words: [],
			segments: [
				{
					text: "this is your sign to start now because waiting costs you",
					start_ms: 0,
					end_ms: 6000,
				},
			],
		};

		const result = buildReferenceRecreationDraft({
			project,
			mediaAssets: buildAssets(),
			referenceAssetId: "reference",
			sourceAssetIds: ["source"],
			musicAssetId: "music",
		});

		const textTrack = result.project.scenes[0]?.tracks.find(
			(track) => track.type === "text",
		);
		expect(result.plan.caption_generation.source).toBe("compound-audio");
		expect(result.plan.caption_generation.uses_word_timings).toBe(false);
		expect(textTrack?.elements[0]?.content).toBe("THIS");
		expect(textTrack?.elements[0]?.captionTiming?.words[0]?.text).toBe("THIS");
	});
});
