import type {
	CaptionStyleTemplate,
	ClipForgeAppliedCommandSummary,
	ClipForgeRecentAssetChoice,
	ClipForgeRecentReferenceAssemblyChoice,
	ClipForgeChatMemory,
	ClipForgeChatTurnSummary,
	ClipForgeProjectData,
	ClipMediaMetadata,
	FootageDescriptor,
	ReferenceVideoAnalysis,
	ReferenceMatchLock,
	ReferenceShotPlan,
} from "@/types/clipforge";
import type { TProject } from "@/types/project";
import { adoptLegacyCaptionTracks } from "./caption-studio";
import { BUILT_IN_CAPTION_STYLE_MAP } from "./caption-style-library";

export const CLIPFORGE_SCHEMA_VERSION = 8;

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
		activeReferenceVideoAssetId: null,
		referenceAnalysisByAssetId: {},
		assemblySourceAssetIds: [],
		footageDescriptorsByAssetId: {},
		referenceShotPlanByAssetId: {},
		referenceMatchLocks: {},
		chatMemory: {
			activeTargets: [],
			styleIntent: null,
			publishIntent: null,
			finishIntent: null,
			destinationIntent: null,
			referenceIntent: null,
			assemblyIntent: null,
			lockedMatchIds: [],
			recentTurnSummaries: [],
			recentAppliedCommandSummaries: [],
			recentAssetChoices: [],
			recentReferenceComparisons: [],
			recentReferenceAssemblyChoices: [],
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
			assetKind !== "trend-reference" &&
			assetKind !== "source-video") ||
		(commandKind !== "apply-music-track" &&
			commandKind !== "replace-music-track" &&
			commandKind !== "insert-sfx-preset" &&
			commandKind !== "apply-project-kit" &&
			commandKind !== "build-reference-draft" &&
			commandKind !== "replace-with-source-match")
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

function normalizeRecentReferenceAssemblyChoice(
	value: unknown,
): ClipForgeRecentReferenceAssemblyChoice | null {
	if (
		typeof value !== "object" ||
		value === null ||
		typeof (value as { matchId?: unknown }).matchId !== "string" ||
		typeof (value as { sectionLabel?: unknown }).sectionLabel !== "string" ||
		typeof (value as { sectionRole?: unknown }).sectionRole !== "string" ||
		typeof (value as { segmentId?: unknown }).segmentId !== "string" ||
		typeof (value as { assetId?: unknown }).assetId !== "string" ||
		typeof (value as { assetLabel?: unknown }).assetLabel !== "string" ||
		typeof (value as { createdAt?: unknown }).createdAt !== "string"
	) {
		return null;
	}

	const sectionRole = (value as { sectionRole: string }).sectionRole;
	if (
		sectionRole !== "hook" &&
		sectionRole !== "body" &&
		sectionRole !== "payoff" &&
		sectionRole !== "cta"
	) {
		return null;
	}

	return {
		matchId: (value as { matchId: string }).matchId,
		sectionLabel: (value as { sectionLabel: string }).sectionLabel,
		sectionRole,
		segmentId: (value as { segmentId: string }).segmentId,
		assetId: (value as { assetId: string }).assetId,
		assetLabel: (value as { assetLabel: string }).assetLabel,
		alternativeAssetIds: Array.isArray(
			(value as { alternativeAssetIds?: unknown }).alternativeAssetIds,
		)
			? ((value as { alternativeAssetIds: unknown[] }).alternativeAssetIds as unknown[]).filter(
					(assetId): assetId is string => typeof assetId === "string",
			  )
			: [],
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
		referenceIntent: memory?.referenceIntent
			? {
					referenceAssetId:
						typeof memory.referenceIntent.referenceAssetId === "string"
							? memory.referenceIntent.referenceAssetId
							: null,
					referenceMode:
						memory.referenceIntent.referenceMode === "exact-recreation"
							? memory.referenceIntent.referenceMode
							: null,
			  }
			: null,
		assemblyIntent:
			memory?.assemblyIntent && Array.isArray(memory.assemblyIntent.sourceAssetIds)
				? {
						referenceAssetId:
							typeof memory.assemblyIntent.referenceAssetId === "string"
								? memory.assemblyIntent.referenceAssetId
								: null,
						sourceAssetIds: memory.assemblyIntent.sourceAssetIds.filter(
							(assetId): assetId is string => typeof assetId === "string",
						),
						focusMatchIds: Array.isArray(memory.assemblyIntent.focusMatchIds)
							? memory.assemblyIntent.focusMatchIds.filter(
									(matchId): matchId is string => typeof matchId === "string",
							  )
							: [],
				  }
				: null,
		lockedMatchIds: Array.isArray(memory?.lockedMatchIds)
			? memory.lockedMatchIds.filter(
					(matchId): matchId is string => typeof matchId === "string",
			  )
			: [],
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
		recentReferenceComparisons: Array.isArray(memory?.recentReferenceComparisons)
			? memory.recentReferenceComparisons
					.filter((value): value is string => typeof value === "string")
					.slice(-MAX_CHAT_MEMORY_TURNS)
			: [],
		recentReferenceAssemblyChoices: Array.isArray(memory?.recentReferenceAssemblyChoices)
			? memory.recentReferenceAssemblyChoices
					.map((value) => normalizeRecentReferenceAssemblyChoice(value))
					.filter(
						(
							value,
						): value is ClipForgeRecentReferenceAssemblyChoice => value !== null,
					)
					.slice(-MAX_CHAT_MEMORY_TURNS)
			: [],
	};
}

