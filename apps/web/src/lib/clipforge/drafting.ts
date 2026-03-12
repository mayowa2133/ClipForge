import {
	DEFAULT_PROJECT_MONTAGE_DEFAULTS,
	DEFAULT_PROJECT_OVERLAY_DEFAULTS,
	detectVersionTargetFromCanvasSize,
} from "@/constants/project-constants";
import { buildRetentionShapePlan } from "@/lib/clipforge/retention-shaping";
import { resolvePolishProfileFromBrief } from "@/lib/clipforge/polish-profiles";
import type { MediaAsset } from "@/types/assets";
import type {
	CreativeBrief,
	CreativeBriefGoal,
	CreativeBriefTone,
	DraftBuildStep,
	DraftImpactSummary,
	DraftRecipe,
	DraftSectionPlan,
	FootageIntelligenceReport,
	RetentionShapePlan,
	TrendSoundReference,
} from "@/types/clipforge";
import type { ProjectVersionTarget, TProject } from "@/types/project";
import type { ProjectKitTemplate, SceneRecipePresetId } from "@/types/templates";
import { buildSceneCaptionSegments } from "./caption-studio";

const EXPLICIT_DRAFT_PATTERNS = [
	/\bmake\s+(?:me\s+)?(?:a\s+)?viral\s+(?:tik\s?tok|tiktok)\b/i,
	/\bmake\s+(?:me\s+)?(?:a\s+)?tiktok\b/i,
	/\bbuild\s+(?:me\s+)?(?:a\s+)?tiktok\b/i,
	/\bturn\s+.+\s+into\s+(?:a\s+)?(?:tik\s?tok|tiktok)\b/i,
	/\b(make|build|create)\s+.+\b(vlog|luxury|routine|talking head|product highlight)\b/i,
];

const HIGH_LEVEL_STYLE_PATTERNS = [
	/\bluxury\b/i,
	/\bbold captions?\b/i,
	/\btimestamp cards?\b/i,
	/\bauto montage\b/i,
	/\bfast pacing\b/i,
	/\bmulti-?format\b/i,
];

const RAW_EDIT_PATTERNS = [
	/\btrim\b/i,
	/\bmove\b/i,
	/\bdelete\b/i,
	/\bduplicate\b/i,
	/\bswap\b/i,
	/\breplace\b/i,
	/\bfix\b/i,
	/\bcaption text\b/i,
];

const GOAL_TO_OVERLAY_PRESETS: Partial<
	Record<CreativeBriefGoal, Array<"timestamp-card" | "routine-label" | "stat-card">>
> = {
	"viral-tiktok": ["routine-label"],
	vlog: ["timestamp-card"],
	"luxury-routine": ["timestamp-card", "routine-label"],
	"product-highlight": ["stat-card"],
};

const GOAL_TO_SCENE_RECIPE: Partial<Record<CreativeBriefGoal, SceneRecipePresetId>> = {
	"viral-tiktok": "vlog-beat-section",
	vlog: "vlog-beat-section",
	"product-highlight": "cta-outro",
};

export function isCreativeDraftIntent({ prompt }: { prompt: string }): boolean {
	if (EXPLICIT_DRAFT_PATTERNS.some((pattern) => pattern.test(prompt))) {
		return true;
	}
	if (RAW_EDIT_PATTERNS.some((pattern) => pattern.test(prompt))) {
		return false;
	}
	return HIGH_LEVEL_STYLE_PATTERNS.filter((pattern) => pattern.test(prompt)).length >= 2;
}

