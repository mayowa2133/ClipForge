import type {
	CreativeBrief,
	FootageIntelligenceReport,
	RetentionBeat,
	RetentionShapePlan,
	RetentionShapeStep,
} from "@/types/clipforge";
import type { TProject } from "@/types/project";

const MIN_HOOK_DURATION_S = 1.5;
const MAX_HOOK_DURATION_S = 3;
const DEFAULT_CTA_DURATION_S = 2.2;

export function buildRetentionShapePlan({
	brief,
	footageReport,
	project,
	beatMarkerCount = 0,
}: {
	brief: CreativeBrief;
	footageReport?: FootageIntelligenceReport | null;
	project: TProject | null;
	beatMarkerCount?: number;
}): RetentionShapePlan {
	const generatedAt = new Date().toISOString();
	const sceneDuration = resolveSceneDuration({ project });
	const targetDuration = Math.max(10, brief.durationTargetS ?? sceneDuration ?? 24);
	const hasBeatPacing = beatMarkerCount > 0;
	const ctaImplied = isCtaImplied({ brief });

	if (!footageReport) {
		return {
			generatedAt,
			beats: buildFallbackBeats({
				targetDuration,
				brief,
				ctaImplied,
				hasBeatPacing,
			}),
			steps: [],
			warnings: [
				"Retention shaping is unavailable, so structure falls back to clip order and basic duration tightening.",
			],
			hookCandidateId: null,
			payoffMomentIds: [],
		};
	}

	const hookCandidate = footageReport.hookCandidates[0] ?? null;
	const hookDuration = hookCandidate
		? clamp(
				hookCandidate.endTime - hookCandidate.startTime,
				MIN_HOOK_DURATION_S,
				MAX_HOOK_DURATION_S,
		  )
		: clamp(targetDuration * 0.12, 1.8, 2.5);
	const earlyWindowEnd = Math.max(3.5, hookDuration + 1.5);
	const ctaDuration = ctaImplied ? Math.min(DEFAULT_CTA_DURATION_S, targetDuration * 0.16) : 0;
	const laterHalfThreshold = Math.max(targetDuration * 0.48, hookDuration + 2);
	const payoffCandidate =
		footageReport.momentScores.find((moment) => {
			if (hookCandidate && moment.id === hookCandidate.id) {
				return false;
			}
			return (
				moment.startTime >= laterHalfThreshold &&
				moment.endTime > moment.startTime + 0.4
			);
		}) ?? null;

	const payoffDuration = payoffCandidate
		? clamp(payoffCandidate.endTime - payoffCandidate.startTime, 2.2, 4.2)
		: clamp(targetDuration * 0.16, 2.2, 3.5);
	const payoffStart = payoffCandidate
		? payoffCandidate.startTime
		: clamp(targetDuration - ctaDuration - payoffDuration - 0.6, hookDuration + 2.5, targetDuration - payoffDuration - ctaDuration);
	const setupEnd = clamp(
		Math.min(payoffStart - 0.8, Math.max(earlyWindowEnd, targetDuration * 0.28)),
		hookDuration,
		Math.max(hookDuration, payoffStart - 0.8),
	);
	const bodyEnd = Math.max(setupEnd, payoffStart);

	const beats: RetentionBeat[] = [
		{
			kind: "hook",
			label: "Hook",
			startTime: 0,
			endTime: hookDuration,
			strategy: resolveHookStrategy({ brief, hasBeatPacing }),
			reasons: hookCandidate
				? [
						`Promote ${formatSpan(hookCandidate.startTime, hookCandidate.endTime)} as the opener.`,
						...hookCandidate.reasons.slice(0, 2),
				  ]
				: ["No scored opener was available, so the hook falls back to scene order."],
		},
		{
			kind: "setup",
			label: "Setup",
			startTime: hookDuration,
			endTime: setupEnd,
			strategy: brief.goal === "talking-head" ? "talking" : "caption-led",
			reasons: [
				"Keep only the minimum context needed after the opener.",
				"Delay explanation until after the first hook beat.",
			],
		},
		{
			kind: "body",
			label: "Body",
			startTime: setupEnd,
			endTime: bodyEnd,
			strategy: brief.goal === "talking-head" ? "caption-led" : hasBeatPacing ? "montage" : "broll",
			reasons: [
				"Use the middle stretch for proof, variation, and rhythm.",
				hasBeatPacing
					? "Music pacing is available, so the body can carry montage energy."
					: "Without active beat markers, keep body pacing simpler and information-dense.",
			],
		},
		{
			kind: "payoff",
			label: "Payoff",
			startTime: payoffStart,
			endTime: Math.min(targetDuration - ctaDuration, payoffStart + payoffDuration),
			strategy: brief.goal === "product-highlight" ? "overlay-led" : "caption-led",
			reasons: payoffCandidate
				? [
						`Reserve ${formatSpan(payoffCandidate.startTime, payoffCandidate.endTime)} as the payoff beat.`,
						...payoffCandidate.reasons.slice(0, 2),
				  ]
				: ["Reserve a later reveal so the opener and payoff stay meaningfully distinct."],
		},
	];

	if (ctaImplied) {
		beats.push({
			kind: "cta",
			label: "CTA",
			startTime: Math.max(0, targetDuration - ctaDuration),
			endTime: targetDuration,
			strategy: "overlay-led",
			reasons: [
				"The brief or creator defaults imply a closing CTA.",
				"Reserve the ending beat so the CTA does not interrupt the payoff.",
			],
		});
	}

	const earlyRecommendations = footageReport.keepCutRecommendations.filter(
		(recommendation) =>
			recommendation.action !== "keep" &&
			recommendation.startTime < earlyWindowEnd,
	);
	const bodyRecommendations = footageReport.keepCutRecommendations.filter(
		(recommendation) =>
			recommendation.action !== "keep" &&
			recommendation.startTime >= earlyWindowEnd &&
			recommendation.startTime < payoffStart,
	);
	const steps: RetentionShapeStep[] = [];

	if (hookCandidate && hookCandidate.startTime > 0.15) {
		steps.push({
			kind: "promote-hook",
			params: { candidateId: hookCandidate.id },
			reasons: [
				"Open on the highest-ranked early moment instead of preserving the current clip order.",
				...hookCandidate.reasons.slice(0, 1),
			],
		});
	}

	if (earlyRecommendations.length > 0) {
		steps.push({
			kind: "trim-setup",
			params: {
				recommendationIds: earlyRecommendations.map((recommendation) => recommendation.id),
			},
			reasons: [
				"Compress weak setup before trimming stronger body moments.",
				...uniqueReasons(earlyRecommendations.flatMap((recommendation) => recommendation.reasons)).slice(0, 2),
			],
		});
		steps.push({
			kind: "delay-context",
			params: {
				recommendationIds: earlyRecommendations.map((recommendation) => recommendation.id),
			},
			reasons: [
				"Delay context-heavy or low-signal spans until after the hook lands.",
				"Reduce slow explanation in the first three seconds.",
			],
		});
	}

	if (bodyRecommendations.length > 0 && targetDuration < sceneDuration) {
		steps.push({
			kind: "compress-body",
			params: {
				recommendationIds: bodyRecommendations.map((recommendation) => recommendation.id),
			},
			reasons: [
				"Preserve the strongest middle moments while tightening low-signal spans.",
				...uniqueReasons(bodyRecommendations.flatMap((recommendation) => recommendation.reasons)).slice(0, 2),
			],
		});
	}

	if (payoffCandidate) {
		steps.push({
			kind: "insert-payoff",
			params: { momentIds: [payoffCandidate.id] },
			reasons: [
				"Anchor overlays and reveal timing around the strongest later payoff beat.",
				...payoffCandidate.reasons.slice(0, 1),
			],
		});
	}

	if (ctaImplied) {
		steps.push({
			kind: "reserve-cta",
			params: {
				startTime: Math.max(0, targetDuration - ctaDuration),
				duration: ctaDuration,
			},
			reasons: [
				"The brief implies a CTA, so preserve the ending beat for it.",
			],
		});
	}

	const warnings = [...footageReport.warnings];
	if (!hookCandidate) {
		pushUniqueRetentionWarning({
			warnings,
			warning: "No strong opener candidate was available, so the hook follows clip order.",
			pattern: /\b(opener|hook)\b/i,
		});
	}
	if (!payoffCandidate) {
		pushUniqueRetentionWarning({
			warnings,
			warning: "No distinct payoff beat was found, so the later structure stays conservative.",
			pattern: /\bpayoff\b/i,
		});
	}

	return {
		generatedAt,
		beats,
		steps,
		warnings,
		hookCandidateId: hookCandidate?.id ?? null,
		payoffMomentIds: payoffCandidate ? [payoffCandidate.id] : [],
	};
}

