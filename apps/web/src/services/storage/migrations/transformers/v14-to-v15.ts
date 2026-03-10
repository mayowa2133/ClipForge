import {
	DEFAULT_PROJECT_BRAND_KIT,
	DEFAULT_PROJECT_OVERLAY_DEFAULTS,
} from "@/constants/project-constants";
import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV14ToV15({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	const projectId = getProjectId({ project });
	if (!projectId) {
		return { project, skipped: true, reason: "no project id" };
	}
	if (typeof project.version === "number" && project.version >= 15) {
		return { project, skipped: true, reason: "already v15" };
	}

	let nextProject = project;
	if (isRecord(project.settings)) {
		nextProject = {
			...project,
			settings: {
				...project.settings,
				brandKit: {
					...DEFAULT_PROJECT_BRAND_KIT,
					...(isRecord(project.settings.brandKit) ? project.settings.brandKit : {}),
				},
				overlayDefaults: {
					...DEFAULT_PROJECT_OVERLAY_DEFAULTS,
					...(isRecord(project.settings.overlayDefaults)
						? project.settings.overlayDefaults
						: {}),
				},
			},
		};
	}

	return {
		project: {
			...nextProject,
			version: 15,
		},
		skipped: false,
	};
}