export function buildCreativeBriefFromPrompt({
	prompt,
	project,
}: {
	prompt: string;
	project: TProject;
}): CreativeBrief {
	const normalizedPrompt = prompt.toLowerCase();
	const activeTarget =
		project.settings.versionPack?.activeTargetId ??
		detectVersionTargetFromCanvasSize({
			canvasSize: project.settings.canvasSize,
		});
	const projectDuration = Math.max(5, Math.round(project.metadata.duration || 0));
	const durationTargetS =
		parseDurationTarget({ prompt: normalizedPrompt }) ??
		defaultDurationTarget({
			projectDurationS: projectDuration,
			goal: inferGoal({ prompt: normalizedPrompt }),
		});
	const overlayDefaults = {
		...DEFAULT_PROJECT_OVERLAY_DEFAULTS,
		...(project.settings.overlayDefaults ?? {}),
	};
	const montageDefaults = {
		...DEFAULT_PROJECT_MONTAGE_DEFAULTS,
		...(project.settings.montageDefaults ?? {}),
	};
	const tone = inferTone({ prompt: normalizedPrompt });
	const goal = inferGoal({ prompt: normalizedPrompt });
	const trendSoundReference = resolveTrendSoundReference({
		prompt: normalizedPrompt,
		references: project.clipforge?.trendSoundReferences ?? [],
	});
	const captionStyleId = inferCaptionStyleId({
		prompt: normalizedPrompt,
		project,
	});
	const versionTargets = inferVersionTargets({
		prompt: normalizedPrompt,
		activeTarget,
	});

	return {
		goal,
		tone,
		durationTargetS,
		captionStyleId,
		overlayStyleVariantId:
			inferOverlayVariantId({ prompt: normalizedPrompt, tone }) ??
			overlayDefaults.variantId,
		motionPresetId:
			inferMotionPresetId({ prompt: normalizedPrompt }) ??
			montageDefaults.motionPresetId ??
			overlayDefaults.motionPresetId,
		beatDivision: inferBeatDivision({ prompt: normalizedPrompt }) ?? montageDefaults.beatDivision,
		versionTargets,
		trendSoundReferenceId: trendSoundReference?.id ?? null,
		notes: prompt.trim() || null,
	};
}

