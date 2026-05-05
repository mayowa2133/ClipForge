import { calculateTotalDuration } from "@/lib/timeline";
import {
	buildTimelineTranscriptWords,
	buildTranscriptSnippetForElement,
} from "@/lib/clipforge/timeline-transcript";
import {
	buildFootageDescriptor,
	buildFootageMatchReadiness,
	buildReferenceCandidateMatches,
	buildReferenceReadiness,
	buildReferenceShotPlan,
	getReferenceVideoAnalysisStatus,
	summarizeFootageDescriptor,
	summarizeReferenceAnalysis,
} from "@/lib/clipforge/reference-video";
import { evaluateExportPreflight } from "@/lib/clipforge/export-preflight";
import { BUNDLED_MUSIC, BUNDLED_SFX } from "@/lib/library/content-packs";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type {
	ProjectKitTemplate,
	SceneRecipeTemplate,
} from "@/types/templates";
import type {
	ChatSegmentKind,
	ProjectMediaAnalysisMarkerSummary,
	ProjectSceneSummary,
	ProjectSegmentSummary,
	ProjectSummary,
} from "./types";

const PLAYHEAD_NEIGHBORHOOD_MS = 8000;
const MAX_SEGMENTS = 240;
const MAX_TIMELINE_WORDS = 1500;
const SUMMARY_PREFLIGHT_FORMAT = "mp4";
const SUMMARY_PREFLIGHT_QUALITY = "high";

