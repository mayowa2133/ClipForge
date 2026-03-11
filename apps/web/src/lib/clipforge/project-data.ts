import type {
	CaptionStyleTemplate,
	ClipForgeProjectData,
	ClipMediaMetadata,
} from "@/types/clipforge";
import type { TProject } from "@/types/project";
import { adoptLegacyCaptionTracks } from "./caption-studio";
import { BUILT_IN_CAPTION_STYLE_MAP } from "./caption-style-library";

export const CLIPFORGE_SCHEMA_VERSION = 5;

export function buildDefaultClipForgeProjectData(): ClipForgeProjectData {
	return {
		schemaVersion: CLIPFORGE_SCHEMA_VERSION,
		mediaMetadataById: {},
		captionStylesById: {
			...BUILT_IN_CAPTION_STYLE_MAP,
		},
		activeCaptionStyleId: "clean-bottom",
		captionTrackIdsBySceneId: {},
		sceneFootageIntelligenceBySceneId: {},
		trendSoundReferences: [],
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

function normalizeFootageReport({
	report,
}: {
	report?: Partial<import("@/types/clipforge").FootageIntelligenceReport> | null;
}): import("@/types/clipforge").FootageIntelligenceReport | null {
	if (!report) return null;
	return {
		generatedAt:
			typeof report.generatedAt === "string"
				? report.generatedAt
				: new Date(0).toISOString(),
		hookCandidates: Array.isArray(report.hookCandidates)
			? report.hookCandidates
					.map((candidate) => {
						if (
							typeof candidate?.id !== "string" ||
							typeof candidate?.trackId !== "string" ||
							typeof candidate?.elementId !== "string" ||
							typeof candidate?.startTime !== "number" ||
							typeof candidate?.endTime !== "number" ||
							typeof candidate?.score !== "number"
						) {
							return null;
						}
						return {
							id: candidate.id,
							trackId: candidate.trackId,
							elementId: candidate.elementId,
							startTime: candidate.startTime,
							endTime: candidate.endTime,
							score: candidate.score,
							reasons: Array.isArray(candidate.reasons)
								? candidate.reasons.filter(
										(reason): reason is string => typeof reason === "string",
								  )
								: [],
						};
					})
					.filter(
						(
							candidate,
						): candidate is import("@/types/clipforge").HookCandidate => candidate !== null,
					)
			: [],
		momentScores: Array.isArray(report.momentScores)
			? report.momentScores
					.map((score) => {
						if (
							typeof score?.id !== "string" ||
							typeof score?.trackId !== "string" ||
							typeof score?.elementId !== "string" ||
							typeof score?.startTime !== "number" ||
							typeof score?.endTime !== "number" ||
							typeof score?.totalScore !== "number"
						) {
							return null;
						}
						return {
							id: score.id,
							trackId: score.trackId,
							elementId: score.elementId,
							startTime: score.startTime,
							endTime: score.endTime,
							totalScore: score.totalScore,
							reasons: Array.isArray(score.reasons)
								? score.reasons.filter(
										(reason): reason is string => typeof reason === "string",
								  )
								: [],
						};
					})
					.filter(
						(
							score,
						): score is import("@/types/clipforge").FootageMomentScore => score !== null,
					)
			: [],
		keepCutRecommendations: Array.isArray(report.keepCutRecommendations)
			? report.keepCutRecommendations
					.map((recommendation) => {
						if (
							typeof recommendation?.id !== "string" ||
							typeof recommendation?.trackId !== "string" ||
							typeof recommendation?.elementId !== "string" ||
							typeof recommendation?.startTime !== "number" ||
							typeof recommendation?.endTime !== "number" ||
							typeof recommendation?.score !== "number" ||
							(recommendation?.action !== "keep" &&
								recommendation?.action !== "trim" &&
								recommendation?.action !== "cut")
						) {
							return null;
						}
						return {
							id: recommendation.id,
							trackId: recommendation.trackId,
							elementId: recommendation.elementId,
							action: recommendation.action,
							startTime: recommendation.startTime,
							endTime: recommendation.endTime,
							score: recommendation.score,
							reasons: Array.isArray(recommendation.reasons)
								? recommendation.reasons.filter(
										(reason): reason is string => typeof reason === "string",
								  )
								: [],
						};
					})
					.filter(
						(
							recommendation,
						): recommendation is import("@/types/clipforge").KeepCutRecommendation =>
							recommendation !== null,
					)
			: [],
		warnings: Array.isArray(report.warnings)
			? report.warnings.filter(
					(warning): warning is string => typeof warning === "string",
			  )
			: [],
	};
}

function normalizeTrendSoundReferences({
	references,
}: {
	references: unknown;
}): import("@/types/clipforge").TrendSoundReference[] {
	if (!Array.isArray(references)) {
		return [];
	}

	return references.flatMap((reference) => {
		if (
			typeof reference?.id !== "string" ||
			typeof reference?.label !== "string" ||
			(reference?.platform !== "tiktok" &&
				reference?.platform !== "instagram" &&
				reference?.platform !== "youtube") ||
			typeof reference?.createdAt !== "string"
		) {
			return [];
		}

		return [
			{
				id: reference.id,
				label: reference.label,
				platform: reference.platform,
				creator: typeof reference.creator === "string" ? reference.creator : null,
				sourceUrl: typeof reference.sourceUrl === "string" ? reference.sourceUrl : null,
				notes: typeof reference.notes === "string" ? reference.notes : null,
				createdAt: reference.createdAt,
			},
		];
	});
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
		sceneFootageIntelligenceBySceneId: Object.fromEntries(
			Object.entries(source.sceneFootageIntelligenceBySceneId ?? {}).map(
				([sceneId, report]) => [sceneId, normalizeFootageReport({ report })],
			),
		),
		trendSoundReferences: normalizeTrendSoundReferences({
			references: source.trendSoundReferences,
		}),
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
