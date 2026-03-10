import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId } from "./utils";

export function transformProjectV15ToV16({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	const projectId = getProjectId({ project });
	if (!projectId) {
		return { project, skipped: true, reason: "no project id" };
	}
	if (typeof project.version === "number" && project.version >= 16) {
		return { project, skipped: true, reason: "already v16" };
	}

	return {
		project: {
			...project,
			version: 16,
		},
		skipped: false,
	};
}
