import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId } from "./utils";

export function transformProjectV18ToV19({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	const projectId = getProjectId({ project });
	if (!projectId) {
		return { project, skipped: true, reason: "no project id" };
	}
	if (typeof project.version === "number" && project.version >= 19) {
		return { project, skipped: true, reason: "already v19" };
	}

	const projectObject = project as ProjectRecord & {
		version?: number;
		settings?: Record<string, unknown>;
	};
	const settings = (projectObject.settings ?? {}) as Record<string, unknown>;
	const audio = (settings.audio ?? {}) as Record<string, unknown>;

	return {
		project: {
			...projectObject,
			settings: {
				...settings,
				audio: {
					...audio,
					audioPolishPresetId: audio.audioPolishPresetId ?? "none",
					softLimiterEnabled: audio.softLimiterEnabled ?? false,
				},
				polishProfileId: settings.polishProfileId ?? null,
			},
			version: 19,
		},
		skipped: false,
	};
}