export function buildProjectSummary({
	project,
	mediaAssets = [],
	playheadMs = 0,
	selectedSegmentIds = [],
	projectKitTemplates = [],
	sceneRecipeTemplates = [],
}: {
	project: TProject;
	mediaAssets?: MediaAsset[];
	playheadMs?: number;
	selectedSegmentIds?: string[];
	projectKitTemplates?: ProjectKitTemplate[];
	sceneRecipeTemplates?: SceneRecipeTemplate[];
}): ProjectSummary {
	const activeScene =
		project.scenes.find((scene) => scene.id === project.currentSceneId) ??
		project.scenes[0] ??
		null;
	const activeSceneSegments = activeScene
		? buildSceneSegments({ scene: activeScene, project }).slice(0, MAX_SEGMENTS)
		: [];
	const selectedSet = new Set(selectedSegmentIds);
	const selectedSegments = activeSceneSegments.filter((segment) =>
		selectedSet.has(segment.segment_id),
	);
	const recentAiActions =
		project.clipforge?.chatMemory?.recentAppliedCommandSummaries.slice(-8) ?? [];
	const recentTurnSummaries =
		project.clipforge?.chatMemory?.recentTurnSummaries
			.slice(-6)
			.map((turn) => turn.summary)
			.filter((summary) => summary.trim().length > 0) ?? [];
	const publishDestination =
		project.clipforge?.chatMemory?.destinationIntent?.publishDestination ?? null;
	const preflightSnapshot = buildExportPreflightSnapshot({
		project,
		mediaAssets,
		publishDestination: publishDestination ?? "generic-export",
	});
	const activeReferenceAssetId = project.clipforge?.activeReferenceVideoAssetId ?? null;
	const activeReferenceAsset =
		mediaAssets.find((asset) => asset.id === activeReferenceAssetId) ?? null;
	const activeReferenceAnalysis =
		activeReferenceAssetId && project.clipforge?.referenceAnalysisByAssetId
			? project.clipforge.referenceAnalysisByAssetId[activeReferenceAssetId] ?? null
			: null;
	const activeReferenceMetadata =
		activeReferenceAssetId && project.clipforge?.mediaMetadataById
			? project.clipforge.mediaMetadataById[activeReferenceAssetId] ?? null
			: null;
	const activeReferenceStatus = getReferenceVideoAnalysisStatus({
		analysis: activeReferenceAnalysis,
		asset: activeReferenceAsset,
		metadata: activeReferenceMetadata,
	});
	const referenceReadiness = buildReferenceReadiness({
		status: activeReferenceStatus,
		analysis: activeReferenceAnalysis,
	});
	const assemblySourcePool = mediaAssets
		.filter(
			(asset): asset is MediaAsset & { type: "video" } =>
				asset.type === "video" &&
				!asset.ephemeral &&
				asset.id !== activeReferenceAssetId &&
				(project.clipforge?.assemblySourceAssetIds?.length
					? project.clipforge.assemblySourceAssetIds.includes(asset.id)
					: true),
		)
		.sort((left, right) => left.name.localeCompare(right.name));
	const footageDescriptors = assemblySourcePool.map((asset) => {
		const persisted = project.clipforge?.footageDescriptorsByAssetId?.[asset.id] ?? null;
		return (
			persisted ??
			buildFootageDescriptor({
				asset,
				metadata: project.clipforge?.mediaMetadataById?.[asset.id] ?? null,
			})
		);
	});
	const referenceShotPlan =
		(activeReferenceAssetId && project.clipforge?.referenceShotPlanByAssetId
			? project.clipforge.referenceShotPlanByAssetId[activeReferenceAssetId] ?? null
			: null) ??
		(activeReferenceAsset && activeReferenceAnalysis
			? buildReferenceShotPlan({
					asset: activeReferenceAsset,
					analysis: activeReferenceAnalysis,
			  })
			: null);
	const candidateSourceMatches = buildReferenceCandidateMatches({
		referenceShotPlan,
		footageDescriptors,
		locks: project.clipforge?.referenceMatchLocks ?? {},
	});
	const footageMatchReadiness = buildFootageMatchReadiness({
		referenceShotPlan,
		sourceAssetCount: assemblySourcePool.length,
		candidateMatches: candidateSourceMatches,
	});

	return {
		total_duration_s: activeScene
			? calculateTotalDuration({ tracks: activeScene.tracks })
			: 0,
		current_scene_id: activeScene?.id ?? null,
		caption_style_id: project.clipforge?.activeCaptionStyleId ?? null,
		pause_stats: buildPauseStats({ project }),
		segments: activeSceneSegments,
		current_scene_segments: activeSceneSegments,
		other_scene_summaries: project.scenes
			.filter((scene) => scene.id !== activeScene?.id)
			.map((scene) => buildSceneSummary({ scene, project })),
		media_assets: mediaAssets
			.filter(
				(asset): asset is MediaAsset & { type: "video" | "image" } =>
					(asset.type === "video" || asset.type === "image") && !asset.ephemeral,
			)
			.map((asset) => ({
				asset_id: asset.id,
				name: asset.name,
				type: asset.type,
				duration_ms:
					typeof asset.duration === "number"
						? Math.round(asset.duration * 1000)
						: null,
			}))
			.sort((left, right) => left.name.localeCompare(right.name)),
		selection: {
			selected_segment_ids: selectedSegmentIds,
			selected_segments: selectedSegments,
		},
		playhead_neighborhood: {
			playhead_ms: Math.max(0, Math.round(playheadMs)),
			nearby_segments: activeSceneSegments.filter((segment) =>
				isNearPlayhead({
					segment,
					playheadMs,
				}),
			),
		},
		version_pack: project.settings.versionPack ?? null,
		audio_mix: project.settings.audio ?? null,
		overlay_defaults: project.settings.overlayDefaults ?? null,
		brand_kit: project.settings.brandKit ?? null,
		available_project_kits: projectKitTemplates.map((template) => ({
			id: template.id,
			name: template.name,
			kind: "project-kit" as const,
		})),
		available_scene_recipes: sceneRecipeTemplates.map((template) => ({
			id: template.id,
			name: template.name,
			kind: "scene-recipe" as const,
		})),
		media_analysis_markers: buildMediaAnalysisMarkers({ mediaAssets }),
		available_music_assets: BUNDLED_MUSIC.map((item) => ({
			asset_id: item.id,
			label: item.label,
			kind: item.kind,
			mood: item.mood ?? null,
			usage_kind: item.usageKind,
			bpm: item.bpm ?? null,
			default_duration_ms: item.defaultDurationMs ?? null,
			tags: item.tags,
			allowed_destinations: [
				"generic-export",
				"tiktok",
				"instagram",
				"youtube",
			],
			rights_profile: "universal",
		})),
		available_sfx_assets: BUNDLED_SFX.map((item) => ({
			asset_id: item.id,
			label: item.label,
			kind: item.kind,
			mood: item.mood ?? null,
			usage_kind: item.usageKind,
			bpm: item.bpm ?? null,
			default_duration_ms: item.defaultDurationMs ?? null,
			tags: item.tags,
			allowed_destinations: [
				"generic-export",
				"tiktok",
				"instagram",
				"youtube",
			],
			rights_profile: "universal",
		})),
		imported_audio_assets: mediaAssets
			.filter(
				(asset): asset is MediaAsset & { type: "audio" } =>
					asset.type === "audio" && !asset.ephemeral,
			)
			.map((asset) => ({
				asset_id: asset.id,
				name: asset.name,
				type: asset.type,
				duration_ms:
					typeof asset.duration === "number"
						? Math.round(asset.duration * 1000)
						: null,
			}))
			.sort((left, right) => left.name.localeCompare(right.name)),
		trend_reference_summary:
			project.clipforge?.trendSoundReferences.map((reference) => ({
				id: reference.id,
				label: reference.label,
				platform: reference.platform,
				creator: reference.creator ?? null,
				notes: reference.notes ?? null,
			})) ?? [],
		publish_destination: publishDestination,
		export_preflight_snapshot: preflightSnapshot,
		packaging_readiness: buildPackagingReadiness({
			preflightSnapshot,
		}),
		active_reference_video: activeReferenceAssetId
			? {
					asset_id: activeReferenceAssetId,
					name: activeReferenceAsset?.name ?? activeReferenceAssetId,
					status: activeReferenceStatus,
					analyzed_at: activeReferenceAnalysis?.analyzedAt ?? null,
					intent_summary: summarizeReferenceAnalysis({
						analysis: activeReferenceAnalysis,
					}),
					warnings: activeReferenceAnalysis?.warnings ?? [],
			  }
			: null,
		reference_analysis_snapshot: activeReferenceAnalysis
			? {
					transition_cadence: activeReferenceAnalysis.shotPattern.transition_cadence,
					average_shot_ms: activeReferenceAnalysis.shotPattern.average_shot_ms,
					caption_tone: activeReferenceAnalysis.captionProfile.tone,
					caption_reveal_preset_id:
						activeReferenceAnalysis.captionProfile.reveal_preset_id,
					audio_mood: activeReferenceAnalysis.audioProfile.music_mood,
					recommended_music_asset_id:
						activeReferenceAnalysis.audioProfile.recommended_music_asset_id,
					recommended_sfx_asset_id:
						activeReferenceAnalysis.audioProfile.recommended_sfx_asset_id,
					overlay_variant_id: activeReferenceAnalysis.overlayProfile.variant_id,
					polish_profile_id:
						activeReferenceAnalysis.finishingProfile.polish_profile_id,
					finishing_look_id:
						activeReferenceAnalysis.finishingProfile.finishing_look_id,
					publish_destination:
						activeReferenceAnalysis.publishProfile.publish_destination,
					target_version_id:
						activeReferenceAnalysis.publishProfile.target_version_id,
					hook_pattern: activeReferenceAnalysis.publishProfile.hook_pattern,
			  }
			: null,
		reference_match_readiness: referenceReadiness,
		assembly_source_pool: assemblySourcePool.map((asset, index) => ({
			asset_id: asset.id,
			name: asset.name,
			descriptor_summary: summarizeFootageDescriptor({
				descriptor: footageDescriptors[index] ?? null,
			}),
		})),
		footage_match_readiness: footageMatchReadiness,
		reference_shot_plan: referenceShotPlan
			? {
					hook_pattern: referenceShotPlan.hook_pattern,
					ending_shape: referenceShotPlan.ending_shape,
					sections: referenceShotPlan.sections.map((section) => ({
						match_id: section.match_id,
						label: section.label,
						role: section.role,
						target_duration_ms: section.target_duration_ms,
						description: section.description,
					})),
			  }
			: null,
		candidate_source_matches: candidateSourceMatches.map((match) => ({
			match_id: match.match_id,
			section_label: match.section_label,
			section_role: match.section_role,
			selected_asset_id: match.selected_asset_id,
			selected_asset_name: match.selected_asset_name,
			reasons: match.reasons,
			candidate_asset_ids: match.candidates.map((candidate) => candidate.asset_id),
			locked: match.locked,
		})),
		recent_ai_actions: [...recentAiActions].reverse(),
		recent_turn_summaries: [...recentTurnSummaries].reverse(),
		timeline_words: rankTimelineWords({
			project,
			playheadMs,
			selectedSegments,
		}).slice(0, MAX_TIMELINE_WORDS),
	};
}

