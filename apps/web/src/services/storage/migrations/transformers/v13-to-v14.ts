import { DEFAULT_PROJECT_BRAND_KIT } from "@/constants/project-constants";
import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV13ToV14({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	const projectId = getProjectId({ project });
	if (!projectId) {
		return { project, skipped: true, reason: "no project id" };
	}
	if (typeof project.version === "number" && project.version >= 14) {
		return { project, skipped: true, reason: "already v14" };
	}

	let nextProject = project;

	if (isRecord(project.settings)) {
		const nextBrandKit = {
			...DEFAULT_PROJECT_BRAND_KIT,
			...(isRecord(project.settings.brandKit) ? project.settings.brandKit : {}),
		};
		nextProject = {
			...project,
			settings: {
				...project.settings,
				brandKit: nextBrandKit,
			},
		};
	}

	return {
		project: {
			...nextProject,
			version: 14,
		},
		skipped: false,
	};
}