function normalizeFootageDescriptor(value: unknown): FootageDescriptor | null {
	if (
		typeof value !== "object" ||
		value === null ||
		typeof (value as { analyzedAt?: unknown }).analyzedAt !== "string" ||
		typeof (value as { asset_id?: unknown }).asset_id !== "string" ||
		typeof (value as { asset_name?: unknown }).asset_name !== "string" ||
		typeof (value as { duration_ms?: unknown }).duration_ms !== "number"
	) {
		return null;
	}

	const aspectRatio = (value as { aspect_ratio?: unknown }).aspect_ratio;
	const activityIntensity = (value as { activity_intensity?: unknown }).activity_intensity;
	const candidateRanges = Array.isArray(
		(value as { candidate_ranges?: unknown }).candidate_ranges,
	)
		? ((value as { candidate_ranges: unknown[] }).candidate_ranges as unknown[])
				.map((range) => {
					if (
						typeof range !== "object" ||
						range === null ||
						typeof (range as { range_id?: unknown }).range_id !== "string" ||
						typeof (range as { label?: unknown }).label !== "string" ||
						typeof (range as { start_ms?: unknown }).start_ms !== "number" ||
						typeof (range as { end_ms?: unknown }).end_ms !== "number" ||
						typeof (range as { hook_score?: unknown }).hook_score !== "number" ||
						typeof (range as { activity_score?: unknown }).activity_score !== "number" ||
						typeof (range as { semantic_summary?: unknown }).semantic_summary !== "string"
					) {
						return null;
					}
					return {
						range_id: (range as { range_id: string }).range_id,
						label: (range as { label: string }).label,
						start_ms: (range as { start_ms: number }).start_ms,
						end_ms: (range as { end_ms: number }).end_ms,
						hook_score: (range as { hook_score: number }).hook_score,
						activity_score: (range as { activity_score: number }).activity_score,
						transcript_cues: Array.isArray(
							(range as { transcript_cues?: unknown }).transcript_cues,
						)
							? (
									(range as { transcript_cues: unknown[] }).transcript_cues as unknown[]
							  ).filter((cue): cue is string => typeof cue === "string")
							: [],
						semantic_summary: (range as { semantic_summary: string }).semantic_summary,
					};
				})
				.filter(
					(
						range,
					): range is FootageDescriptor["candidate_ranges"][number] => range !== null,
				)
		: [];

	return {
		analyzedAt: (value as { analyzedAt: string }).analyzedAt,
		asset_id: (value as { asset_id: string }).asset_id,
		asset_name: (value as { asset_name: string }).asset_name,
		duration_ms: (value as { duration_ms: number }).duration_ms,
		aspect_ratio:
			aspectRatio === "9:16" ||
			aspectRatio === "1:1" ||
			aspectRatio === "16:9" ||
			aspectRatio === "unknown"
				? aspectRatio
				: "unknown",
		scene_cut_count:
			typeof (value as { scene_cut_count?: unknown }).scene_cut_count === "number"
				? (value as { scene_cut_count: number }).scene_cut_count
				: 0,
		activity_intensity:
			activityIntensity === "low" ||
			activityIntensity === "medium" ||
			activityIntensity === "high"
				? activityIntensity
				: "medium",
		beat_bpm:
			typeof (value as { beat_bpm?: unknown }).beat_bpm === "number"
				? (value as { beat_bpm: number }).beat_bpm
				: null,
		hook_score:
			typeof (value as { hook_score?: unknown }).hook_score === "number"
				? (value as { hook_score: number }).hook_score
				: 0,
		transcript_cues: Array.isArray((value as { transcript_cues?: unknown }).transcript_cues)
			? ((value as { transcript_cues: unknown[] }).transcript_cues as unknown[]).filter(
					(cue): cue is string => typeof cue === "string",
			  )
			: [],
		semantic_summary:
			typeof (value as { semantic_summary?: unknown }).semantic_summary === "string"
				? (value as { semantic_summary: string }).semantic_summary
				: "",
		candidate_ranges: candidateRanges,
		warnings: Array.isArray((value as { warnings?: unknown }).warnings)
			? ((value as { warnings: unknown[] }).warnings as unknown[]).filter(
					(warning): warning is string => typeof warning === "string",
			  )
			: [],
	};
}

