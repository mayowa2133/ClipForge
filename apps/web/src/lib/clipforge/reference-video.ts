import { BUNDLED_MUSIC, BUNDLED_SFX } from "@/lib/library/content-packs";
import type { MediaAsset } from "@/types/assets";
import type {
	ClipMediaMetadata,
	CaptionRevealPresetId,
	ReferenceVideoAnalysis,
	ReferenceVideoAnalysisStatus,
	ReferenceCaptionTone,
	ReferenceEnergyLevel,
	ReferencePacingCadence,
} from "@/types/clipforge";

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function safeDateMs(value: string | null | undefined): number {
	if (!value) return 0;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function inferCadence({
	averageShotMs,
}: {
	averageShotMs: number | null;
}): ReferencePacingCadence {
	if (averageShotMs === null) return "medium";
	if (averageShotMs <= 1400) return "fast";
	if (averageShotMs <= 3200) return "medium";
	return "slow";
}

function inferEnergy({
	activityScore,
	bpm,
}: {
	activityScore: number;
	bpm: number | null;
}): ReferenceEnergyLevel {
	if ((bpm ?? 0) >= 122 || activityScore >= 0.68) return "high";
	if ((bpm ?? 0) >= 98 || activityScore >= 0.34) return "medium";
	return "low";
}

function inferCaptionTone({
	energy,
	aspectRatio,
}: {
	energy: ReferenceEnergyLevel;
	aspectRatio: number | null;
}): ReferenceCaptionTone {
	if (energy === "high") return "bold";
	if (aspectRatio !== null && aspectRatio < 0.8) return "clean";
	return "soft";
}

export function inferReferenceCaptionRevealPreset({
	tone,
}: {
	tone: ReferenceCaptionTone | null;
}): CaptionRevealPresetId | null {
	switch (tone) {
		case "bold":
			return "pop-line";
		case "luxury":
			return "luxury-rise";
		case "clean":
			return "fade-line";
		case "soft":
			return "type-on-soft";
		default:
			return null;
	}
}

function inferPublishDestination({
	width,
	height,
	energy,
}: {
	width?: number;
	height?: number;
	energy: ReferenceEnergyLevel;
}) {
	if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) {
		return energy === "high" ? ("tiktok" as const) : ("generic-export" as const);
	}
	const aspectRatio = width / height;
	if (aspectRatio < 0.8) {
		return energy === "high" ? ("tiktok" as const) : ("instagram" as const);
	}
	if (aspectRatio > 1.3) {
		return "youtube" as const;
	}
	return "instagram" as const;
}

export function getReferenceVideoAnalysisStatus({
	analysis,
	asset,
	metadata,
}: {
	analysis: ReferenceVideoAnalysis | null;
	asset: MediaAsset | null;
	metadata: ClipMediaMetadata | null;
}): ReferenceVideoAnalysisStatus {
	if (!asset) {
		return analysis ? "missing" : "idle";
	}
	if (!analysis) {
		return "idle";
	}
	if (analysis.status === "error") {
		return "error";
	}
	const upstreamTimestamp = Math.max(
		safeDateMs(asset.visualAnalysis?.analyzedAt ?? null),
		safeDateMs(asset.beatAnalysis?.analyzedAt ?? null),
		safeDateMs(metadata?.indexedAt ?? null),
	);
	if (upstreamTimestamp > safeDateMs(analysis.analyzedAt)) {
		return "stale";
	}
	return analysis.status === "missing" ? "missing" : "ready";
}

