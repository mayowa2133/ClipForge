import { describe, expect, test } from "bun:test";
import {
	blendCreatorStyleProfiles,
	buildCreatorProfileFromReferenceEdit,
	resolveAutonomousAudioMix,
	resolveCreatorProfileTargetDurationMs,
} from "@/lib/clipforge/creator-profile";
import { normalizeClipForgeProjectData } from "@/lib/clipforge/project-data";
import {
	persistCreatorStyleProfile,
	readPersistedCreatorStyleProfile,
	type CreatorProfileStorage,
} from "@/lib/clipforge/creator-profile-store";
import type { ReferenceEditAnalysis } from "@/types/clipforge";

function buildReferenceEditAnalysis(): ReferenceEditAnalysis {
	return {
		analyzedAt: "2026-06-17T00:00:00.000Z",
		reference_asset_id: "reference",
		duration_ms: 36_000,
		aspect_ratio: "9:16",
		cut_points_ms: [900, 1800, 2700, 4100, 5900, 7300],
		cut_count: 6,
		average_cut_ms: 5143,
		caption_style: {
			mode: "word",
			text_transform: "uppercase",
			style_id: "reference-word-pop",
			font: "Montserrat",
			size: 64,
			position: "bottom",
			fill_color: "#FFFFFF",
			outline_color: "#000000",
			outline: true,
			shadow: false,
			safe_zone: "lower-center",
		},
		caption_ocr: {
			source: "metadata",
			confidence: 0.94,
			warnings: [],
			words: [
				"You",
				"are",
				"about",
				"to",
				"prove",
				"every",
				"person",
				"wrong",
				"Not",
				"by",
				"talking",
				"but",
				"by",
				"becoming",
				"undeniable",
				"Your",
				"results",
				"are",
				"going",
				"to",
				"shock",
				"people",
				"So",
				"stop",
				"waiting",
				"and",
				"start",
				"becoming",
			].map((text, index) => ({
				text,
				start_ms: index * 140,
				end_ms: index * 140 + 120,
				confidence: 0.98,
				source: "metadata" as const,
			})),
		},
		audio_mix: {
			target_lufs: -11,
			true_peak_db: -1,
			voice_gain_db: 11,
			music_volume: 0.45,
			ducking_amount: 0.36,
			ducking_attack_ms: 90,
			ducking_release_ms: 220,
			soft_limiter: true,
			noise_reduction_enabled: true,
			noise_reduction_strength: 0.72,
			wind_reduction_enabled: true,
		},
		color_profile: "bt709-social",
		warnings: [],
	};
}