function normalizeReferenceShotPlan(value: unknown): ReferenceShotPlan | null {
	if (
		typeof value !== "object" ||
		value === null ||
		typeof (value as { analyzedAt?: unknown }).analyzedAt !== "string" ||
		typeof (value as { reference_asset_id?: unknown }).reference_asset_id !== "string"
	) {
		return null;
	}

	const sections = Array.isArray((value as { sections?: unknown }).sections)
		? ((value as { sections: unknown[] }).sections as unknown[])
				.map((section) => {
					if (
						typeof section !== "object" ||
						section === null ||
						typeof (section as { match_id?: unknown }).match_id !== "string" ||
						typeof (section as { label?: unknown }).label !== "string" ||
						typeof (section as { target_start_ms?: unknown }).target_start_ms !== "number" ||
						typeof (section as { target_duration_ms?: unknown }).target_duration_ms !==
							"number" ||
						typeof (section as { description?: unknown }).description !== "string"
					) {
						return null;
					}
					const role = (section as { role?: unknown }).role;
					const shotCadence = (section as { shot_cadence?: unknown }).shot_cadence;
					const desiredEnergy = (section as { desired_energy?: unknown }).desired_energy;
					if (
						(role !== "hook" &&
							role !== "body" &&
							role !== "payoff" &&
							role !== "cta") ||
						(shotCadence !== "slow" &&
							shotCadence !== "medium" &&
							shotCadence !== "fast") ||
						(desiredEnergy !== "low" &&
							desiredEnergy !== "medium" &&
							desiredEnergy !== "high")
					) {
						return null;
					}
					return {
						match_id: (section as { match_id: string }).match_id,
						label: (section as { label: string }).label,
						role,
						target_start_ms: (section as { target_start_ms: number }).target_start_ms,
						target_duration_ms: (section as { target_duration_ms: number }).target_duration_ms,
						shot_cadence: shotCadence,
						desired_energy: desiredEnergy,
						overlay_moment:
							typeof (section as { overlay_moment?: unknown }).overlay_moment === "boolean"
								? (section as { overlay_moment: boolean }).overlay_moment
								: false,
						caption_moment:
							typeof (section as { caption_moment?: unknown }).caption_moment === "boolean"
								? (section as { caption_moment: boolean }).caption_moment
								: false,
						description: (section as { description: string }).description,
					};
				})
				.filter(
					(
						section,
					): section is ReferenceShotPlan["sections"][number] => section !== null,
				)
		: [];

	const endingShape = (value as { ending_shape?: unknown }).ending_shape;
	return {
		analyzedAt: (value as { analyzedAt: string }).analyzedAt,
		reference_asset_id: (value as { reference_asset_id: string }).reference_asset_id,
		hook_pattern:
			typeof (value as { hook_pattern?: unknown }).hook_pattern === "string"
				? (value as { hook_pattern: string }).hook_pattern
				: "front-loaded hook",
		ending_shape:
			endingShape === "payoff" || endingShape === "cta" || endingShape === "open-ended"
				? endingShape
				: "payoff",
		sections,
		warnings: Array.isArray((value as { warnings?: unknown }).warnings)
			? ((value as { warnings: unknown[] }).warnings as unknown[]).filter(
					(warning): warning is string => typeof warning === "string",
			  )
			: [],
	};
}

