import { buildDefaultProjectVersionPack } from "@/constants/project-constants";
import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId } from "./utils";

export function transformProjectV16ToV17({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	const projectId = getProjectId({ project });
	if (!projectId) {
		return { project, skipped: true, reason: "no project id" };
	}
	if (typeof project.version === "number" && project.version >= 17) {
		return { project, skipped: true, reason: "already v17" };
	}

	const projectObject = project as ProjectRecord & {
		version?: number;
		settings?: Record<string, unknown>;
		scenes?: Array<Record<string, unknown>>;
	};
	const settings = (projectObject.settings ?? {}) as Record<string, unknown>;
	const scenes = Array.isArray(projectObject.scenes) ? projectObject.scenes : [];
	const canvasSize =
		(settings.canvasSize as { width: number; height: number } | undefined) ??
		buildDefaultProjectVersionPack({
			canvasSize: { width: 1920, height: 1080 },
		}).targets[2].canvasSize;

	return {
		project: {
			...projectObject,
			settings: {
				...settings,
				versionPack:
					(settings.versionPack as unknown) ??
					buildDefaultProjectVersionPack({ canvasSize }),
			},
			scenes: scenes.map((scene) => ({
				...scene,
				tracks: (Array.isArray(scene.tracks) ? scene.tracks : []).map((track: Record<string, unknown>) => ({
					...track,
					elements: (Array.isArray(track.elements) ? track.elements : []).map((element: Record<string, unknown>) => {
						if (
							element.type === "video" ||
							element.type === "image" ||
							element.type === "text" ||
							element.type === "sticker"
						) {
							return {
								...element,
								versionOverrides: element.versionOverrides ?? null,
							};
						}
						return element;
					}),
				})),
			})),
			version: 17,
		},
		skipped: false,
	};
}
