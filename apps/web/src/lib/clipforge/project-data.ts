import type {
	CaptionStyleTemplate,
	ClipForgeProjectData,
	ClipMediaMetadata,
} from "@/types/clipforge";
import type { TProject } from "@/types/project";
import { adoptLegacyCaptionTracks } from "./caption-studio";

export const CLIPFORGE_SCHEMA_VERSION = 3;

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
		captionTrackIdsBySceneId: {},
		opsAudit: [],
	};
}

export function normalizeClipForgeMediaMetadata({
	metadata,
}: {
	metadata?: Partial<ClipMediaMetadata> | null;
}): ClipMediaMetadata {
	return {
		words: metadata?.words ?? [],
		segments: metadata?.segments ?? [],
		silenceRegions: metadata?.silenceRegions ?? [],
		transcriptionStatus: metadata?.transcriptionStatus ?? "idle",
		transcriptionProvider: metadata?.transcriptionProvider ?? null,
		transcriptionLanguage: metadata?.transcriptionLanguage ?? null,
		transcriptionError: metadata?.transcriptionError ?? null,
		indexedAt: metadata?.indexedAt ?? null,
	};
}

export function normalizeClipForgeProjectData({
	clipforge,
}: {
	clipforge?: ClipForgeProjectData | null;
}): ClipForgeProjectData {
	const defaults = buildDefaultClipForgeProjectData();
	const source = clipforge ?? defaults;

	return {
		...defaults,
		...source,
		schemaVersion: CLIPFORGE_SCHEMA_VERSION,
		mediaMetadataById: Object.fromEntries(
			Object.entries(source.mediaMetadataById ?? {}).map(([mediaId, metadata]) => [
				mediaId,
				normalizeClipForgeMediaMetadata({
					metadata: metadata ?? undefined,
				}),
			]),
		),
		captionStylesById: {
			...defaults.captionStylesById,
			...(source.captionStylesById ?? {}),
		},
		activeCaptionStyleId:
			source.activeCaptionStyleId ?? defaults.activeCaptionStyleId,
		captionTrackIdsBySceneId: {
			...defaults.captionTrackIdsBySceneId,
			...(source.captionTrackIdsBySceneId ?? {}),
		},
		opsAudit: source.opsAudit ?? [],
	};
}

export function ensureClipForgeProjectData({
	project,
}: {
	project: TProject;
}): TProject & { clipforge: ClipForgeProjectData } {
	const withClipForge = project.clipforge
		? ({
				...project,
				clipforge: normalizeClipForgeProjectData({
					clipforge: project.clipforge,
				}),
			} as TProject & { clipforge: ClipForgeProjectData })
		: ({
				...project,
				clipforge: buildDefaultClipForgeProjectData(),
			} as TProject & { clipforge: ClipForgeProjectData });

	return adoptLegacyCaptionTracks({
		project: withClipForge,
	}) as TProject & { clipforge: ClipForgeProjectData };
}
