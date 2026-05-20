import type { ProjectVersionTarget } from "@/types/project";
import type { CreativeBrief, DraftBuildStep } from "@/types/clipforge";
import type { ThumbnailRecommendation } from "./thumbnail-optimizer";
import type { MusicSelectionResult } from "./music-auto-select";

export interface MultiVersionPlan {
	/** The primary version target (e.g. "9:16" for TikTok). */
	primaryTarget: ProjectVersionTarget;
	/** All version targets to generate. */
	allTargets: ProjectVersionTarget[];
	/** Additional draft steps to add for multi-version output. */
	additionalSteps: DraftBuildStep[];
	/** Warnings from planning. */
	warnings: string[];
}

export interface FullPipelineResult {
	/** Steps applied in the initial draft. */
	draftAppliedSteps: number;
	/** Steps skipped in the initial draft. */
	draftSkippedSteps: number;
	/** Number of version targets generated. */
	versionsGenerated: number;
	/** Music track that was auto-selected, if any. */
	musicSelection: MusicSelectionResult | null;
	/** Thumbnail recommendation, if available. */
	thumbnailRecommendation: ThumbnailRecommendation | null;
	/** Scene import analysis was performed. */
	sceneAnalysisPerformed: boolean;
	/** All messages from the pipeline. */
	messages: string[];
	/** All warnings from the pipeline. */
	warnings: string[];
}

/**
 * All supported version targets in priority order.
 */
const ALL_TARGETS: ProjectVersionTarget[] = ["9:16", "1:1", "16:9"];

/**
 * Default target per goal — what the primary version should be.
 */
const GOAL_TO_PRIMARY: Record<string, ProjectVersionTarget> = {
	"viral-tiktok": "9:16",
	vlog: "16:9",
	"luxury-routine": "9:16",
	"talking-head": "16:9",
	"product-highlight": "9:16",
};

/**
 * Plan multi-version output from a creative brief.
 *
 * If the brief already specifies version targets, those are used.
 * Otherwise, all three formats are generated with the goal-appropriate
 * primary target.
 */
export function planMultiVersionDraft({
	brief,
	enableAllFormats = true,
}: {
	brief: CreativeBrief;
	enableAllFormats?: boolean;
}): MultiVersionPlan {
	const warnings: string[] = [];

	const primaryTarget =
		brief.versionTargets[0] ?? GOAL_TO_PRIMARY[brief.goal] ?? "9:16";

	const allTargets = enableAllFormats
		? ALL_TARGETS
		: brief.versionTargets.length > 0
			? brief.versionTargets
			: [primaryTarget];

	const additionalSteps: DraftBuildStep[] = [];

	// Ensure version pack covers all targets
	additionalSteps.push({
		kind: "apply-version-pack",
		params: { targets: allTargets },
	});

	// Auto-reframe for non-primary targets
	const secondaryTargets = allTargets.filter((t) => t !== primaryTarget);
	if (secondaryTargets.length > 0) {
		additionalSteps.push({
			kind: "apply-safe-layout",
			params: { targetVersionIds: secondaryTargets },
		});
	}

	if (allTargets.length > 1) {
		warnings.push(
			`Multi-version output will generate ${allTargets.join(", ")} formats. The primary edit targets ${primaryTarget}.`,
		);
	}

	return {
		primaryTarget,
		allTargets,
		additionalSteps,
		warnings,
	};
}

/**
 * Build the additional draft steps needed to add music to the pipeline.
 */
export function buildMusicDraftSteps({
	musicSelection,
}: {
	musicSelection: MusicSelectionResult;
}): DraftBuildStep[] {
	return [
		{
			kind: "select-music" as DraftBuildStep["kind"],
			params: {
				musicAssetId: musicSelection.track.id,
				musicLabel: musicSelection.track.label,
				score: musicSelection.score,
				reasons: musicSelection.reasons,
			},
		},
	];
}

/**
 * Build a human-readable summary of the full pipeline result.
 */
export function buildPipelineSummary({
	result,
}: {
	result: FullPipelineResult;
}): string {
	const parts: string[] = [];

	parts.push(
		`Draft: ${result.draftAppliedSteps} steps applied` +
			(result.draftSkippedSteps > 0
				? `, ${result.draftSkippedSteps} skipped`
				: ""),
	);

	if (result.versionsGenerated > 1) {
		parts.push(`Versions: ${result.versionsGenerated} platform formats`);
	}

	if (result.musicSelection) {
		parts.push(`Music: "${result.musicSelection.track.label}"`);
	}

	if (result.thumbnailRecommendation) {
		const thumb = result.thumbnailRecommendation.primary;
		parts.push(`Thumbnail: ${thumb.timeS.toFixed(1)}s (score ${thumb.score.toFixed(1)})`);
	}

	if (result.sceneAnalysisPerformed) {
		parts.push("Scene analysis: completed");
	}

	return parts.join(" | ");
}