function buildExportPreflightSnapshot({
	project,
	mediaAssets,
	publishDestination,
}: {
	project: TProject;
	mediaAssets: MediaAsset[];
	publishDestination: "generic-export" | "tiktok" | "instagram" | "youtube";
}) {
	const result = evaluateExportPreflight({
		project,
		mediaAssets,
		format: SUMMARY_PREFLIGHT_FORMAT,
		quality: SUMMARY_PREFLIGHT_QUALITY,
		includeAudio: true,
		targetVersionId: project.settings.versionPack?.activeTargetId ?? null,
		publishDestination,
	});

	return {
		ready: result.ready,
		blocking_count: result.blockingCount,
		warning_count: result.warningCount,
			actionable_actions: [
				...new Set(
					result.issues
						.flatMap((issue) => (issue.actionable && issue.action ? [issue.action] : []))
				),
			],
		issue_codes: [...new Set(result.issues.map((issue) => issue.code))],
	};
}

function buildPackagingReadiness({
	preflightSnapshot,
}: {
	preflightSnapshot: ReturnType<typeof buildExportPreflightSnapshot> | null;
}) {
	if (!preflightSnapshot) {
		return {
			ready: false,
			status: "attention" as const,
			reason: "Export readiness has not been evaluated.",
		};
	}
	if (preflightSnapshot.blocking_count > 0) {
		return {
			ready: false,
			status: "blocked" as const,
			reason: `${preflightSnapshot.blocking_count} blocking export issues remain.`,
		};
	}
	if (preflightSnapshot.warning_count > 0) {
		return {
			ready: true,
			status: "attention" as const,
			reason: `${preflightSnapshot.warning_count} export warnings should be reviewed.`,
		};
	}
	return {
		ready: true,
		status: "ready" as const,
		reason: "Publish packaging is clear for the active destination.",
	};
}