describe("creator style profile", () => {
	test("persists the newest learned profile across projects", () => {
		const values = new Map<string, string>();
		const storage: CreatorProfileStorage = {
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => values.set(key, value),
		};
		const newer = buildCreatorProfileFromReferenceEdit({
			rawDurationS: 120,
			referenceEditAnalysis: buildReferenceEditAnalysis(),
			assetName: "newer.mov",
		});
		const older = {
			...newer,
			learnedAt: "2025-01-01T00:00:00.000Z",
			learnedFromAssetName: "older.mov",
		};

		expect(persistCreatorStyleProfile({ profile: newer, storage })).toBe(true);
		expect(persistCreatorStyleProfile({ profile: older, storage })).toBe(false);
		expect(
			readPersistedCreatorStyleProfile({ storage })?.learnedFromAssetName,
		).toBe("newer.mov");
	});

	test("learns reusable pacing and style targets from a reference edit", () => {
		const profile = buildCreatorProfileFromReferenceEdit({
			rawDurationS: 127.5,
			referenceEditAnalysis: buildReferenceEditAnalysis(),
			assetName: "finished-reference.mov",
			musicVolumeRatio: 0.45,
			musicStartOffsetS: 4.5,
		});

		expect(profile.learnedFromAssetName).toBe("finished-reference.mov");
		expect(profile.learnedReferenceCount).toBe(1);
		expect(profile.targetKeepRatio).toBeCloseTo(0.282, 3);
		expect(profile.targetDurationS).toBe(36);
		expect(profile.referenceCutCount).toBe(6);
		expect(profile.cutDensityPerMinute).toBe(10);
		expect(profile.editorialKeepKeywords).toContain("becoming");
		expect(profile.editorialKeepKeywords).toContain("prove");
		expect(profile.editorialHookKeywords).toContain("prove");
		expect(profile.editorialPayoffKeywords).toContain("waiting");
		expect(profile.captionStyleId).toBe("reference-word-pop");
		expect(profile.maxWordsPerCaption).toBe(1);
		expect(profile.minCaptionDisplayMs).toBe(160);
		expect(profile.voiceGainDb).toBe(11);
		expect(profile.musicVolumeRatio).toBe(0.45);
		expect(profile.musicStartOffsetS).toBe(4.5);
	});

	test("blends multiple learned references into one reusable editor profile", () => {
		const first = buildCreatorProfileFromReferenceEdit({
			rawDurationS: 120,
			referenceEditAnalysis: buildReferenceEditAnalysis(),
			assetName: "reference-a.mov",
			musicVolumeRatio: 0.4,
			musicStartOffsetS: 2,
		});
		const second = buildCreatorProfileFromReferenceEdit({
			rawDurationS: 180,
			referenceEditAnalysis: {
				...buildReferenceEditAnalysis(),
				duration_ms: 54_000,
				cut_count: 18,
				average_cut_ms: 3000,
				audio_mix: {
					...buildReferenceEditAnalysis().audio_mix,
					voice_gain_db: 5,
					music_volume: 0.6,
					music_start_offset_s: 4,
				},
				caption_ocr: {
					...buildReferenceEditAnalysis().caption_ocr,
					words: [
						{
							text: "Momentum",
							start_ms: 0,
							end_ms: 120,
							confidence: 0.98,
							source: "metadata",
						},
						{
							text: "compounds",
							start_ms: 120,
							end_ms: 240,
							confidence: 0.98,
							source: "metadata",
						},
					],
				},
			},
			assetName: "reference-b.mov",
		});

		const blended = blendCreatorStyleProfiles({
			existingProfile: first,
			newProfile: second,
		});

		expect(blended.learnedReferenceCount).toBe(2);
		expect(blended.rawDurationS).toBe(150);
		expect(blended.finishedDurationS).toBe(45);
		expect(blended.targetKeepRatio).toBe(0.3);
		expect(blended.voiceGainDb).toBe(8);
		expect(blended.musicVolumeRatio).toBe(0.5);
		expect(blended.musicStartOffsetS).toBe(3);
		expect(blended.editorialKeepKeywords).toContain("momentum");
		expect(blended.editorialKeepKeywords).toContain("becoming");
	});

	test("uses learned finished duration for similar raw clips and ratio for different lengths", () => {
		const profile = buildCreatorProfileFromReferenceEdit({
			rawDurationS: 120,
			referenceEditAnalysis: buildReferenceEditAnalysis(),
			assetName: null,
		});

		expect(
			resolveCreatorProfileTargetDurationMs({
				profile,
				rawDurationMs: 125_000,
			}),
		).toBe(36_000);
		expect(
			resolveCreatorProfileTargetDurationMs({
				profile,
				rawDurationMs: 300_000,
			}),
		).toBe(90_000);
		expect(
			resolveCreatorProfileTargetDurationMs({
				profile,
				rawDurationMs: 125_000,
				keepRatioOverride: 0.5,
			}),
		).toBe(62_500);
	});

	test("resolves dialogue gain while preserving effective music level", () => {
		const resolved = resolveAutonomousAudioMix({
			profile: { voiceGainDb: 11, musicVolumeRatio: 0.3 },
		});

		expect(resolved.voiceGainDb).toBe(11);
		expect(resolved.masterVolume).toBeCloseTo(3.548, 3);
		expect(resolved.musicElementVolume).toBeCloseTo(0.0846, 3);
		expect(resolved.musicElementVolume * resolved.masterVolume).toBeCloseTo(
			0.3,
			5,
		);

		const migrated = resolveAutonomousAudioMix({
			profile: { musicVolumeRatio: 0.45 },
		});
		expect(migrated.voiceGainDb).toBe(11);
	});

	test("preserves learned profile and autonomous quality gate through project normalization", () => {
		const profile = buildCreatorProfileFromReferenceEdit({
			rawDurationS: 120,
			referenceEditAnalysis: buildReferenceEditAnalysis(),
			assetName: "reference.mov",
		});

		const normalized = normalizeClipForgeProjectData({
			clipforge: {
				schemaVersion: 1,
				mediaMetadataById: {},
				captionStylesById: {},
				activeCaptionStyleId: null,
				captionTrackIdsBySceneId: {},
				sceneFootageIntelligenceBySceneId: {},
				trendSoundReferences: [],
				activeReferenceVideoAssetId: null,
				referenceAnalysisByAssetId: {},
				referenceEditAnalysisByAssetId: {},
				assemblySourceAssetIds: [],
				footageDescriptorsByAssetId: {},
				sourceRecreationAnalysisByAssetId: {},
				musicTrackAnalysisByAssetId: {},
				referenceRecreationPlansById: {},
				activeReferenceRecreationPlanId: null,
				referenceShotPlanByAssetId: {},
				referenceMatchLocks: {},
				chatMemory: {
					activeTargets: [],
					styleIntent: null,
					publishIntent: null,
					finishIntent: null,
					destinationIntent: null,
					referenceIntent: null,
					assemblyIntent: null,
					lockedMatchIds: [],
					recentTurnSummaries: [],
					recentAppliedCommandSummaries: [],
					recentAssetChoices: [],
					recentReferenceComparisons: [],
					recentReferenceAssemblyChoices: [],
				},
				opsAudit: [],
				creatorProfile: profile,
				lastAutonomousQualityGate: {
					evaluatedAt: "2026-06-17T00:00:00.000Z",
					target_duration_ms: 36_000,
					actual_duration_ms: 35_700,
					target_duration_delta_ms: 300,
					target_cut_density_per_minute: 10,
					actual_cut_density_per_minute: 10.1,
					cut_density_delta_per_minute: 0.1,
					video_cut_count: 6,
					caption_count: 80,
					title_present: true,
					music_present: true,
					portrait_canvas: true,
					readiness: "ready-for-review",
					warnings: [],
				},
			},
		});

		expect(normalized.creatorProfile?.targetDurationS).toBe(36);
		expect(normalized.creatorProfile?.learnedReferenceCount).toBe(1);
		expect(normalized.creatorProfile?.cutDensityPerMinute).toBe(10);
		expect(normalized.creatorProfile?.editorialKeepKeywords).toContain(
			"becoming",
		);
		expect(normalized.creatorProfile?.musicVolumeRatio).toBe(0.45);
		expect(normalized.creatorProfile?.voiceGainDb).toBe(11);
		expect(normalized.creatorProfile?.musicStartOffsetS).toBe(0);
		expect(normalized.lastAutonomousQualityGate?.readiness).toBe(
			"ready-for-review",
		);
		expect(normalized.lastAutonomousQualityGate?.caption_count).toBe(80);
	});
});
