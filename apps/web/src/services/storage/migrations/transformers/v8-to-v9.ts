import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV8ToV9({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	const projectId = getProjectId({ project });
	if (!projectId) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (isV9Project({ project })) {
		return { project, skipped: true, reason: "already v9" };
	}

	return {
		project: {
			...migrateProjectTimelineDefaults({ project }),
			version: 9,
		},
		skipped: false,
	};
}

function migrateProjectTimelineDefaults({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	const scenesValue = project.scenes;
	if (!Array.isArray(scenesValue)) return project;

	let hasChanges = false;
	const migratedScenes = scenesValue.map((scene) => {
		const migratedScene = migrateSceneTimelineDefaults({ scene });
		if (migratedScene !== scene) hasChanges = true;
		return migratedScene;
	});

	if (!hasChanges) return project;
	return { ...project, scenes: migratedScenes };
}

function migrateSceneTimelineDefaults({ scene }: { scene: unknown }): unknown {
	if (!isRecord(scene)) return scene;
	const tracksValue = scene.tracks;
	if (!Array.isArray(tracksValue)) return scene;

	let hasChanges = false;
	const migratedTracks = tracksValue.map((track) => {
		const migratedTrack = migrateTrackTimelineDefaults({ track });
		if (migratedTrack !== track) hasChanges = true;
		return migratedTrack;
	});

	if (!hasChanges) return scene;
	return { ...scene, tracks: migratedTracks };
}

function migrateTrackTimelineDefaults({ track }: { track: unknown }): unknown {
	if (!isRecord(track)) return track;
	const elementsValue = track.elements;
	if (!Array.isArray(elementsValue)) return track;

	let hasChanges = false;
	const migratedElements = elementsValue.map((element) => {
		const migratedElement = migrateElementTimelineDefaults({ element });
		if (migratedElement !== element) hasChanges = true;
		return migratedElement;
	});

	if (!hasChanges) return track;
	return { ...track, elements: migratedElements };
}

function migrateElementTimelineDefaults({
	element,
}: {
	element: unknown;
}): unknown {
	if (!isRecord(element) || typeof element.type !== "string") return element;

	switch (element.type) {
		case "video":
			return ensureDefaults({
				element,
				defaults: {
					playbackRate: 1,
					linkedGroupId: null,
				},
			});
		case "audio":
			return ensureDefaults({
				element,
				defaults: {
					playbackRate: 1,
					fadeInDuration: 0,
					fadeOutDuration: 0,
					linkedGroupId: null,
				},
			});
		case "image":
		case "text":
		case "sticker":
			return ensureDefaults({
				element,
				defaults: {
					linkedGroupId: null,
				},
			});
		default:
			return element;
	}
}

function ensureDefaults({
	element,
	defaults,
}: {
	element: ProjectRecord;
	defaults: Record<string, unknown>;
}): ProjectRecord {
	let didChange = false;
	const nextElement: ProjectRecord = { ...element };

	for (const [key, defaultValue] of Object.entries(defaults)) {
		if (nextElement[key] === undefined) {
			nextElement[key] = defaultValue;
			didChange = true;
		}
	}

	return didChange ? nextElement : element;
}

function isV9Project({ project }: { project: ProjectRecord }): boolean {
	return typeof project.version === "number" && project.version >= 9;
}