export function planDraftRecipe({
	brief,
	project,
	mediaAssets,
	beatSourceMediaId,
	beatMarkerCount,
	projectKitTemplates,
	footageIntelligenceReport,
}: {
	brief: CreativeBrief;
	project: TProject;
	mediaAssets: MediaAsset[];
	beatSourceMediaId: string | null;
	beatMarkerCount: number;
	projectKitTemplates: ProjectKitTemplate[];
	footageIntelligenceReport?: FootageIntelligenceReport | null;
}): DraftRecipe {
	const warnings: string[] = [];
	const operations: DraftBuildStep[] = [];
	const activeScene =
		project.scenes.find((scene) => scene.id === project.currentSceneId) ??
		project.scenes[0] ??
		null;
	const sceneCaptions = buildSceneCaptionSegments({ project });
	const hasVisualMedia = mediaAssets.some(
		(asset) => asset.type === "video" && !asset.ephemeral,
	);
	const hasTranscript = activeScene
		? activeScene.tracks.some((track) =>
				track.elements.some(
					(element) =>
						"mediaId" in element &&
						typeof element.mediaId === "string" &&
						(project.clipforge?.mediaMetadataById[element.mediaId]?.segments.length ?? 0) > 0,
					),
		  )
		: false;
	const overlayPresets = GOAL_TO_OVERLAY_PRESETS[brief.goal] ?? [];
	const topHookCandidate = footageIntelligenceReport?.hookCandidates[0] ?? null;
	const hasSceneAssembly =
		(activeScene?.tracks.reduce((total, track) => total + track.elements.length, 0) ?? 0) > 0;
	const polishProfile = resolvePolishProfileFromBrief({ brief, project });
	const retentionShape = buildRetentionShapePlan({
		brief,
		footageReport: footageIntelligenceReport,
		project,
		beatMarkerCount,
	});
	const keepCutRecommendationIds = extractRecommendationIdsFromRetentionPlan({
		retentionShape,
	});
	for (const warning of retentionShape.warnings) {
		pushUniqueWarning({ warnings, warning });
	}

	if (!hasVisualMedia) {
		warnings.push("No video clips are available for a TikTok draft.");
	} else {
		if (!hasSceneAssembly) {
			operations.push({
				kind: "auto-edit",
				params: {},
			});
		}
	}

	const matchingKit = findMatchingProjectKit({
		brief,
		projectKitTemplates,
	});
	if (matchingKit) {
		operations.push({
			kind: "apply-project-kit",
			params: { kitId: matchingKit.id, kitName: matchingKit.name },
		});
	}

	operations.push({
		kind: "make-version",
		params: {
			durationTargetS: brief.durationTargetS,
			aggressiveness: brief.goal === "talking-head" ? 0.45 : 0.75,
		},
	});

	if (sceneCaptions.length === 0) {
		if (hasTranscript) {
			operations.push({
				kind: "generate-captions",
				params: {
					template:
						brief.captionStyleId === "clean-bottom" ? "clean-bottom" : "bold-center",
					overwriteExisting: false,
				},
			});
		} else {
			warnings.push("No transcript metadata is available, so caption generation may be skipped.");
		}
	}

	if (brief.captionStyleId) {
		operations.push({
			kind: "apply-caption-style",
			params: { styleId: brief.captionStyleId },
		});
	}

	if (beatSourceMediaId && beatMarkerCount >= 2) {
		operations.push({
			kind: "auto-montage",
			params: {
				musicMediaId: beatSourceMediaId,
				strategy:
					brief.beatDivision === 1 ? "one-cut-per-beat" : "one-cut-per-two-beats",
				beatDivision: brief.beatDivision ?? 2,
			},
		});
	} else {
		pushUniqueWarning({
			warnings,
			warning: "No analyzed beat source is active, so beat-paced montage may be skipped.",
		});
	}
	if (brief.trendSoundReferenceId) {
		const trendReference =
			project.clipforge?.trendSoundReferences.find(
				(reference) => reference.id === brief.trendSoundReferenceId,
			) ?? null;
		if (trendReference) {
			pushUniqueWarning({
				warnings,
				warning: `Using trend reference "${trendReference.label}" as a pacing/style cue only; you still need a valid bundled or imported audio track.`,
			});
		}
	}
	for (const footageWarning of footageIntelligenceReport?.warnings ?? []) {
		pushUniqueWarning({ warnings, warning: footageWarning });
	}

	const hookBeat = retentionShape.beats.find((beat) => beat.kind === "hook") ?? null;
	const payoffBeat = retentionShape.beats.find((beat) => beat.kind === "payoff") ?? null;
	const ctaBeat = retentionShape.beats.find((beat) => beat.kind === "cta") ?? null;

	for (const [index, presetId] of overlayPresets.entries()) {
		operations.push({
			kind: "insert-overlay",
			params: {
				presetId,
				variantId: brief.overlayStyleVariantId,
				motionPresetId: brief.motionPresetId,
				startTime:
					index === 0
						? Number(Math.max(0.25, Math.min(1.2, (hookBeat?.startTime ?? 0) + 0.2)).toFixed(2))
						: Number((payoffBeat?.startTime ?? 2.8).toFixed(2)),
				duration: presetId === "timestamp-card" ? 2 : 2.2,
			},
		});
	}

	const sceneRecipeId = GOAL_TO_SCENE_RECIPE[brief.goal];
	if (sceneRecipeId) {
		operations.push({
			kind: "insert-scene-recipe",
			params: {
				recipeId: sceneRecipeId,
				startTime:
					sceneRecipeId === "cta-outro"
						? Number(
								(
									ctaBeat?.startTime ??
									Math.max(0, (brief.durationTargetS ?? 24) - 2.6)
								).toFixed(2),
						  )
						: 0.15,
			},
		});
	}

	operations.push({
		kind: "apply-polish-profile",
		params: {
			profileId: polishProfile.id,
		},
	});

	operations.push({
		kind: "apply-version-pack",
		params: {
			targets: brief.versionTargets,
		},
	});

	if (brief.versionTargets.length > 1) {
		operations.push({
			kind: "apply-safe-layout",
			params: {
				targetVersionIds: brief.versionTargets.slice(1),
			},
		});
	}

	return {
		brief,
		sections: buildSectionPlan({ brief }),
		operations,
		retentionShape,
		hookCandidateId: retentionShape.hookCandidateId ?? topHookCandidate?.id ?? null,
		keepCutRecommendationIds: keepCutRecommendationIds,
		warnings,
	};
}