export function buildReferenceVideoAnalysis({
	asset,
	metadata,
}: {
	asset: MediaAsset;
	metadata: ClipMediaMetadata | null;
}): ReferenceVideoAnalysis {
	const sceneCuts = asset.visualAnalysis?.sceneCuts ?? [];
	const activityWindows = asset.visualAnalysis?.activityWindows ?? [];
	const bpm = asset.beatAnalysis?.bpm ?? null;
	const durationMs = Math.max(1, Math.round((asset.duration ?? 0) * 1000));
	const averageShotMs =
		sceneCuts.length > 0
			? Math.round(durationMs / (sceneCuts.length + 1))
			: null;
	const averageActivity =
		activityWindows.length > 0
			? activityWindows.reduce((sum, window) => sum + window.score, 0) /
			  activityWindows.length
			: 0;
	const energy = inferEnergy({
		activityScore: averageActivity,
		bpm,
	});
	const cadence = inferCadence({
		averageShotMs,
	});
	const aspectRatio =
		typeof asset.width === "number" && typeof asset.height === "number" && asset.height > 0
			? asset.width / asset.height
			: null;
	const publishDestination = inferPublishDestination({
		width: asset.width,
		height: asset.height,
		energy,
	});
	const targetVersionId =
		publishDestination === "youtube"
			? ("16:9" as const)
			: publishDestination === "generic-export"
				? ("1:1" as const)
				: ("9:16" as const);
	const words = metadata?.words ?? [];
	const transcriptSegments =
		metadata?.segments?.filter((segment) => segment.end_ms > segment.start_ms) ?? [];
	const averageWordsPerSegment =
		transcriptSegments.length > 0
			? Number(
					(
						words.length /
						Math.max(1, transcriptSegments.length)
					).toFixed(1),
			  )
			: words.length > 0
				? Number((words.length / Math.max(1, durationMs / 1500)).toFixed(1))
				: null;
	const captionPresence =
		words.length === 0 ? "none" : words.length >= 10 ? "heavy" : "light";
	const captionTone = inferCaptionTone({
		energy,
		aspectRatio,
	});
	const revealPresetId = inferReferenceCaptionRevealPreset({
		tone: captionTone,
	});
	const musicMood =
		energy === "high"
			? "energetic"
			: publishDestination === "youtube"
				? "minimal"
				: captionTone === "soft"
					? "clean"
					: "upbeat";
	const recommendedMusic =
		BUNDLED_MUSIC.find((item) => item.mood === musicMood) ?? BUNDLED_MUSIC[0] ?? null;
	const recommendedSfx =
		energy === "high"
			? BUNDLED_SFX.find((item) => item.id === "transition-air")
			: BUNDLED_SFX.find((item) => item.id === "subtle-hit") ?? BUNDLED_SFX[0] ?? null;
	const sectionBoundaries = [
		0,
		Math.round(durationMs * 0.18),
		Math.round(durationMs * 0.76),
		durationMs,
	];
	const warnings: string[] = [];
	if (words.length === 0) {
		warnings.push(
			"Reference transcript is unavailable, so caption tone was inferred from pacing instead of rendered text.",
		);
	}
	if (sceneCuts.length === 0) {
		warnings.push(
			"Reference scene cuts are unavailable, so transition cadence was estimated from duration only.",
		);
	}
	if (activityWindows.length === 0) {
		warnings.push(
			"Reference activity windows are unavailable, so pacing intensity was inferred from BPM and aspect ratio.",
		);
	}
	warnings.push(
		"ClipForge adapts pacing, captions, audio feel, and packaging from the reference. It does not duplicate shots from the reference timeline.",
	);

	return {
		analyzedAt: new Date().toISOString(),
		status: "ready",
		sectionPlan: [
			{
				label: "Hook",
				start_ms: sectionBoundaries[0] ?? 0,
				end_ms: sectionBoundaries[1] ?? Math.round(durationMs * 0.18),
				role: "hook",
			},
			{
				label: "Body",
				start_ms: sectionBoundaries[1] ?? Math.round(durationMs * 0.18),
				end_ms: sectionBoundaries[2] ?? Math.round(durationMs * 0.76),
				role: "body",
			},
			{
				label: "Payoff",
				start_ms: sectionBoundaries[2] ?? Math.round(durationMs * 0.76),
				end_ms: sectionBoundaries[3] ?? durationMs,
				role: "payoff",
			},
		],
		shotPattern: {
			average_shot_ms: averageShotMs,
			transition_cadence: cadence,
			scene_cut_count: sceneCuts.length,
			activity_intensity: energy,
		},
		captionProfile: {
			presence: captionPresence,
			reveal_preset_id: revealPresetId,
			tone: captionTone,
			average_words_per_segment: averageWordsPerSegment,
		},
		audioProfile: {
			music_mood: musicMood,
			recommended_music_asset_id: recommendedMusic?.id ?? null,
			recommended_sfx_asset_id: recommendedSfx?.id ?? null,
			bpm,
			energy,
		},
		overlayProfile: {
			density:
				captionPresence === "none"
					? "light"
					: captionPresence === "heavy"
						? "heavy"
						: "light",
			variant_id:
				captionTone === "bold"
					? "bold-social"
					: captionTone === "luxury"
						? "luxury"
						: captionTone === "soft"
							? "minimal"
							: "clean-vlog",
			motion_preset_id:
				energy === "high" ? "slide-up" : cadence === "slow" ? "drift-in" : "fade-up",
		},
		finishingProfile: {
			polish_profile_id:
				publishDestination === "youtube"
					? "talking-head"
					: energy === "high"
						? "bold-social"
						: "clean-vlog",
			finishing_look_id:
				energy === "high" ? "dramatic" : publishDestination === "youtube" ? "clean" : "warm",
		},
		publishProfile: {
			publish_destination: publishDestination,
			target_version_id: targetVersionId,
			packaging_hint:
				publishDestination === "youtube"
					? "Longer frame with calmer pacing and more breathing room."
					: "Short-form packaging with a fast opener and vertical-safe layout.",
			hook_pattern:
				(sectionBoundaries[1] ?? 0) <= 1800
					? "front-loaded hook"
					: "staggered hook",
		},
		warnings,
	};
}

