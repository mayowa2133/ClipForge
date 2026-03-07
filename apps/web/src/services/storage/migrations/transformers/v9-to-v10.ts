import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV9ToV10({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	const projectId = getProjectId({ project });
	if (!projectId) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (isV10Project({ project })) {
		return { project, skipped: true, reason: "already v10" };
	}

	return {
		project: {
			...migrateMotionDefaults({ project }),
			version: 10,
		},
		skipped: false,
	};
}

function migrateMotionDefaults({ project }: { project: ProjectRecord }): ProjectRecord {
	const scenesValue = project.scenes;
	if (!Array.isArray(scenesValue)) return project;

	let hasChanges = false;
	const scenes = scenesValue.map((scene) => {
		const nextScene = migrateSceneMotionDefaults({ scene });
		if (nextScene !== scene) hasChanges = true;
		return nextScene;
	});

	if (!hasChanges) return project;
	return { ...project, scenes };
}

function migrateSceneMotionDefaults({ scene }: { scene: unknown }): unknown {
	if (!isRecord(scene)) return scene;
	const tracksValue = scene.tracks;
	if (!Array.isArray(tracksValue)) return scene;

	let hasChanges = false;
	const tracks = tracksValue.map((track) => {
		const nextTrack = migrateTrackMotionDefaults({ track });
		if (nextTrack !== track) hasChanges = true;
		return nextTrack;
	});

	if (!hasChanges) return scene;
	return { ...scene, tracks };
}

function migrateTrackMotionDefaults({ track }: { track: unknown }): unknown {
	if (!isRecord(track)) return track;
	const elementsValue = track.elements;
	if (!Array.isArray(elementsValue)) return track;

	let hasChanges = false;
	const elements = elementsValue.map((element) => {
		const nextElement = migrateElementMotionDefaults({ element });
		if (nextElement !== element) hasChanges = true;
		return nextElement;
	});

	if (!hasChanges) return track;
	return { ...track, elements };
}

function migrateElementMotionDefaults({ element }: { element: unknown }): unknown {
	if (!isRecord(element) || typeof element.type !== "string") return element;

	switch (element.type) {
		case "video":
		case "image":
		case "text":
		case "sticker":
			return ensureDefaults({
				element,
				defaults: {
					transitionIn: null,
					keyframes: null,
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

function isV10Project({ project }: { project: ProjectRecord }): boolean {
	return typeof project.version === "number" && project.version >= 10;
}
