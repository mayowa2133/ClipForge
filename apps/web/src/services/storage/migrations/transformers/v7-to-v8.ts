import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV7ToV8({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	const projectId = getProjectId({ project });
	if (!projectId) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (isV8Project({ project })) {
		return { project, skipped: true, reason: "already v8" };
	}

	return {
		project: {
			...project,
			clipforge: buildDefaultClipForgeRecord(),
			version: 8,
		},
		skipped: false,
	};
}

function buildDefaultClipForgeRecord(): ProjectRecord {
	return {
		schemaVersion: 2,
		mediaMetadataById: {},
		captionStylesById: {
			"clean-bottom": {
				style_id: "clean-bottom",
				font: "Arial",
				size: 56,
				position: "bottom",
				outline: false,
				highlight_mode: "none",
			},
			"bold-center": {
				style_id: "bold-center",
				font: "Arial",
				size: 74,
				position: "center",
				outline: true,
				highlight_mode: "line",
			},
		},
		activeCaptionStyleId: "clean-bottom",
		opsAudit: [],
	};
}

function isV8Project({ project }: { project: ProjectRecord }): boolean {
	if (typeof project.version !== "number" || project.version < 8) {
		return false;
	}
	const clipforge = project.clipforge;
	return isRecord(clipforge);
}
