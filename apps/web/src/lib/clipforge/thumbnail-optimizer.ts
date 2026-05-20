import type { MediaAsset } from "@/types/assets";
import type {
	FootageIntelligenceReport,
	FootageMomentScore,
	HookCandidate,
} from "@/types/clipforge";

export interface ThumbnailCandidate {
	/** Unique identifier for this candidate. */
	id: string;
	/** Time in seconds into the project timeline. */
	timeS: number;
	/** The element (clip) this frame comes from. */
	elementId: string;
	/** Track containing the element. */
	trackId: string;
	/** Overall thumbnail score. Higher = better. */
	score: number;
	/** Human-readable reasons this frame scored well. */
	reasons: string[];
}

export interface ThumbnailRecommendation {
	/** The top-ranked thumbnail candidate. */
	primary: ThumbnailCandidate;
	/** Up to 2 alternative candidates. */
	alternatives: ThumbnailCandidate[];
	/** Warnings encountered during selection. */
	warnings: string[];
}

// --- Scoring weights ---
const VISUAL_ACTIVITY_WEIGHT = 2.5;
const HOOK_BONUS = 1.8;
const EARLY_POSITION_WEIGHT = 1.2;
const SPEECH_DENSITY_WEIGHT = 0.8;
const SCENE_CUT_BONUS = 0.6;

/**
 * Score a footage moment as a potential thumbnail frame.
 *
 * Good thumbnails tend to:
 * 1. Have high visual activity (movement, color change)
 * 2. Occur near the "hook" — the strongest opener moment
 * 3. Be early in the video (first impression)
 * 4. Avoid silence/dead air (suggests low-energy content)
 * 5. Land on scene cuts (visually distinct frames)
 */
export function scoreThumbnailCandidate({
	moment,
	hookCandidateIds,
	totalDurationS,
}: {
	moment: FootageMomentScore;
	hookCandidateIds: Set<string>;
	totalDurationS: number;
}): ThumbnailCandidate {
	let score = 0;
	const reasons: string[] = [];

	// --- Visual activity ---
	const visualSignal = Math.min(1.5, moment.totalScore / 4);
	score += visualSignal * VISUAL_ACTIVITY_WEIGHT;
	if (visualSignal >= 1.0) {
		reasons.push("Strong visual activity makes this frame eye-catching.");
	} else if (visualSignal >= 0.5) {
		reasons.push("Moderate visual interest in this frame.");
	}

	// --- Hook alignment ---
	const isHookMoment = hookCandidateIds.has(moment.id) ||
		hookCandidateIds.has(`hook:${moment.id}`);
	if (isHookMoment) {
		score += HOOK_BONUS;
		reasons.push("This frame is from the strongest hook moment.");
	}

	// --- Early position bias ---
	const safeDuration = Math.max(1, totalDurationS);
	const positionRatio = moment.startTime / safeDuration;
	if (positionRatio <= 0.15) {
		score += EARLY_POSITION_WEIGHT;
		reasons.push("Early in the video — strong first impression.");
	} else if (positionRatio <= 0.35) {
		score += EARLY_POSITION_WEIGHT * 0.6;
		reasons.push("In the first third of the video.");
	} else if (positionRatio <= 0.5) {
		score += EARLY_POSITION_WEIGHT * 0.2;
	}

	// --- Speech density signal ---
	const hasSpeechSignal = moment.reasons.some(
		(r) => r.includes("Speech is dense") || r.includes("Speech is present"),
	);
	if (hasSpeechSignal) {
		score += SPEECH_DENSITY_WEIGHT;
		reasons.push("Active speech suggests an engaging moment.");
	}

	// --- Scene cut bonus ---
	const hasSceneCut = moment.reasons.some((r) => r.includes("scene change"));
	if (hasSceneCut) {
		score += SCENE_CUT_BONUS;
		reasons.push("Scene transition creates a visually distinct frame.");
	}

	return {
		id: `thumb:${moment.id}`,
		timeS: Number(
			((moment.startTime + moment.endTime) / 2).toFixed(3),
		),
		elementId: moment.elementId,
		trackId: moment.trackId,
		score: Number(score.toFixed(3)),
		reasons,
	};
}

/**
 * Select the best thumbnail from a footage intelligence report.
 *
 * Uses moment scores + hook candidates to find the most visually
 * compelling frame for a cover/thumbnail.
 */
export function selectBestThumbnail({
	footageReport,
	totalDurationS,
}: {
	footageReport: FootageIntelligenceReport;
	totalDurationS: number;
}): ThumbnailRecommendation | null {
	if (footageReport.momentScores.length === 0) {
		return null;
	}

	const hookCandidateIds = new Set(
		footageReport.hookCandidates.map((h) => h.id),
	);

	const candidates = footageReport.momentScores
		.map((moment) =>
			scoreThumbnailCandidate({
				moment,
				hookCandidateIds,
				totalDurationS,
			}),
		)
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.timeS - b.timeS;
		});

	const primary = candidates[0];
	if (!primary) {
		return null;
	}

	// Pick alternatives that are from different elements or at least 2s apart
	const alternatives: ThumbnailCandidate[] = [];
	for (const candidate of candidates.slice(1)) {
		if (alternatives.length >= 2) break;
		const tooClose = [primary, ...alternatives].some(
			(existing) =>
				existing.elementId === candidate.elementId &&
				Math.abs(existing.timeS - candidate.timeS) < 2,
		);
		if (!tooClose) {
			alternatives.push(candidate);
		}
	}

	const warnings: string[] = [];
	if (primary.score < 2) {
		warnings.push(
			"No strongly compelling thumbnail frame was found; consider adding more visually dynamic footage.",
		);
	}
	if (footageReport.hookCandidates.length === 0) {
		warnings.push(
			"No hook candidates were identified, so thumbnail selection relied on general visual scoring.",
		);
	}

	return {
		primary,
		alternatives,
		warnings,
	};
}

/**
 * Quick thumbnail pick when only hook candidates are available
 * (no full moment scores). Uses the top hook candidate's midpoint.
 */
export function thumbnailFromHookCandidate({
	hookCandidate,
}: {
	hookCandidate: HookCandidate;
}): ThumbnailCandidate {
	return {
		id: `thumb:hook:${hookCandidate.id}`,
		timeS: Number(
			((hookCandidate.startTime + hookCandidate.endTime) / 2).toFixed(3),
		),
		elementId: hookCandidate.elementId,
		trackId: hookCandidate.trackId,
		score: hookCandidate.score * 0.8,
		reasons: [
			"Selected from the strongest hook moment.",
			...hookCandidate.reasons.slice(0, 2),
		],
	};
}
