import type { TScene, TimelineElement, TimelineTrack } from "@/types/timeline";
import type { ProjectAssemblyScene } from "@/types/project";
import { generateUUID } from "@/utils/id";
import { calculateTotalDuration } from "@/lib/timeline";
import { ensureMainTrack } from "@/lib/timeline/track-utils";

export function getMainScene({ scenes }: { scenes: TScene[] }): TScene | null {
	return scenes.find((scene) => scene.isMain) || null;
}

export function ensureMainScene({ scenes }: { scenes: TScene[] }): TScene[] {
	const hasMain = scenes.some((scene) => scene.isMain);
	if (!hasMain) {
		const mainScene = buildDefaultScene({ name: "Main scene", isMain: true });
		return [mainScene, ...scenes];
	}
	return scenes;
}

export function buildDefaultScene({
	name,
	isMain,
}: {
	name: string;
	isMain: boolean;
}): TScene {
	const tracks = ensureMainTrack({ tracks: [] });
	return {
		id: generateUUID(),
		name,
		isMain,
		tracks,
		bookmarks: [],
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

export function canDeleteScene({ scene }: { scene: TScene }): {
	canDelete: boolean;
	reason?: string;
} {
	if (scene.isMain) {
		return { canDelete: false, reason: "Cannot delete main scene" };
	}
	return { canDelete: true };
}

export function getFallbackSceneAfterDelete({
	scenes,
	deletedSceneId,
	currentSceneId,
}: {
	scenes: TScene[];
	deletedSceneId: string;
	currentSceneId: string | null;
}): TScene | null {
	if (currentSceneId !== deletedSceneId) {
		return scenes.find((s) => s.id === currentSceneId) || null;
	}
	return getMainScene({ scenes });
}

export function findCurrentScene({
	scenes,
	currentSceneId,
}: {
	scenes: TScene[];
	currentSceneId: string;
}): TScene | null {
	return (
		scenes.find((s) => s.id === currentSceneId) ||
		getMainScene({ scenes }) ||
		scenes[0] ||
		null
	);
}

export function getProjectDurationFromScenes({
	scenes,
}: {
	scenes: TScene[];
}): number {
	return buildProjectAssembly({ scenes }).reduce(
		(total, scene) => total + scene.duration,
		0,
	);
}

export function buildProjectAssembly({
	scenes,
}: {
	scenes: TScene[];
}): ProjectAssemblyScene[] {
	let projectStartTime = 0;

	return scenes.map((scene) => {
		const duration = calculateTotalDuration({ tracks: scene.tracks ?? [] });
		const assemblyScene: ProjectAssemblyScene = {
			sceneId: scene.id,
			name: scene.name,
			projectStartTime,
			duration,
			projectEndTime: projectStartTime + duration,
		};
		projectStartTime = assemblyScene.projectEndTime;
		return assemblyScene;
	});
}

export function buildProjectAssemblyTracks({
	scenes,
}: {
	scenes: TScene[];
}): TimelineTrack[] {
	const assembly = buildProjectAssembly({ scenes });
	const tracks: TimelineTrack[] = [];

	for (const scene of scenes) {
		const sceneAssembly =
			assembly.find((entry) => entry.sceneId === scene.id) ?? null;
		const sceneOffset = sceneAssembly?.projectStartTime ?? 0;

		for (const track of scene.tracks ?? []) {
			tracks.push({
				...track,
				id: `${scene.id}:${track.id}`,
				name: `${scene.name} · ${track.name}`,
				elements: track.elements.map((element) =>
					cloneElementWithStartOffset({
						element,
						startOffset: sceneOffset,
					}),
				),
			} as TimelineTrack);
		}
	}

	return tracks;
}

export function duplicateSceneWithFreshIds({
	scene,
	name,
}: {
	scene: TScene;
	name?: string;
}): TScene {
	const linkedGroupIds = new Map<string, string>();

	const tracks = scene.tracks.map((track) => ({
		...track,
		id: generateUUID(),
		elements: track.elements.map((element) =>
			cloneElementWithFreshId({
				element,
				linkedGroupIds,
			}),
		),
	})) as TimelineTrack[];

	return {
		...scene,
		id: generateUUID(),
		name: name ?? `${scene.name} Copy`,
		tracks,
		bookmarks: scene.bookmarks.map((bookmark) => ({ ...bookmark })),
		createdAt: new Date(),
		updatedAt: new Date(),
		isMain: false,
	};
}

export function updateSceneInArray({
	scenes,
	sceneId,
	updates,
}: {
	scenes: TScene[];
	sceneId: string;
	updates: Partial<TScene>;
}): TScene[] {
	return scenes.map((scene) =>
		scene.id === sceneId ? { ...scene, ...updates } : scene,
	);
}

function cloneElementWithStartOffset({
	element,
	startOffset,
}: {
	element: TimelineElement;
	startOffset: number;
}): TimelineElement {
	return {
		...element,
		startTime: element.startTime + startOffset,
	};
}

function cloneElementWithFreshId({
	element,
	linkedGroupIds,
}: {
	element: TimelineElement;
	linkedGroupIds: Map<string, string>;
}): TimelineElement {
	const linkedGroupId = getRemappedLinkedGroupId({
		value: "linkedGroupId" in element ? element.linkedGroupId ?? null : null,
		linkedGroupIds,
	});

	if (element.type === "video") {
		return {
			...element,
			id: generateUUID(),
			linkedGroupId,
			transitionIn: element.transitionIn ? { ...element.transitionIn } : null,
			keyframes: element.keyframes
				? {
						positionX: element.keyframes.positionX?.map((keyframe) => ({ ...keyframe })),
						positionY: element.keyframes.positionY?.map((keyframe) => ({ ...keyframe })),
						scale: element.keyframes.scale?.map((keyframe) => ({ ...keyframe })),
						rotate: element.keyframes.rotate?.map((keyframe) => ({ ...keyframe })),
						opacity: element.keyframes.opacity?.map((keyframe) => ({ ...keyframe })),
				  }
				: null,
			adjustments: element.adjustments ? { ...element.adjustments } : null,
			effects: element.effects?.map((effect) => ({ ...effect })),
			transform: {
				...element.transform,
				position: { ...element.transform.position },
				scale: element.transform.scale,
			},
		};
	}

	if (element.type === "image") {
		return {
			...element,
			id: generateUUID(),
			linkedGroupId,
			transitionIn: element.transitionIn ? { ...element.transitionIn } : null,
			keyframes: element.keyframes
				? {
						positionX: element.keyframes.positionX?.map((keyframe) => ({ ...keyframe })),
						positionY: element.keyframes.positionY?.map((keyframe) => ({ ...keyframe })),
						scale: element.keyframes.scale?.map((keyframe) => ({ ...keyframe })),
						rotate: element.keyframes.rotate?.map((keyframe) => ({ ...keyframe })),
						opacity: element.keyframes.opacity?.map((keyframe) => ({ ...keyframe })),
				  }
				: null,
			adjustments: element.adjustments ? { ...element.adjustments } : null,
			effects: element.effects?.map((effect) => ({ ...effect })),
			transform: {
				...element.transform,
				position: { ...element.transform.position },
				scale: element.transform.scale,
			},
		};
	}

	if (element.type === "text") {
		return {
			...element,
			id: generateUUID(),
			linkedGroupId,
			transitionIn: element.transitionIn ? { ...element.transitionIn } : null,
			keyframes: element.keyframes
				? {
						positionX: element.keyframes.positionX?.map((keyframe) => ({ ...keyframe })),
						positionY: element.keyframes.positionY?.map((keyframe) => ({ ...keyframe })),
						scale: element.keyframes.scale?.map((keyframe) => ({ ...keyframe })),
						rotate: element.keyframes.rotate?.map((keyframe) => ({ ...keyframe })),
						opacity: element.keyframes.opacity?.map((keyframe) => ({ ...keyframe })),
				  }
				: null,
			background: { ...element.background },
			transform: {
				...element.transform,
				position: { ...element.transform.position },
				scale: element.transform.scale,
			},
		};
	}

	if (element.type === "sticker") {
		return {
			...element,
			id: generateUUID(),
			linkedGroupId,
			transitionIn: element.transitionIn ? { ...element.transitionIn } : null,
			keyframes: element.keyframes
				? {
						positionX: element.keyframes.positionX?.map((keyframe) => ({ ...keyframe })),
						positionY: element.keyframes.positionY?.map((keyframe) => ({ ...keyframe })),
						scale: element.keyframes.scale?.map((keyframe) => ({ ...keyframe })),
						rotate: element.keyframes.rotate?.map((keyframe) => ({ ...keyframe })),
						opacity: element.keyframes.opacity?.map((keyframe) => ({ ...keyframe })),
				  }
				: null,
			transform: {
				...element.transform,
				position: { ...element.transform.position },
				scale: element.transform.scale,
			},
		};
	}

	return {
		...element,
		id: generateUUID(),
		linkedGroupId,
	};
}

function getRemappedLinkedGroupId({
	value,
	linkedGroupIds,
}: {
	value: string | null;
	linkedGroupIds: Map<string, string>;
}): string | null {
	if (!value) return null;
	const existing = linkedGroupIds.get(value);
	if (existing) return existing;
	const next = generateUUID();
	linkedGroupIds.set(value, next);
	return next;
}
