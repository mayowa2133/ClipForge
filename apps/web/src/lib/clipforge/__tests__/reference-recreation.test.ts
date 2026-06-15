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
		expect(
			videoTrack?.elements.find((element) => element.type === "video")?.fit,
		).toBe("cover");
		expect(result.plan.source_ranges[0]?.agent_score).toBeGreaterThan(0);
		expect(
			result.plan.source_ranges[0]?.score_breakdown.speech,
		).toBeGreaterThan(0);
		expect(result.plan.caption_generation.max_words_per_caption).toBe(1);
		expect(result.plan.caption_generation.min_display_ms).toBe(160);
		expect(result.plan.audio_mix.target_lufs).toBe(-11);
		expect(result.plan.audio_mix.voice_gain_db).toBe(11);
		expect(result.plan.audio_mix.music_volume).toBe(0.45);
		expect(result.plan.quality_gate.readiness).toBe("ready-for-review");
		expect(result.plan.quality_gate.music_selected).toBe(true);
		expect(result.plan.quality_gate.filled_reference_slots).toBe(
			result.plan.source_ranges.length,
		);
		expect(result.plan.quality_gate.total_reference_slots).toBe(4);
		expect(result.plan.quality_gate.human_review_steps.join(" ")).toContain(
			"Export",
		);
		expect(textTrack?.elements[0]?.content).toBe("THIS");
		expect(textTrack?.elements[0]?.stroke?.color).toBe("#000000");
		expect(textTrack?.elements[0]?.background.color).toBe("transparent");
		expect(
			audioTrack?.elements.some((element) => element.role === "voiceover"),
		).toBe(true);
		expect(
			audioTrack?.elements.some((element) => element.role === "music"),
		).toBe(true);
		expect(
			audioTrack?.elements.find((element) => element.role === "music")?.volume,
		).toBe(0.45);
		expect(
			audioTrack?.elements.find((element) => element.role === "voiceover")
				?.normalizationGainDb,
		).toBe(11);
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

	test("fills all reference cut slots chronologically when reference OCR is unavailable", () => {
		const project = buildProject();
		const clipforge = project.clipforge;
		if (!clipforge) {
			throw new Error("Expected ClipForge project data.");
		}
		clipforge.mediaMetadataById.source = {
			...clipforge.mediaMetadataById.source,
			words: Array.from({ length: 80 }, (_, index) => ({
				text: `word${index + 1}`,
				start_ms: index * 540,
				end_ms: index * 540 + 260,
			})),
			segments: [
				{
					text: "chronological source transcript",
					start_ms: 0,
					end_ms: 44000,
				},
			],
			silenceRegions: [],
		};
		const assets: MediaAsset[] = buildAssets().map((asset) =>
			asset.id === "reference"
				? {
						...asset,
						duration: 36.082,
						visualAnalysis: {
							sceneCuts: [
								1, 2, 4.75, 5.5, 6.5, 8, 9.75, 11, 13, 15.5, 17.25,
								17.75, 20, 22, 22.75, 23.5, 25,
							],
							activityWindows: [],
							analyzedAt: new Date().toISOString(),
							version: 1 as const,
						},
					}
				: asset.id === "source"
					? {
							...asset,
							duration: 127,
						}
					: asset,
		);

		const result = buildReferenceRecreationDraft({
			project,
			mediaAssets: assets,
			referenceAssetId: "reference",
			sourceAssetIds: ["source"],
			musicAssetId: "music",
		});
		const plannedDurationMs = result.plan.source_ranges.reduce(
			(sum, range) => sum + range.target_duration_ms,
			0,
		);

		expect(result.plan.source_ranges).toHaveLength(18);
		expect(result.plan.quality_gate.filled_reference_slots).toBe(18);
		expect(result.plan.quality_gate.total_reference_slots).toBe(18);
		expect(result.plan.quality_gate.target_duration_delta_ms).toBeLessThanOrEqual(
			1,
		);
		expect(plannedDurationMs).toBe(result.plan.target_duration_ms);
		expect(result.plan.quality_gate.readiness).toBe("ready-for-review");
		expect(result.plan.source_ranges[0]?.source_start_ms).toBe(0);
		expect(result.plan.source_ranges[17]?.source_start_ms).toBeGreaterThan(
			result.plan.source_ranges[0]?.source_start_ms ?? 0,
		);
		expect(result.plan.source_ranges[0]?.reasons.join(" ")).toContain(
			"chronologically",
		);
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

	test("uses reference caption OCR words and aligns source cuts to matching transcript text", () => {
		const project = buildProject();
		const clipforge = project.clipforge;
		if (!clipforge) {
			throw new Error("Expected ClipForge project data.");
		}
		clipforge.mediaMetadataById.reference = {
			words: [
				{ text: "start", start_ms: 0, end_ms: 260 },
				{ text: "now", start_ms: 300, end_ms: 620 },
			],
			segments: [{ text: "start now", start_ms: 0, end_ms: 620 }],
			silenceRegions: [],
			transcriptionStatus: "ready",
			transcriptionProvider: "managed-cloud",
			transcriptionLanguage: "en",
			transcriptionError: null,
			indexedAt: new Date().toISOString(),
		};
		clipforge.mediaMetadataById.source = {
			...clipforge.mediaMetadataById.source,
			words: [
				{ text: "okay", start_ms: 0, end_ms: 200 },
				{ text: "um", start_ms: 260, end_ms: 420 },
				{ text: "start", start_ms: 1260, end_ms: 1500 },
				{ text: "now", start_ms: 1540, end_ms: 1800 },
			],
			segments: [{ text: "okay um start now", start_ms: 0, end_ms: 1800 }],
			silenceRegions: [{ start_ms: 480, end_ms: 1200 }],
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

		expect(result.plan.caption_generation.source).toBe("reference-ocr");
		expect(result.plan.caption_generation.reference_words.length).toBe(2);
		expect(result.plan.source_ranges[0]?.source_start_ms).toBe(1260);
		expect(result.plan.source_ranges[0]?.score_breakdown.semantic).toBe(1);
		expect(result.plan.source_ranges[0]?.reasons.join(" ")).toContain(
			"Edit-selection agent score",
		);
		expect(textTrack?.elements[0]?.content).toBe("START");
		expect(textTrack?.elements[1]?.content).toBe("NOW");
	});

	test("uses reference caption words even when the matched source transcript differs", () => {
		const project = buildProject();
		const clipforge = project.clipforge;
		if (!clipforge) {
			throw new Error("Expected ClipForge project data.");
		}
		clipforge.mediaMetadataById.reference = {
			words: [
				{ text: "Your", start_ms: 0, end_ms: 120 },
				{ text: "results", start_ms: 120, end_ms: 480 },
				{ text: "are", start_ms: 480, end_ms: 640 },
				{ text: "going", start_ms: 640, end_ms: 820 },
				{ text: "to", start_ms: 820, end_ms: 940 },
				{ text: "shock", start_ms: 940, end_ms: 1180 },
				{ text: "you", start_ms: 1180, end_ms: 1500 },
			],
			segments: [
				{
					text: "Your results are going to shock you",
					start_ms: 0,
					end_ms: 1500,
				},
			],
			silenceRegions: [],
			transcriptionStatus: "ready",
			transcriptionProvider: "managed-cloud",
			transcriptionLanguage: "en",
			transcriptionError: null,
			indexedAt: new Date().toISOString(),
		};
		clipforge.mediaMetadataById.source = {
			...clipforge.mediaMetadataById.source,
			words: [
				{ text: "Your", start_ms: 0, end_ms: 120 },
				{ text: "results", start_ms: 120, end_ms: 480 },
				{ text: "are", start_ms: 480, end_ms: 640 },
				{ text: "going", start_ms: 640, end_ms: 820 },
				{ text: "to", start_ms: 820, end_ms: 940 },
				{ text: "shock", start_ms: 940, end_ms: 1180 },
				{ text: "people", start_ms: 1180, end_ms: 1500 },
			],
			segments: [
				{
					text: "Your results are going to shock people",
					start_ms: 0,
					end_ms: 1500,
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
		const captionText = textTrack?.elements
			.map((element) => element.content)
			.join(" ");

		expect(result.plan.caption_generation.source).toBe("reference-ocr");
		expect(captionText).toContain("YOU");
		expect(captionText).not.toContain("PEOPLE");
	});

	test("flags suspicious source transcript terms for manual caption correction", () => {
		const project = buildProject();
		const clipforge = project.clipforge;
		if (!clipforge) {
			throw new Error("Expected ClipForge project data.");
		}
		clipforge.mediaMetadataById.source = {
			...clipforge.mediaMetadataById.source,
			words: [{ text: "fuck", start_ms: 0, end_ms: 260 }],
			segments: [{ text: "fuck", start_ms: 0, end_ms: 260 }],
		};

		const result = buildReferenceRecreationDraft({
			project,
			mediaAssets: buildAssets(),
			referenceAssetId: "reference",
			sourceAssetIds: ["source"],
			musicAssetId: "music",
		});

		expect(result.plan.caption_generation.needs_review_terms).toContain("fuck");
		expect(
			result.plan.caption_generation.correction_warnings.join(" "),
		).toContain("manually reviewed");
	});
});
