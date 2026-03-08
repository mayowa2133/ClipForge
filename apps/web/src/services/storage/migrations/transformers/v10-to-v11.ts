import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV10ToV11({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	const projectId = getProjectId({ project });
	if (!projectId) {
		return { project, skipped: true, reason: "no project id" };
	}
	if (isV11Project({ project })) {
		return { project, skipped: true, reason: "already v11" };
	}
	return {
		project: {
			...migrateFinishingDefaults({ project }),
			version: 11,
		},
		skipped: false,
	};
}

function migrateFinishingDefaults({ project }: { project: ProjectRecord }): ProjectRecord {
	const scenesValue = project.scenes;
	if (!Array.isArray(scenesValue)) return project;

	let changed = false;
	const scenes = scenesValue.map((scene) => {
		if (!isRecord(scene) || !Array.isArray(scene.tracks)) return scene;
		let sceneChanged = false;
		const tracks = scene.tracks.map((track) => {
			if (!isRecord(track) || !Array.isArray(track.elements)) return track;
			let trackChanged = false;
			const elements = track.elements.map((element) => {
				if (!isRecord(element)) return element;
				if (element.type !== "video" && element.type !== "image") return element;
				let elementChanged = false;
				const next = { ...element };
				if (next.adjustments === undefined) {
					next.adjustments = null;
					elementChanged = true;
				}
				if (next.effects === undefined) {
					next.effects = null;
					elementChanged = true;
				}
				if (elementChanged) trackChanged = true;
				return elementChanged ? next : element;
			});
			if (!trackChanged) return track;
			sceneChanged = true;
			return { ...track, elements };
		});
		if (!sceneChanged) return scene;
		changed = true;
		return { ...scene, tracks };
	});

	return changed ? { ...project, scenes } : project;
}

function isV11Project({ project }: { project: ProjectRecord }): boolean {
	return typeof project.version === "number" && project.version >= 11;
}
