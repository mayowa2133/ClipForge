import type {
	CaptionStyleTemplate,
	ClipForgeProjectData,
} from "@/types/clipforge";
import type { TProject } from "@/types/project";

export const CLIPFORGE_SCHEMA_VERSION = 1;

const CLEAN_BOTTOM_STYLE: CaptionStyleTemplate = {
	style_id: "clean-bottom",
	font: "Arial",
	size: 56,
	position: "bottom",
	outline: false,
	highlight_mode: "none",
};

const BOLD_CENTER_STYLE: CaptionStyleTemplate = {
	style_id: "bold-center",
	font: "Arial",
	size: 74,
	position: "center",
	outline: true,
	highlight_mode: "line",
};

export function buildDefaultClipForgeProjectData(): ClipForgeProjectData {
	return {
		schemaVersion: CLIPFORGE_SCHEMA_VERSION,
		mediaMetadataById: {},
		captionStylesById: {
			[CLEAN_BOTTOM_STYLE.style_id]: CLEAN_BOTTOM_STYLE,
			[BOLD_CENTER_STYLE.style_id]: BOLD_CENTER_STYLE,
		},
		activeCaptionStyleId: CLEAN_BOTTOM_STYLE.style_id,
		opsAudit: [],
	};
}

export function ensureClipForgeProjectData({
	project,
}: {
	project: TProject;
}): TProject & { clipforge: ClipForgeProjectData } {
	if (project.clipforge) {
		return project as TProject & { clipforge: ClipForgeProjectData };
	}

	return {
		...project,
		clipforge: buildDefaultClipForgeProjectData(),
	};
}
