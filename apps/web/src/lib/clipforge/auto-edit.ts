import {
	DEFAULT_BLEND_MODE,
	DEFAULT_OPACITY,
	DEFAULT_TRANSFORM,
	TIMELINE_CONSTANTS,
} from "@/constants/timeline-constants";
import { calculateTotalDuration } from "@/lib/timeline";
import type { MediaAsset } from "@/types/assets";
import type { ClipMediaMetadata } from "@/types/clipforge";
import type { TProject } from "@/types/project";
import type { TimelineTrack, VideoTrack } from "@/types/timeline";
import { generateUUID } from "@/utils/id";
import { applyTimelineDiffOpsToProject } from "./timeline-op-engine";
import { ensureClipForgeProjectData } from "./project-data";

/**
 * Score a raw media asset using available metadata signals.
 * Higher score = stronger content for a TikTok-style draft.
 *
 * Weights mirror the footage intelligence scoring formula:
 *   visual × 2.2  +  transcript density × 1.8  −  silence penalty × 1.6
 *   + scene-cut bonus + duration bonus
 */
export function scoreRawAsset({
	asset,
	metadata,
}: {
	asset: MediaAsset;
	metadata: ClipMediaMetadata | null;
}): number {
	const duration = Math.max(0.5, asset.duration ?? 1);
	let score = 0;

	// --- Visual activity: peak activity window score ---
	const activityWindows = asset.visualAnalysis?.activityWindows ?? [];
	if (activityWindows.length > 0) {
		const peakVisual = Math.max(...activityWindows.map((w) => w.score));
		score += Math.min(1.5, peakVisual) * 2.2;
	} else {
		// No visual analysis — neutral baseline
		score += 0.2 * 2.2;
	}

	// --- Scene cuts: more visual variety is better for short-form ---
	const sceneCutCount = asset.visualAnalysis?.sceneCuts?.length ?? 0;
	if (sceneCutCount >= 3) {
		score += 0.4;
	} else if (sceneCutCount >= 1) {
		score += 0.2;
	}

	// --- Transcript density: words per second ---
	const wordCount = metadata?.words?.length ?? 0;
	if (wordCount > 0) {
		const wordsPerSecond = wordCount / duration;
		score += Math.min(1.2, wordsPerSecond / 3.5) * 1.8;
	}

	// --- Silence penalty ---
	const silenceRegions = metadata?.silenceRegions ?? [];
	if (silenceRegions.length > 0) {
		const totalSilenceMs = silenceRegions.reduce(
			(total, region) => total + (region.end_ms - region.start_ms),
			0,
		);
		const silenceRatio = totalSilenceMs / Math.max(1, duration * 1000);
		score -= Math.min(1, silenceRatio) * 1.6;
	}

	// --- Duration bonus: clips in the 5-30s sweet spot for TikTok ---
	if (duration >= 5 && duration <= 30) {
		score += 0.3;
	} else if (duration >= 2 && duration <= 60) {
		score += 0.1;
	}

	return Number(score.toFixed(3));
}

/**
 * Rank video assets by engagement score using available metadata.
 * Falls back to alphabetical ordering when no metadata is available.
 */
export function rankVideoAssets({
	videoAssets,
	project,
}: {
	videoAssets: MediaAsset[];
	project: TProject;
}): MediaAsset[] {
	const metadataById = project.clipforge?.mediaMetadataById ?? {};
	const hasAnyMetadata = videoAssets.some(
		(asset) =>
			asset.visualAnalysis != null || metadataById[asset.id] != null,
	);

	if (!hasAnyMetadata) {
		return [...videoAssets].sort((a, b) => a.name.localeCompare(b.name));
	}

	const scored = videoAssets.map((asset) => ({
		asset,
		score: scoreRawAsset({
			asset,
			metadata: metadataById[asset.id] ?? null,
		}),
	}));

	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return a.asset.name.localeCompare(b.asset.name);
	});

	return scored.map((entry) => entry.asset);
}

export function buildAutoEditTikTokDraft({
	project,
	mediaAssets,
}: {
	project: TProject;
	mediaAssets: MediaAsset[];
}): TProject {
	const nextProject = structuredClone(ensureClipForgeProjectData({ project }));
	const activeScene =
		nextProject.scenes.find((scene) => scene.id === nextProject.currentSceneId) ??
		nextProject.scenes[0];
	if (!activeScene) {
		return nextProject;
	}

	const videoAssets = rankVideoAssets({
		videoAssets: mediaAssets.filter(
			(asset) => asset.type === "video" && !asset.ephemeral,
		),
		project: nextProject,
	});
	if (videoAssets.length === 0) {
		return nextProject;
	}

	const existingMainTrack =
		activeScene.tracks.find(
			(track): track is VideoTrack =>
				track.type === "video" && track.isMain === true,
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
	for (const asset of videoAssets) {
		const durationMs = Math.max(
			0.3,
			asset.duration ?? TIMELINE_CONSTANTS.DEFAULT_ELEMENT_DURATION,
		);
		mainTrack.elements.push({
			id: generateUUID(),
			type: "video",
			mediaId: asset.id,
			name: asset.name,
			duration: durationMs,
			startTime: cursorTime,
			trimStart: 0,
			trimEnd: 0,
			muted: false,
			hidden: false,
			transform: { ...DEFAULT_TRANSFORM },
			opacity: DEFAULT_OPACITY,
			blendMode: DEFAULT_BLEND_MODE,
		});
		cursorTime += durationMs;
	}

	const nextTracks: TimelineTrack[] = [
		mainTrack,
		...activeScene.tracks
			.filter((track) => track.id !== mainTrack.id)
			.map((track) => ({ ...track, elements: [] })),
	];

	activeScene.tracks = nextTracks;

	const draftedProject = applyTimelineDiffOpsToProject({
		project: nextProject,
		source: "auto-edit",
		ops: [
			{ type: "SET_ASPECT_RATIO", preset: "9:16" },
			{
				type: "REMOVE_SILENCE",
				threshold_ms: 0.32,
				pad_ms: 0.09,
				min_keep_ms: 0.45,
			},
		],
	});

	draftedProject.metadata.duration = calculateTotalDuration({
		tracks: nextTracks,
	});

	return draftedProject;
}