function normalizeReferenceMatchLock(value: unknown): ReferenceMatchLock | null {
	if (
		typeof value !== "object" ||
		value === null ||
		typeof (value as { match_id?: unknown }).match_id !== "string" ||
		typeof (value as { asset_id?: unknown }).asset_id !== "string" ||
		typeof (value as { asset_name?: unknown }).asset_name !== "string" ||
		typeof (value as { locked_at?: unknown }).locked_at !== "string"
	) {
		return null;
	}

	return {
		match_id: (value as { match_id: string }).match_id,
		asset_id: (value as { asset_id: string }).asset_id,
		asset_name: (value as { asset_name: string }).asset_name,
		locked_at: (value as { locked_at: string }).locked_at,
	};
}

function normalizeReferenceVideoAnalysis(
	value: unknown,
): ReferenceVideoAnalysis | null {
	if (
		typeof value !== "object" ||
		value === null ||
		typeof (value as { analyzedAt?: unknown }).analyzedAt !== "string"
	) {
		return null;
	}

	const status = (value as { status?: unknown }).status;
	if (
		status !== "idle" &&
		status !== "ready" &&
		status !== "stale" &&
		status !== "missing" &&
		status !== "error"
	) {
		return null;
	}

	const sectionPlan = Array.isArray((value as { sectionPlan?: unknown }).sectionPlan)
		? ((value as { sectionPlan?: unknown }).sectionPlan as unknown[])
				.map((entry) => {
					if (
						typeof entry !== "object" ||
						entry === null ||
						typeof (entry as { label?: unknown }).label !== "string" ||
						typeof (entry as { start_ms?: unknown }).start_ms !== "number" ||
						typeof (entry as { end_ms?: unknown }).end_ms !== "number" ||
						((entry as { role?: unknown }).role !== "hook" &&
							(entry as { role?: unknown }).role !== "body" &&
							(entry as { role?: unknown }).role !== "payoff")
					) {
						return null;
					}
					return {
						label: (entry as { label: string }).label,
						start_ms: (entry as { start_ms: number }).start_ms,
						end_ms: (entry as { end_ms: number }).end_ms,
						role: (entry as {
							role: "hook" | "body" | "payoff";
						}).role,
					};
				})
				.filter(
					(
						entry,
					): entry is ReferenceVideoAnalysis["sectionPlan"][number] => entry !== null,
				)
		: [];

	const shotPatternSource = (value as { shotPattern?: unknown }).shotPattern;
	const captionProfileSource = (value as { captionProfile?: unknown }).captionProfile;
	const audioProfileSource = (value as { audioProfile?: unknown }).audioProfile;
	const overlayProfileSource = (value as { overlayProfile?: unknown }).overlayProfile;
	const finishingProfileSource =
		(value as { finishingProfile?: unknown }).finishingProfile;
	const publishProfileSource = (value as { publishProfile?: unknown }).publishProfile;

	return {
		analyzedAt: (value as { analyzedAt: string }).analyzedAt,
		status,
		sectionPlan,
		shotPattern: {
			average_shot_ms:
				typeof (shotPatternSource as { average_shot_ms?: unknown })?.average_shot_ms ===
				"number"
					? ((shotPatternSource as { average_shot_ms: number }).average_shot_ms ?? null)
					: null,
			transition_cadence:
				(shotPatternSource as { transition_cadence?: unknown })?.transition_cadence ===
					"slow" ||
				(shotPatternSource as { transition_cadence?: unknown })?.transition_cadence ===
					"medium" ||
				(shotPatternSource as { transition_cadence?: unknown })?.transition_cadence ===
					"fast"
					? (shotPatternSource as {
							transition_cadence: "slow" | "medium" | "fast";
					  }).transition_cadence
					: "medium",
			scene_cut_count:
				typeof (shotPatternSource as { scene_cut_count?: unknown })?.scene_cut_count ===
				"number"
					? (shotPatternSource as { scene_cut_count: number }).scene_cut_count
					: 0,
			activity_intensity:
				(shotPatternSource as { activity_intensity?: unknown })?.activity_intensity ===
					"low" ||
				(shotPatternSource as { activity_intensity?: unknown })?.activity_intensity ===
					"medium" ||
				(shotPatternSource as { activity_intensity?: unknown })?.activity_intensity ===
					"high"
					? (shotPatternSource as {
							activity_intensity: "low" | "medium" | "high";
					  }).activity_intensity
					: "medium",
		},
		captionProfile: {
			presence:
				(captionProfileSource as { presence?: unknown })?.presence === "none" ||
				(captionProfileSource as { presence?: unknown })?.presence === "light" ||
				(captionProfileSource as { presence?: unknown })?.presence === "heavy"
					? (captionProfileSource as { presence: "none" | "light" | "heavy" }).presence
					: "none",
			reveal_preset_id:
				typeof (captionProfileSource as { reveal_preset_id?: unknown })?.reveal_preset_id ===
				"string"
					? (captionProfileSource as { reveal_preset_id: ReferenceVideoAnalysis["captionProfile"]["reveal_preset_id"] }).reveal_preset_id
					: null,
			tone:
				(captionProfileSource as { tone?: unknown })?.tone === "soft" ||
				(captionProfileSource as { tone?: unknown })?.tone === "clean" ||
				(captionProfileSource as { tone?: unknown })?.tone === "bold" ||
				(captionProfileSource as { tone?: unknown })?.tone === "luxury"
					? (captionProfileSource as {
							tone: "soft" | "clean" | "bold" | "luxury";
					  }).tone
					: null,
			average_words_per_segment:
				typeof (captionProfileSource as { average_words_per_segment?: unknown })
					?.average_words_per_segment === "number"
					? (captionProfileSource as { average_words_per_segment: number })
							.average_words_per_segment
					: null,
		},
		audioProfile: {
			music_mood:
				(audioProfileSource as { music_mood?: unknown })?.music_mood === "clean" ||
				(audioProfileSource as { music_mood?: unknown })?.music_mood === "luxury" ||
				(audioProfileSource as { music_mood?: unknown })?.music_mood === "upbeat" ||
				(audioProfileSource as { music_mood?: unknown })?.music_mood === "energetic" ||
				(audioProfileSource as { music_mood?: unknown })?.music_mood === "minimal"
					? (audioProfileSource as {
							music_mood:
								| "clean"
								| "luxury"
								| "upbeat"
								| "energetic"
								| "minimal";
					  }).music_mood
					: null,
			recommended_music_asset_id:
				typeof (audioProfileSource as { recommended_music_asset_id?: unknown })
					?.recommended_music_asset_id === "string"
					? (audioProfileSource as { recommended_music_asset_id: string })
							.recommended_music_asset_id
					: null,
			recommended_sfx_asset_id:
				typeof (audioProfileSource as { recommended_sfx_asset_id?: unknown })
					?.recommended_sfx_asset_id === "string"
					? (audioProfileSource as { recommended_sfx_asset_id: string })
							.recommended_sfx_asset_id
					: null,
			bpm:
				typeof (audioProfileSource as { bpm?: unknown })?.bpm === "number"
					? (audioProfileSource as { bpm: number }).bpm
					: null,
			energy:
				(audioProfileSource as { energy?: unknown })?.energy === "low" ||
				(audioProfileSource as { energy?: unknown })?.energy === "medium" ||
				(audioProfileSource as { energy?: unknown })?.energy === "high"
					? (audioProfileSource as { energy: "low" | "medium" | "high" }).energy
					: "medium",
		},
		overlayProfile: {
			density:
				(overlayProfileSource as { density?: unknown })?.density === "none" ||
				(overlayProfileSource as { density?: unknown })?.density === "light" ||
				(overlayProfileSource as { density?: unknown })?.density === "heavy"
					? (overlayProfileSource as { density: "none" | "light" | "heavy" }).density
					: "none",
			variant_id:
				typeof (overlayProfileSource as { variant_id?: unknown })?.variant_id === "string"
					? (overlayProfileSource as {
							variant_id: ReferenceVideoAnalysis["overlayProfile"]["variant_id"];
					  }).variant_id
					: null,
			motion_preset_id:
				typeof (overlayProfileSource as { motion_preset_id?: unknown })
					?.motion_preset_id === "string"
					? (overlayProfileSource as {
							motion_preset_id: ReferenceVideoAnalysis["overlayProfile"]["motion_preset_id"];
					  }).motion_preset_id
					: null,
		},
		finishingProfile: {
			polish_profile_id:
				typeof (finishingProfileSource as { polish_profile_id?: unknown })
					?.polish_profile_id === "string"
					? (finishingProfileSource as {
							polish_profile_id: ReferenceVideoAnalysis["finishingProfile"]["polish_profile_id"];
					  }).polish_profile_id
					: null,
			finishing_look_id:
				typeof (finishingProfileSource as { finishing_look_id?: unknown })
					?.finishing_look_id === "string"
					? (finishingProfileSource as {
							finishing_look_id: ReferenceVideoAnalysis["finishingProfile"]["finishing_look_id"];
					  }).finishing_look_id
					: null,
		},
		publishProfile: {
			publish_destination:
				(publishProfileSource as { publish_destination?: unknown })?.publish_destination ===
					"generic-export" ||
				(publishProfileSource as { publish_destination?: unknown })?.publish_destination ===
					"tiktok" ||
				(publishProfileSource as { publish_destination?: unknown })?.publish_destination ===
					"instagram" ||
				(publishProfileSource as { publish_destination?: unknown })?.publish_destination ===
					"youtube"
					? (publishProfileSource as {
							publish_destination:
								| "generic-export"
								| "tiktok"
								| "instagram"
								| "youtube";
					  }).publish_destination
					: null,
			target_version_id:
				(publishProfileSource as { target_version_id?: unknown })?.target_version_id ===
					"9:16" ||
				(publishProfileSource as { target_version_id?: unknown })?.target_version_id ===
					"1:1" ||
				(publishProfileSource as { target_version_id?: unknown })?.target_version_id ===
					"16:9"
					? (publishProfileSource as {
							target_version_id: "9:16" | "1:1" | "16:9";
					  }).target_version_id
					: null,
			packaging_hint:
				typeof (publishProfileSource as { packaging_hint?: unknown })?.packaging_hint ===
				"string"
					? (publishProfileSource as { packaging_hint: string }).packaging_hint
					: "Reference packaging remains adaptable.",
			hook_pattern:
				typeof (publishProfileSource as { hook_pattern?: unknown })?.hook_pattern ===
				"string"
					? (publishProfileSource as { hook_pattern: string }).hook_pattern
					: "front-loaded hook",
		},
		warnings: Array.isArray((value as { warnings?: unknown }).warnings)
			? ((value as { warnings?: unknown }).warnings as unknown[]).filter(
					(warning): warning is string => typeof warning === "string",
			  )
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
		activeReferenceVideoAssetId:
			typeof source.activeReferenceVideoAssetId === "string"
				? source.activeReferenceVideoAssetId
				: null,
		referenceAnalysisByAssetId: Object.fromEntries(
			Object.entries(source.referenceAnalysisByAssetId ?? {}).flatMap(
				([assetId, analysis]) => {
					const normalized = normalizeReferenceVideoAnalysis(analysis);
					return normalized ? [[assetId, normalized]] : [];
				},
			),
		),
		assemblySourceAssetIds: Array.isArray(source.assemblySourceAssetIds)
			? source.assemblySourceAssetIds.filter(
					(assetId): assetId is string => typeof assetId === "string",
			  )
			: [],
		footageDescriptorsByAssetId: Object.fromEntries(
			Object.entries(source.footageDescriptorsByAssetId ?? {}).flatMap(
				([assetId, descriptor]) => {
					const normalized = normalizeFootageDescriptor(descriptor);
					return normalized ? [[assetId, normalized]] : [];
				},
			),
		),
		referenceShotPlanByAssetId: Object.fromEntries(
			Object.entries(source.referenceShotPlanByAssetId ?? {}).flatMap(
				([assetId, plan]) => {
					const normalized = normalizeReferenceShotPlan(plan);
					return normalized ? [[assetId, normalized]] : [];
				},
			),
		),
		referenceMatchLocks: Object.fromEntries(
			Object.entries(source.referenceMatchLocks ?? {}).flatMap(([matchId, lock]) => {
				const normalized = normalizeReferenceMatchLock(lock);
				return normalized ? [[matchId, normalized]] : [];
			}),
		),
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