export function buildDraftImpactSummary({
	recipe,
}: {
	recipe: DraftRecipe;
}): DraftImpactSummary {
	return {
		totalSteps: recipe.operations.length,
		overlayCount: recipe.operations.filter((step) => step.kind === "insert-overlay").length,
		versionTargets: recipe.brief.versionTargets,
		willRebuildAssembly: recipe.operations.some((step) => step.kind === "auto-edit"),
		willGenerateCaptions: recipe.operations.some(
			(step) => step.kind === "generate-captions",
		),
		usesBeatMontage: recipe.operations.some((step) => step.kind === "auto-montage"),
	};
}

function findMatchingProjectKit({
	brief,
	projectKitTemplates,
}: {
	brief: CreativeBrief;
	projectKitTemplates: ProjectKitTemplate[];
}): ProjectKitTemplate | null {
	const searchTerms = [brief.goal, brief.tone].map((value) =>
		value.replaceAll("-", " "),
	);
	return (
		projectKitTemplates.find((template) =>
			searchTerms.some((term) => template.name.toLowerCase().includes(term)),
		) ?? null
	);
}

function inferGoal({ prompt }: { prompt: string }): CreativeBriefGoal {
	if (/\bluxury\b/i.test(prompt) && /\broutine|morning|day\b/i.test(prompt)) {
		return "luxury-routine";
	}
	if (/\btalking head|explainer|interview\b/i.test(prompt)) {
		return "talking-head";
	}
	if (/\bproduct|feature|demo|showcase\b/i.test(prompt)) {
		return "product-highlight";
	}
	if (/\bvlog\b/i.test(prompt)) {
		return "vlog";
	}
	return "viral-tiktok";
}

function inferTone({ prompt }: { prompt: string }): CreativeBriefTone {
	if (/\bluxury\b/i.test(prompt)) return "luxury";
	if (/\bbold|punchy\b/i.test(prompt)) return "bold";
	if (/\benergetic|fast\b/i.test(prompt)) return "energetic";
	if (/\bminimal\b/i.test(prompt)) return "minimal";
	return "clean";
}

function inferCaptionStyleId({
	prompt,
	project,
}: {
	prompt: string;
	project: TProject;
}): string | null {
	if (/\bbold\b.*\bcaptions?|captions?\b.*\bbold\b/i.test(prompt)) {
		return "bold-center";
	}
	if (/\bclean\b.*\bcaptions?|subtitles?\b.*\bbottom\b/i.test(prompt)) {
		return "clean-bottom";
	}
	return project.clipforge?.activeCaptionStyleId ?? "bold-center";
}

function inferOverlayVariantId({
	prompt,
	tone,
}: {
	prompt: string;
	tone: CreativeBriefTone;
}): string | null {
	if (/\bluxury\b/i.test(prompt)) return "luxury";
	if (/\bbold\b/i.test(prompt)) return "bold-social";
	if (/\bminimal\b/i.test(prompt)) return "minimal";
	if (tone === "clean") return "clean-vlog";
	return null;
}

function inferMotionPresetId({ prompt }: { prompt: string }): string | null {
	if (/\bpop\b/i.test(prompt)) return "pop-in";
	if (/\bslide\b/i.test(prompt)) return "slide-up";
	if (/\bdrift\b/i.test(prompt)) return "drift-in";
	if (/\bstatic|none\b/i.test(prompt)) return "none";
	return null;
}

function inferBeatDivision({ prompt }: { prompt: string }): 1 | 2 | 4 | null {
	if (/\bevery beat|one beat\b/i.test(prompt)) return 1;
	if (/\b4 beats?\b/i.test(prompt)) return 4;
	if (/\b2 beats?\b|fast pacing|viral/i.test(prompt)) return 2;
	return null;
}

function inferVersionTargets({
	prompt,
	activeTarget,
}: {
	prompt: string;
	activeTarget: ProjectVersionTarget;
}): ProjectVersionTarget[] {
	if (/\ball formats?|all versions?|every format\b/i.test(prompt)) {
		return ["9:16", "1:1", "16:9"];
	}

	const targets = new Set<ProjectVersionTarget>();
	if (/\b9:16\b|\bvertical\b|\btiktok\b|\breels?\b|\bshorts?\b/i.test(prompt)) {
		targets.add("9:16");
	}
	if (/\b1:1\b|\bsquare\b|\binstagram feed\b/i.test(prompt)) {
		targets.add("1:1");
	}
	if (/\b16:9\b|\blandscape\b|\byoutube\b/i.test(prompt)) {
		targets.add("16:9");
	}
	return targets.size > 0 ? [...targets] : [activeTarget];
}

