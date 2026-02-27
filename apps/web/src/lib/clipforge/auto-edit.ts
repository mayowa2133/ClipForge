import {
	DEFAULT_BLEND_MODE,
	DEFAULT_OPACITY,
	DEFAULT_TRANSFORM,
	TIMELINE_CONSTANTS,
} from "@/constants/timeline-constants";
import { calculateTotalDuration } from "@/lib/timeline";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type { TimelineTrack, VideoTrack } from "@/types/timeline";
import { generateUUID } from "@/utils/id";
import { applyTimelineDiffOpsToProject } from "./timeline-op-engine";
import { ensureClipForgeProjectData } from "./project-data";

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

	const videoAssets = [...mediaAssets]
		.filter((asset) => asset.type === "video")
		.sort((a, b) => a.name.localeCompare(b.name));
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
