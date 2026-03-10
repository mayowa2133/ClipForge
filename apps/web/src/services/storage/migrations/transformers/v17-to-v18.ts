import {
	DEFAULT_PROJECT_LIBRARY_DEFAULTS,
} from "@/constants/project-constants";
import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId } from "./utils";

export function transformProjectV17ToV18({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	const projectId = getProjectId({ project });
	if (!projectId) {
		return { project, skipped: true, reason: "no project id" };
	}
	if (typeof project.version === "number" && project.version >= 18) {
		return { project, skipped: true, reason: "already v18" };
	}

	const projectObject = project as ProjectRecord & {
		version?: number;
		settings?: Record<string, unknown>;
	};
	const settings = (projectObject.settings ?? {}) as Record<string, unknown>;

	return {
		project: {
			...projectObject,
			settings: {
				...settings,
				libraryDefaults:
					(settings.libraryDefaults as unknown) ??
					DEFAULT_PROJECT_LIBRARY_DEFAULTS,
			},
			version: 18,
		},
		skipped: false,
	};
}