function buildPauseStats({
	project,
}: {
	project: TProject;
}): ProjectSummary["pause_stats"] {
	const silenceRegions = Object.values(
		project.clipforge?.mediaMetadataById ?? {},
	).flatMap((item) => item.silenceRegions);
	const totalPauseMs = silenceRegions.reduce(
		(sum, region) => sum + Math.max(0, region.end_ms - region.start_ms),
		0,
	);

	return {
		region_count: silenceRegions.length,
		total_pause_ms: Math.round(totalPauseMs),
	};
}

function buildSceneSummary({
	scene,
	project,
}: {
	scene: TProject["scenes"][number];
	project: TProject;
}): ProjectSceneSummary {
	const segments = buildSceneSegments({ scene, project });

	return {
		scene_id: scene.id,
		name: scene.name,
		duration_s: calculateTotalDuration({ tracks: scene.tracks }),
		segment_count: segments.length,
		transcript_snippet: buildSceneTranscriptSnippet({ segments }),
	};
}

function buildSceneTranscriptSnippet({
	segments,
}: {
	segments: ProjectSegmentSummary[];
}): string {
	return segments
		.map((segment) => segment.text_content || segment.transcript_snippet)
		.filter((value) => value.trim().length > 0)
		.slice(0, 3)
		.join(" ")
		.trim()
		.slice(0, 160);
}

function buildSceneSegments({
	scene,
	project,
}: {
	scene: TProject["scenes"][number];
	project: TProject;
}): ProjectSegmentSummary[] {
	const rawSegments = scene.tracks.flatMap((track) =>
		track.elements.map((element) => {
			let transcriptSnippet = "";
			let textContent = "";
			if (element.type === "text") {
				textContent = element.content;
				transcriptSnippet = element.content.slice(0, 80);
			} else if ("mediaId" in element && typeof element.mediaId === "string") {
				const metadata = project.clipforge?.mediaMetadataById[element.mediaId];
				if (
					element.type === "video" ||
					(element.type === "audio" && element.sourceType === "upload")
				) {
					transcriptSnippet = buildTranscriptSnippetForElement({
						element,
						metadata,
					});
				}
			}

			return {
				segment_id: element.id,
				track_id: track.id,
				scene_id: scene.id,
				track_type: track.type,
				segment_kind: classifySegmentKind({
					trackType: track.type,
					trackName: track.name,
					elementType: element.type,
					elementRole: element.type === "text" ? (element.role ?? "text") : null,
					elementName: element.name,
					textContent,
					durationMs: Math.round(element.duration * 1000),
				}),
				start_ms: Math.round(element.startTime * 1000),
				end_ms: Math.round((element.startTime + element.duration) * 1000),
				ordinal: 0,
				asset_id:
					"mediaId" in element && typeof element.mediaId === "string"
						? element.mediaId
						: null,
				element_name: element.name,
				text_content: textContent,
				transcript_snippet: transcriptSnippet,
			};
		}),
	);

	const segments = rawSegments
		.sort((left, right) => left.start_ms - right.start_ms)
		.map((segment) => ({ ...segment }));
	const ordinalByKind: Partial<Record<ChatSegmentKind, number>> = {};

	for (const segment of segments) {
		const nextOrdinal = (ordinalByKind[segment.segment_kind] ?? 0) + 1;
		ordinalByKind[segment.segment_kind] = nextOrdinal;
		segment.ordinal = nextOrdinal;
	}

	return segments;
}