export function summarizeReferenceAnalysis({
	analysis,
}: {
	analysis: ReferenceVideoAnalysis | null;
}): string {
	if (!analysis) {
		return "No reference analysis is available.";
	}
	return [
		`${analysis.shotPattern.transition_cadence} pacing`,
		analysis.captionProfile.tone
			? `${analysis.captionProfile.tone} captions`
			: "caption tone inferred",
		analysis.audioProfile.music_mood
			? `${analysis.audioProfile.music_mood} music feel`
			: "music feel inferred",
		analysis.publishProfile.target_version_id
			? `${analysis.publishProfile.target_version_id} packaging`
			: "packaging adaptable",
	].join(" · ");
}

export function buildReferenceReadiness({
	status,
	analysis,
}: {
	status: ReferenceVideoAnalysisStatus;
	analysis: ReferenceVideoAnalysis | null;
}) {
	if (status === "missing") {
		return {
			ready: false,
			status: "blocked" as const,
			reason: "The selected reference asset is no longer available in the project.",
		};
	}
	if (status === "error") {
		return {
			ready: false,
			status: "blocked" as const,
			reason: "Reference analysis failed and must be regenerated before matching.",
		};
	}
	if (!analysis || status === "idle") {
		return {
			ready: false,
			status: "attention" as const,
			reason: "Reference analysis has not been generated yet.",
		};
	}
	if (status === "stale") {
		return {
			ready: true,
			status: "attention" as const,
			reason: "Reference analysis is stale and should be refreshed before a close match.",
		};
	}
	return {
		ready: true,
		status: "ready" as const,
		reason: summarizeReferenceAnalysis({ analysis }),
	};
}

export function chooseReferenceMusicVolume({
	energy,
}: {
	energy: ReferenceEnergyLevel;
}): number {
	return Number(clampNumber(energy === "high" ? 0.72 : energy === "medium" ? 0.58 : 0.44, 0, 1).toFixed(2));
}
