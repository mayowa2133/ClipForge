import {
	DEFAULT_BLEND_MODE,
	DEFAULT_OPACITY,
	DEFAULT_TRANSFORM,
} from "@/constants/timeline-constants";
import { calculateTotalDuration } from "@/lib/timeline";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type { TimelineTrack, VideoTrack } from "@/types/timeline";
import type {
	ClipForgeRecentReferenceAssemblyChoice,
	ReferenceDraftSectionMatch,
	ReferenceMatchLock,
} from "@/types/clipforge";
import { generateUUID } from "@/utils/id";
import { ensureClipForgeProjectData } from "./project-data";

export interface BuildReferenceGuidedDraftResult {
	project: TProject;
	appliedChoices: ClipForgeRecentReferenceAssemblyChoice[];
}

export function buildReferenceGuidedDraft({
	project,
	mediaAssets,
	matches,
	referenceAssetId,
}: {
	project: TProject;
	mediaAssets: MediaAsset[];
	matches: ReferenceDraftSectionMatch[];
	referenceAssetId: string | null;
}): BuildReferenceGuidedDraftResult {
	const nextProject = structuredClone(ensureClipForgeProjectData({ project }));
	const activeScene =
		nextProject.scenes.find((scene) => scene.id === nextProject.currentSceneId) ??
		nextProject.scenes[0] ??
		null;
	if (!activeScene) {
		return { project: nextProject, appliedChoices: [] };
	}

	const existingMainTrack =
		activeScene.tracks.find(
			(track): track is VideoTrack => track.type === "video" && track.isMain === true,
		) ?? null;

	const mainTrack: VideoTrack = {
		id: existingMainTrack?.id ?? generateUUID(),
		type: "video",
		name: existingMainTrack?.name ?? "Main video",
		isMain: true,
		muted: existingMainTrack?.muted ?? false,
		hidden: existingMainTrack?.hidden ?? false,
		elements: [],
	};

	let cursorTime = 0;
	const appliedChoices: ClipForgeRecentReferenceAssemblyChoice[] = [];
	const nextLocks: Record<string, ReferenceMatchLock> = {
		...nextProject.clipforge.referenceMatchLocks,
	};

	for (const match of matches) {
		const asset = mediaAssets.find(
			(candidate) => candidate.id === match.selected_asset_id && candidate.type === "video",
		);
		if (!asset) {
			continue;
		}
		const assetDurationMs = Math.max(1, Math.round((asset.duration ?? 0) * 1000));
		const startMs = clampMs({
			value: match.selected_start_ms,
			max: Math.max(0, assetDurationMs - 200),
		});
		const endMs = clampMs({
			value: match.selected_end_ms,
			min: startMs + 200,
			max: assetDurationMs,
		});
		const duration = Math.max(0.35, (endMs - startMs) / 1000);
		const elementId = generateUUID();
		mainTrack.elements.push({
			id: elementId,
			type: "video",
			mediaId: asset.id,
			name: asset.name,
			duration,
			startTime: cursorTime,
			trimStart: startMs / 1000,
			trimEnd: Math.max(0, (assetDurationMs - endMs) / 1000),
			muted: false,
			hidden: false,
			transform: { ...DEFAULT_TRANSFORM },
			opacity: DEFAULT_OPACITY,
			blendMode: DEFAULT_BLEND_MODE,
		});
		cursorTime += duration;

		appliedChoices.push({
			matchId: match.match_id,
			sectionLabel: match.section_label,
			sectionRole: match.section_role,
			segmentId: elementId,
			assetId: asset.id,
			assetLabel: asset.name,
			alternativeAssetIds: match.candidates
				.map((candidate) => candidate.asset_id)
				.filter((assetId, index, values) => values.indexOf(assetId) === index)
				.filter((assetId) => assetId !== asset.id),
			createdAt: new Date().toISOString(),
		});

		if (match.locked) {
			nextLocks[match.match_id] = {
				match_id: match.match_id,
				asset_id: asset.id,
				asset_name: asset.name,
				locked_at: new Date().toISOString(),
			};
		}
	}

	const nextTracks: TimelineTrack[] = [
		mainTrack,
		...activeScene.tracks
			.filter((track) => track.id !== mainTrack.id)
			.map((track) => ({ ...track, elements: [] })),
	];

	activeScene.tracks = nextTracks;
	nextProject.metadata.duration = calculateTotalDuration({
		tracks: nextTracks,
	});
	nextProject.clipforge.activeReferenceVideoAssetId = referenceAssetId;
	nextProject.clipforge.referenceMatchLocks = nextLocks;
	activeScene.updatedAt = new Date();
	nextProject.metadata.updatedAt = new Date();

	return {
		project: nextProject,
		appliedChoices,
	};
}

function clampMs({
	value,
	min = 0,
	max,
}: {
	value: number;
	min?: number;
	max: number;
}) {
	return Math.min(Math.max(value, min), max);
}
