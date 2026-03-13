import type {
	CaptionStyleTemplate,
	ClipForgeAppliedCommandSummary,
	ClipForgeRecentAssetChoice,
	ClipForgeChatMemory,
	ClipForgeChatTurnSummary,
	ClipForgeProjectData,
	ClipMediaMetadata,
} from "@/types/clipforge";
import type { TProject } from "@/types/project";
import { adoptLegacyCaptionTracks } from "./caption-studio";
import { BUILT_IN_CAPTION_STYLE_MAP } from "./caption-style-library";

export const CLIPFORGE_SCHEMA_VERSION = 6;

const MAX_CHAT_MEMORY_TURNS = 12;
const MAX_CHAT_MEMORY_APPLIED_COMMANDS = 20;
const MAX_CHAT_MEMORY_ASSET_CHOICES = 12;

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
		chatMemory: {
			activeTargets: [],
			styleIntent: null,
			publishIntent: null,
			finishIntent: null,
			destinationIntent: null,
			recentTurnSummaries: [],
			recentAppliedCommandSummaries: [],
			recentAssetChoices: [],
		},
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

function normalizeCommandScope(value: unknown): import("@/types/clipforge").ClipForgeCommandScope {
	return value === "scene" || value === "project" ? value : "selection";
}

function normalizeTurnSummary(value: unknown): ClipForgeChatTurnSummary | null {
	if (
		typeof value !== "object" ||
		value === null ||
		typeof (value as { prompt?: unknown }).prompt !== "string" ||
		typeof (value as { summary?: unknown }).summary !== "string" ||
		typeof (value as { createdAt?: unknown }).createdAt !== "string"
	) {
		return null;
	}

	const commandKinds = Array.isArray((value as { commandKinds?: unknown }).commandKinds)
		? ((value as { commandKinds?: unknown }).commandKinds as unknown[]).filter(
				(kind): kind is ClipForgeChatTurnSummary["commandKinds"][number] =>
					typeof kind === "string",
		  )
		: [];

	return {
		prompt: (value as { prompt: string }).prompt,
		summary: (value as { summary: string }).summary,
		commandKinds,
		createdAt: (value as { createdAt: string }).createdAt,
	};
}

function normalizeAppliedCommandSummary(
	value: unknown,
): ClipForgeAppliedCommandSummary | null {
	if (
		typeof value !== "object" ||
		value === null ||
		typeof (value as { kind?: unknown }).kind !== "string" ||
		typeof (value as { summary?: unknown }).summary !== "string" ||
		typeof (value as { createdAt?: unknown }).createdAt !== "string"
	) {
		return null;
	}

	const segmentIds = Array.isArray(
		(value as { targetSegmentIds?: unknown }).targetSegmentIds,
	)
		? ((value as { targetSegmentIds?: unknown }).targetSegmentIds as unknown[]).filter(
				(id): id is string => typeof id === "string",
		  )
		: [];
	const elementIds = Array.isArray(
		(value as { targetElementIds?: unknown }).targetElementIds,
	)
		? ((value as { targetElementIds?: unknown }).targetElementIds as unknown[]).filter(
				(id): id is string => typeof id === "string",
		  )
		: [];

	return {
		kind: (value as { kind: ClipForgeAppliedCommandSummary["kind"] }).kind,
		summary: (value as { summary: string }).summary,
		targetSegmentIds: segmentIds,
		targetElementIds: elementIds,
		sceneId:
			typeof (value as { sceneId?: unknown }).sceneId === "string"
				? ((value as { sceneId?: string }).sceneId ?? null)
				: null,
		scope: normalizeCommandScope((value as { scope?: unknown }).scope),
		createdAt: (value as { createdAt: string }).createdAt,
	};
}

function normalizeRecentAssetChoice(
	value: unknown,
): ClipForgeRecentAssetChoice | null {
	if (
		typeof value !== "object" ||
		value === null ||
		typeof (value as { assetId?: unknown }).assetId !== "string" ||
		typeof (value as { label?: unknown }).label !== "string" ||
		typeof (value as { createdAt?: unknown }).createdAt !== "string"
	) {
		return null;
	}

	const assetKind = (value as { assetKind?: unknown }).assetKind;
	const commandKind = (value as { commandKind?: unknown }).commandKind;
	if (
		(assetKind !== "music" &&
			assetKind !== "sfx" &&
			assetKind !== "trend-reference") ||
		(commandKind !== "apply-music-track" &&
			commandKind !== "replace-music-track" &&
			commandKind !== "insert-sfx-preset" &&
			commandKind !== "apply-project-kit")
	) {
		return null;
	}

	return {
		assetId: (value as { assetId: string }).assetId,
		assetKind,
		label: (value as { label: string }).label,
		commandKind,
		createdAt: (value as { createdAt: string }).createdAt,
	};
}