function buildFallbackBeats({
	targetDuration,
	brief,
	ctaImplied,
	hasBeatPacing,
}: {
	targetDuration: number;
	brief: CreativeBrief;
	ctaImplied: boolean;
	hasBeatPacing: boolean;
}): RetentionBeat[] {
	const hook = clamp(targetDuration * 0.12, 1.8, 2.5);
	const cta = ctaImplied ? Math.min(DEFAULT_CTA_DURATION_S, targetDuration * 0.16) : 0;
	const payoff = clamp(targetDuration * 0.16, 2.2, 3.5);
	const payoffStart = Math.max(hook + 3, targetDuration - payoff - cta);
	const setupEnd = Math.max(hook + 1.4, Math.min(payoffStart - 0.8, targetDuration * 0.28));
	const beats: RetentionBeat[] = [
		{
			kind: "hook",
			label: "Hook",
			startTime: 0,
			endTime: hook,
			strategy: resolveHookStrategy({ brief, hasBeatPacing }),
			reasons: ["Open quickly with the most direct moment available."],
		},
		{
			kind: "setup",
			label: "Setup",
			startTime: hook,
			endTime: setupEnd,
			strategy: brief.goal === "talking-head" ? "talking" : "caption-led",
			reasons: ["Keep setup minimal until after the opener lands."],
		},
		{
			kind: "body",
			label: "Body",
			startTime: setupEnd,
			endTime: payoffStart,
			strategy: brief.goal === "talking-head" ? "caption-led" : hasBeatPacing ? "montage" : "broll",
			reasons: ["Use the middle section for proof and momentum."],
		},
		{
			kind: "payoff",
			label: "Payoff",
			startTime: payoffStart,
			endTime: targetDuration - cta,
			strategy: brief.goal === "product-highlight" ? "overlay-led" : "caption-led",
			reasons: ["Reserve a later payoff so the opener and ending are not the same beat."],
		},
	];
	if (ctaImplied) {
		beats.push({
			kind: "cta",
			label: "CTA",
			startTime: targetDuration - cta,
			endTime: targetDuration,
			strategy: "overlay-led",
			reasons: ["The brief implies a CTA, so keep the end clean for it."],
		});
	}
	return beats;
}

