import { calculateTotalDuration } from "@/lib/timeline";
import {
	buildTimelineTranscriptWords,
	buildTranscriptSnippetForElement,
} from "@/lib/clipforge/timeline-transcript";
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
		recent_ai_actions: [...recentAiActions].reverse(),
		recent_turn_summaries: [...recentTurnSummaries].reverse(),
		timeline_words: rankTimelineWords({
			project,
			playheadMs,
			selectedSegments,
		}).slice(0, MAX_TIMELINE_WORDS),
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