function classifySegmentKind({
	trackType,
	trackName,
	elementType,
	elementRole,
	elementName,
	textContent,
	durationMs,
}: {
	trackType: string;
	trackName: string;
	elementType: string;
	elementRole: "text" | "caption" | null;
	elementName: string;
	textContent: string;
	durationMs: number;
}): ChatSegmentKind {
	if (elementType === "video" || elementType === "image") {
		return "video";
	}
	if (trackType === "audio") {
		return "audio";
	}
	if (trackType === "sticker" || elementType === "sticker") {
		return "sticker";
	}
	if (elementType !== "text") {
		return "unknown";
	}
	if (elementRole === "caption") {
		return "caption";
	}

	const normalizedTrackName = trackName.toLowerCase();
	const normalizedElementName = elementName.toLowerCase();
	const normalizedText = textContent.trim().toLowerCase();
	const isExplicitOverlay =
		normalizedElementName.includes("overlay") ||
		normalizedTrackName.includes("overlay");
	if (isExplicitOverlay) {
		return "text-overlay";
	}

	const isCaptionLike =
		normalizedTrackName.includes("caption") ||
		normalizedTrackName.includes("subtitle") ||
		normalizedElementName.includes("caption") ||
		normalizedElementName.includes("subtitle") ||
		(durationMs <= 6000 &&
			normalizedText.length > 0 &&
			normalizedText.length <= 160);

	return isCaptionLike ? "caption" : "text-overlay";
}

function isNearPlayhead({
	segment,
	playheadMs,
}: {
	segment: ProjectSegmentSummary;
	playheadMs: number;
}): boolean {
	if (playheadMs >= segment.start_ms && playheadMs <= segment.end_ms) {
		return true;
	}
	const midpoint = segment.start_ms + (segment.end_ms - segment.start_ms) / 2;
	return Math.abs(midpoint - playheadMs) <= PLAYHEAD_NEIGHBORHOOD_MS;
}

function buildMediaAnalysisMarkers({
	mediaAssets,
}: {
	mediaAssets: MediaAsset[];
}): ProjectMediaAnalysisMarkerSummary[] {
	return mediaAssets
		.filter((asset) => !asset.ephemeral)
			.map((asset) => ({
				asset_id: asset.id,
				name: asset.name,
				beat_marker_count: asset.beatAnalysis?.beats.length ?? 0,
				scene_cut_count: asset.visualAnalysis?.sceneCuts.length ?? 0,
				activity_window_count: asset.visualAnalysis?.activityWindows.length ?? 0,
			}))
			.filter(
				(marker) =>
					marker.beat_marker_count > 0 ||
					marker.scene_cut_count > 0 ||
					marker.activity_window_count > 0,
			)
			.sort((left, right) => left.name.localeCompare(right.name));
}

function rankTimelineWords({
	project,
	playheadMs,
	selectedSegments,
}: {
	project: TProject;
	playheadMs: number;
	selectedSegments: ProjectSegmentSummary[];
}): ReturnType<typeof buildTimelineTranscriptWords> {
	const words = buildTimelineTranscriptWords({ project });
	if (words.length <= MAX_TIMELINE_WORDS) {
		return words;
	}

	const anchorTimes = selectedSegments.length
		? selectedSegments.map(
				(segment) => segment.start_ms + (segment.end_ms - segment.start_ms) / 2,
		  )
		: [playheadMs];

	return [...words]
		.sort((left, right) => {
			const leftDistance = nearestAnchorDistance({
				valueMs: left.start_ms,
				anchorTimes,
			});
			const rightDistance = nearestAnchorDistance({
				valueMs: right.start_ms,
				anchorTimes,
			});
			if (leftDistance !== rightDistance) {
				return leftDistance - rightDistance;
			}
			return left.start_ms - right.start_ms;
		})
		.slice(0, MAX_TIMELINE_WORDS)
		.sort((left, right) => left.start_ms - right.start_ms);
}

function nearestAnchorDistance({
	valueMs,
	anchorTimes,
}: {
	valueMs: number;
	anchorTimes: number[];
}): number {
	let nearest = Number.POSITIVE_INFINITY;
	for (const anchorTime of anchorTimes) {
		nearest = Math.min(nearest, Math.abs(valueMs - anchorTime));
	}
	return nearest;
}