function resolveTrendSoundReference({
	prompt,
	references,
}: {
	prompt: string;
	references: TrendSoundReference[];
}): TrendSoundReference | null {
	if (!/\b(sound|song|audio|trend)\b/i.test(prompt)) {
		return null;
	}
	if (
		!/\b(tiktok|instagram|youtube|that sound|this sound|trend(?:ing)? sound)\b/i.test(
			prompt,
		)
	) {
		return null;
	}
	const exact = references.find((reference) =>
		prompt.includes(reference.label.toLowerCase()),
	);
	if (exact) {
		return exact;
	}
	return references[0] ?? null;
}

function parseDurationTarget({ prompt }: { prompt: string }): number | null {
	const match =
		prompt.match(/\b(\d+)\s?s(?:ec|econd)?s?\b/) ??
		prompt.match(/\b(\d+)\s?sec\b/);
	if (!match) return null;
	const value = Number(match[1]);
	return Number.isFinite(value) && value > 0 ? value : null;
}

function defaultDurationTarget({
	projectDurationS,
	goal,
}: {
	projectDurationS: number;
	goal: CreativeBriefGoal;
}): number {
	const baseline =
		goal === "talking-head"
			? projectDurationS * 0.75
			: goal === "product-highlight"
				? projectDurationS * 0.55
				: projectDurationS * 0.45;
	return Math.max(15, Math.min(35, Math.round(baseline)));
}

function buildSectionPlan({
	brief,
}: {
	brief: CreativeBrief;
}): DraftSectionPlan[] {
	const total = Math.max(10, brief.durationTargetS ?? 24);
	const hook = Number(Math.min(3, Math.max(2, total * 0.12)).toFixed(1));
	const cta = total >= 18 ? 2.5 : 0;
	const payoff = total >= 16 ? 4 : 3;
	const body = Number(Math.max(4, total - hook - payoff - cta).toFixed(1));
	const sections: DraftSectionPlan[] = [
		{
			kind: "hook",
			label: "Hook",
			targetDurationS: hook,
			strategy:
				brief.goal === "talking-head" ? "talking" : brief.goal === "product-highlight" ? "overlay-led" : "montage",
		},
		{
			kind: "body",
			label: "Body",
			targetDurationS: body,
			strategy:
				brief.goal === "talking-head"
					? "caption-led"
					: brief.goal === "luxury-routine"
						? "overlay-led"
						: "montage",
		},
		{
			kind: "payoff",
			label: "Payoff",
			targetDurationS: payoff,
			strategy:
				brief.goal === "product-highlight" ? "overlay-led" : "caption-led",
		},
	];
	if (cta > 0) {
		sections.push({
			kind: "cta",
			label: "CTA",
			targetDurationS: cta,
			strategy: "overlay-led",
		});
	}
	return sections;
}

function extractRecommendationIdsFromRetentionPlan({
	retentionShape,
}: {
	retentionShape: RetentionShapePlan | null;
}): string[] {
	if (!retentionShape) {
		return [];
	}
	const ids: string[] = [];
	for (const step of retentionShape.steps) {
		if (
			step.kind !== "trim-setup" &&
			step.kind !== "delay-context" &&
			step.kind !== "compress-body"
		) {
			continue;
		}
		const stepIds = step.params.recommendationIds;
		if (!Array.isArray(stepIds)) {
			continue;
		}
		for (const id of stepIds) {
			if (typeof id === "string" && !ids.includes(id)) {
				ids.push(id);
			}
		}
	}
	return ids;
}

function pushUniqueWarning({
	warnings,
	warning,
}: {
	warnings: string[];
	warning: string;
}): void {
	if (!warnings.includes(warning)) {
		warnings.push(warning);
	}
}