function normalizeChatMemory({
	memory,
}: {
	memory?: Partial<ClipForgeChatMemory> | null;
}): ClipForgeChatMemory {
	return {
		activeTargets: Array.isArray(memory?.activeTargets)
			? memory.activeTargets.filter(
					(target): target is string => typeof target === "string",
			  )
			: [],
		styleIntent: memory?.styleIntent
			? {
					captionStyleId:
						typeof memory.styleIntent.captionStyleId === "string"
							? memory.styleIntent.captionStyleId
							: null,
					overlayStyleVariantId:
						memory.styleIntent.overlayStyleVariantId === "clean-vlog" ||
						memory.styleIntent.overlayStyleVariantId === "bold-social" ||
						memory.styleIntent.overlayStyleVariantId === "luxury" ||
						memory.styleIntent.overlayStyleVariantId === "minimal"
							? memory.styleIntent.overlayStyleVariantId
							: null,
					motionPresetId:
						memory.styleIntent.motionPresetId === "fade-up" ||
						memory.styleIntent.motionPresetId === "slide-up" ||
						memory.styleIntent.motionPresetId === "pop-in" ||
						memory.styleIntent.motionPresetId === "drift-in" ||
						memory.styleIntent.motionPresetId === "none"
							? memory.styleIntent.motionPresetId
							: null,
					finishingLookId:
						memory.styleIntent.finishingLookId === "clean" ||
						memory.styleIntent.finishingLookId === "warm" ||
						memory.styleIntent.finishingLookId === "cool" ||
						memory.styleIntent.finishingLookId === "dramatic" ||
						memory.styleIntent.finishingLookId === "mono" ||
						memory.styleIntent.finishingLookId === "vintage"
							? memory.styleIntent.finishingLookId
							: null,
					audioPolishPresetId:
						memory.styleIntent.audioPolishPresetId === "none" ||
						memory.styleIntent.audioPolishPresetId === "voice-forward" ||
						memory.styleIntent.audioPolishPresetId === "luxury-soft" ||
						memory.styleIntent.audioPolishPresetId === "bold-social" ||
						memory.styleIntent.audioPolishPresetId === "music-forward"
							? memory.styleIntent.audioPolishPresetId
							: null,
			  }
			: null,
		publishIntent:
			memory?.publishIntent && Array.isArray(memory.publishIntent.versionTargets)
				? {
						versionTargets: memory.publishIntent.versionTargets.filter(
							(target): target is import("@/types/project").ProjectVersionTarget =>
								target === "9:16" || target === "1:1" || target === "16:9",
						),
						activeTargetId:
							memory.publishIntent.activeTargetId === "9:16" ||
							memory.publishIntent.activeTargetId === "1:1" ||
							memory.publishIntent.activeTargetId === "16:9"
								? memory.publishIntent.activeTargetId
								: null,
				  }
				: null,
		finishIntent: memory?.finishIntent
			? {
					polishProfileId:
						memory.finishIntent.polishProfileId === "clean-vlog" ||
						memory.finishIntent.polishProfileId === "luxury-routine" ||
						memory.finishIntent.polishProfileId === "bold-social" ||
						memory.finishIntent.polishProfileId === "talking-head" ||
						memory.finishIntent.polishProfileId === "product-promo"
							? memory.finishIntent.polishProfileId
							: null,
					captionRevealPresetId:
						memory.finishIntent.captionRevealPresetId === "none" ||
						memory.finishIntent.captionRevealPresetId === "fade-line" ||
						memory.finishIntent.captionRevealPresetId === "pop-line" ||
						memory.finishIntent.captionRevealPresetId === "type-on-soft" ||
						memory.finishIntent.captionRevealPresetId === "type-on-bold" ||
						memory.finishIntent.captionRevealPresetId === "lift-in" ||
						memory.finishIntent.captionRevealPresetId === "luxury-rise"
							? memory.finishIntent.captionRevealPresetId
							: null,
					includeMusic:
						typeof memory.finishIntent.includeMusic === "boolean"
							? memory.finishIntent.includeMusic
							: null,
					includeSfx:
						typeof memory.finishIntent.includeSfx === "boolean"
							? memory.finishIntent.includeSfx
							: null,
					mood:
						memory.finishIntent.mood === "clean" ||
						memory.finishIntent.mood === "luxury" ||
						memory.finishIntent.mood === "upbeat" ||
						memory.finishIntent.mood === "energetic" ||
						memory.finishIntent.mood === "minimal"
							? memory.finishIntent.mood
							: null,
			  }
			: null,
		destinationIntent: memory?.destinationIntent
			? {
					publishDestination:
						memory.destinationIntent.publishDestination === "generic-export" ||
						memory.destinationIntent.publishDestination === "tiktok" ||
						memory.destinationIntent.publishDestination === "instagram" ||
						memory.destinationIntent.publishDestination === "youtube"
							? memory.destinationIntent.publishDestination
							: null,
			  }
			: null,
		recentTurnSummaries: Array.isArray(memory?.recentTurnSummaries)
			? memory.recentTurnSummaries
					.map((value) => normalizeTurnSummary(value))
					.filter((value): value is ClipForgeChatTurnSummary => value !== null)
					.slice(-MAX_CHAT_MEMORY_TURNS)
			: [],
		recentAppliedCommandSummaries: Array.isArray(memory?.recentAppliedCommandSummaries)
			? memory.recentAppliedCommandSummaries
					.map((value) => normalizeAppliedCommandSummary(value))
					.filter((value): value is ClipForgeAppliedCommandSummary => value !== null)
					.slice(-MAX_CHAT_MEMORY_APPLIED_COMMANDS)
			: [],
		recentAssetChoices: Array.isArray(memory?.recentAssetChoices)
			? memory.recentAssetChoices
					.map((value) => normalizeRecentAssetChoice(value))
					.filter((value): value is ClipForgeRecentAssetChoice => value !== null)
					.slice(-MAX_CHAT_MEMORY_ASSET_CHOICES)
			: [],
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
		sceneFootageIntelligenceBySceneId: Object.fromEntries(
			Object.entries(source.sceneFootageIntelligenceBySceneId ?? {}).map(
				([sceneId, report]) => [sceneId, normalizeFootageReport({ report })],
			),
		),
		trendSoundReferences: normalizeTrendSoundReferences({
			references: source.trendSoundReferences,
		}),
		chatMemory: normalizeChatMemory({
			memory: source.chatMemory,
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