function resolveHookStrategy({
	brief,
	hasBeatPacing,
}: {
	brief: CreativeBrief;
	hasBeatPacing: boolean;
}): RetentionBeat["strategy"] {
	if (brief.goal === "talking-head") {
		return "talking";
	}
	if (brief.goal === "product-highlight") {
		return "overlay-led";
	}
	if (hasBeatPacing) {
		return "montage";
	}
	return "caption-led";
}

function isCtaImplied({ brief }: { brief: CreativeBrief }): boolean {
	if (brief.goal === "product-highlight") {
		return true;
	}
	if (!brief.notes) {
		return false;
	}
	return /\bcta\b|\bcall to action\b|\bsubscribe\b|\bfollow\b|\bshop\b|\blink in bio\b|\bdm\b|\bcomment\b/i.test(
		brief.notes,
	);
}

function resolveSceneDuration({ project }: { project: TProject | null }): number {
	if (!project) {
		return 24;
	}
	const scene =
		project.scenes.find((entry) => entry.id === project.currentSceneId) ?? project.scenes[0];
	if (!scene) {
		return Math.max(24, project.metadata.duration || 0);
	}
	let duration = 0;
	for (const track of scene.tracks) {
		for (const element of track.elements) {
			duration = Math.max(duration, element.startTime + element.duration);
		}
	}
	return Math.max(duration, project.metadata.duration || 0, 24);
}

function uniqueReasons(reasons: string[]): string[] {
	return [...new Set(reasons)];
}

function pushUniqueRetentionWarning({
	warnings,
	warning,
	pattern,
}: {
	warnings: string[];
	warning: string;
	pattern: RegExp;
}): void {
	if (!warnings.some((entry) => pattern.test(entry))) {
		warnings.push(warning);
	}
}

function formatSpan(startTime: number, endTime: number): string {
	return `${startTime.toFixed(1)}s to ${endTime.toFixed(1)}s`;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
