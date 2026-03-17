import { BUNDLED_MUSIC, BUNDLED_SFX } from "@/lib/library/content-packs";
import type { MediaAsset } from "@/types/assets";
import type {
	ClipMediaMetadata,
	CaptionRevealPresetId,
	FootageDescriptor,
	ReferenceDraftSectionMatch,
	ReferenceMatchLock,
	ReferenceShotPlan,
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

function inferAspectRatioPreset({
	width,
	height,
}: {
	width?: number;
	height?: number;
}): FootageDescriptor["aspect_ratio"] {
	if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) {
		return "unknown";
	}
	const ratio = width / height;
	if (ratio < 0.8) return "9:16";
	if (ratio > 1.3) return "16:9";
	return "1:1";
}

function buildTranscriptCueList({
	metadata,
	fallbackLabel,
	limit = 6,
}: {
	metadata: ClipMediaMetadata | null;
	fallbackLabel: string;
	limit?: number;
}): string[] {
	const cues = new Set<string>();
	for (const word of metadata?.words ?? []) {
		const normalized = word.text.trim().toLowerCase();
		if (normalized.length < 3) continue;
		cues.add(normalized);
		if (cues.size >= limit) break;
	}
	if (cues.size === 0) {
		for (const part of fallbackLabel.toLowerCase().split(/[^a-z0-9]+/)) {
			if (part.length < 3) continue;
			cues.add(part);
			if (cues.size >= limit) break;
		}
	}
	return [...cues];
}

function summarizeDescriptor({
	assetName,
	transcriptCues,
	energy,
}: {
	assetName: string;
	transcriptCues: string[];
	energy: ReferenceEnergyLevel;
}): string {
	const cue = transcriptCues[0] ?? assetName.replace(/\.[a-z0-9]+$/i, "");
	return `${energy} energy footage around ${cue}`;
}

function scoreWindowActivity({
	asset,
	startMs,
	endMs,
}: {
	asset: MediaAsset;
	startMs: number;
	endMs: number;
}): number {
	const windows = asset.visualAnalysis?.activityWindows ?? [];
	if (windows.length === 0) {
		return 0.35;
	}
	const overlapping = windows.filter((window) => {
		const windowStartMs = Math.round(window.startTime * 1000);
		const windowEndMs = Math.round(window.endTime * 1000);
		return windowEndMs > startMs && windowStartMs < endMs;
	});
	if (overlapping.length === 0) {
		return 0.35;
	}
	return overlapping.reduce((sum, window) => sum + window.score, 0) / overlapping.length;
}

function buildDescriptorRanges({
	asset,
	metadata,
	durationMs,
}: {
	asset: MediaAsset;
	metadata: ClipMediaMetadata | null;
	durationMs: number;
}): FootageDescriptor["candidate_ranges"] {
	const transcriptSegments =
		metadata?.segments?.filter((segment) => segment.end_ms > segment.start_ms) ?? [];
	const fallbackBoundaries =
		durationMs <= 2400
			? [0, durationMs]
			: [0, Math.round(durationMs * 0.28), Math.round(durationMs * 0.78), durationMs];

	const ranges =
		transcriptSegments.length >= 3
			? [
					{
						label: "Hook",
						start_ms: transcriptSegments[0]?.start_ms ?? 0,
						end_ms:
							transcriptSegments[Math.min(1, transcriptSegments.length - 1)]?.end_ms ??
							Math.round(durationMs * 0.22),
					},
					{
						label: "Body",
						start_ms:
							transcriptSegments[Math.min(1, transcriptSegments.length - 1)]?.start_ms ??
							Math.round(durationMs * 0.22),
						end_ms:
							transcriptSegments[Math.max(1, transcriptSegments.length - 2)]?.end_ms ??
							Math.round(durationMs * 0.78),
					},
					{
						label: "Payoff",
						start_ms:
							transcriptSegments[Math.max(1, transcriptSegments.length - 1)]?.start_ms ??
							Math.round(durationMs * 0.78),
						end_ms: durationMs,
					},
			  ]
			: fallbackBoundaries.length === 2
				? [{ label: "Clip", start_ms: 0, end_ms: durationMs }]
				: [
						{
							label: "Hook",
							start_ms: fallbackBoundaries[0] ?? 0,
							end_ms: fallbackBoundaries[1] ?? Math.round(durationMs * 0.28),
						},
						{
							label: "Body",
							start_ms: fallbackBoundaries[1] ?? Math.round(durationMs * 0.28),
							end_ms: fallbackBoundaries[2] ?? Math.round(durationMs * 0.78),
						},
						{
							label: "Payoff",
							start_ms: fallbackBoundaries[2] ?? Math.round(durationMs * 0.78),
							end_ms: fallbackBoundaries[3] ?? durationMs,
						},
				  ];

	return ranges.map((range, index) => {
		const transcriptCues = transcriptSegments
			.filter((segment) => segment.end_ms > range.start_ms && segment.start_ms < range.end_ms)
			.flatMap((segment) =>
				segment.text
					.toLowerCase()
					.split(/[^a-z0-9]+/)
					.filter((token) => token.length >= 3),
			)
			.slice(0, 5);
		const activityScore = scoreWindowActivity({
			asset,
			startMs: range.start_ms,
			endMs: range.end_ms,
		});
		return {
			range_id: `${asset.id}:range:${index + 1}`,
			label: range.label,
			start_ms: range.start_ms,
			end_ms: range.end_ms,
			hook_score:
				index === 0
					? Number(clampNumber(activityScore + 0.28, 0, 1).toFixed(2))
					: Number(clampNumber(activityScore * 0.72, 0, 1).toFixed(2)),
			activity_score: Number(clampNumber(activityScore, 0, 1).toFixed(2)),
			transcript_cues: transcriptCues,
			semantic_summary:
				transcriptCues[0] ?? `${range.label.toLowerCase()} section from ${asset.name}`,
		};
	});
}

export function buildFootageDescriptor({
	asset,
	metadata,
}: {
	asset: MediaAsset;
	metadata: ClipMediaMetadata | null;
}): FootageDescriptor {
	const durationMs = Math.max(1, Math.round((asset.duration ?? 0) * 1000));
	const averageActivity = scoreWindowActivity({
		asset,
		startMs: 0,
		endMs: durationMs,
	});
	const energy = inferEnergy({
		activityScore: averageActivity,
		bpm: asset.beatAnalysis?.bpm ?? null,
	});
	const transcriptCues = buildTranscriptCueList({
		metadata,
		fallbackLabel: asset.name,
	});
	const candidateRanges = buildDescriptorRanges({
		asset,
		metadata,
		durationMs,
	});
	return {
		analyzedAt: new Date().toISOString(),
		asset_id: asset.id,
		asset_name: asset.name,
		duration_ms: durationMs,
		aspect_ratio: inferAspectRatioPreset({
			width: asset.width,
			height: asset.height,
		}),
		scene_cut_count: asset.visualAnalysis?.sceneCuts.length ?? 0,
		activity_intensity: energy,
		beat_bpm: asset.beatAnalysis?.bpm ?? null,
		hook_score:
			candidateRanges[0]?.hook_score ??
			Number(clampNumber(averageActivity + 0.2, 0, 1).toFixed(2)),
		transcript_cues: transcriptCues,
		semantic_summary: summarizeDescriptor({
			assetName: asset.name,
			transcriptCues,
			energy,
		}),
		candidate_ranges: candidateRanges,
		warnings:
			transcriptCues.length === 0
				? [
						"Transcript cues are unavailable, so source matching falls back to pacing and activity patterns.",
				  ]
				: [],
	};
}

export function buildReferenceShotPlan({
	asset,
	analysis,
}: {
	asset: MediaAsset;
	analysis: ReferenceVideoAnalysis;
}): ReferenceShotPlan {
	const durationMs = Math.max(1, Math.round((asset.duration ?? 0) * 1000));
	const baseSections = analysis.sectionPlan.length > 0
		? analysis.sectionPlan
		: [
				{ label: "Hook", start_ms: 0, end_ms: Math.round(durationMs * 0.2), role: "hook" as const },
				{
					label: "Body",
					start_ms: Math.round(durationMs * 0.2),
					end_ms: Math.round(durationMs * 0.82),
					role: "body" as const,
				},
				{
					label: "Payoff",
					start_ms: Math.round(durationMs * 0.82),
					end_ms: durationMs,
					role: "payoff" as const,
				},
		  ];
	const sections: ReferenceShotPlan["sections"] = baseSections.map((section, index) => ({
		match_id: `${asset.id}:match:${section.role}:${index + 1}`,
		label: section.label,
		role: section.role,
		target_start_ms: section.start_ms,
		target_duration_ms: Math.max(600, section.end_ms - section.start_ms),
		shot_cadence: analysis.shotPattern.transition_cadence,
		desired_energy:
			section.role === "hook"
				? "high"
				: section.role === "body"
					? analysis.shotPattern.activity_intensity
					: "medium",
		overlay_moment: section.role !== "body",
		caption_moment: analysis.captionProfile.presence !== "none",
		description:
			section.role === "hook"
				? `Open with ${analysis.publishProfile.hook_pattern}.`
				: section.role === "payoff"
					? "Land the reveal or result before the ending."
					: "Carry the body with paced source footage that matches the reference cadence.",
	}));

	return {
		analyzedAt: analysis.analyzedAt,
		reference_asset_id: asset.id,
		hook_pattern: analysis.publishProfile.hook_pattern,
		ending_shape:
			analysis.publishProfile.hook_pattern.includes("cta") ? "cta" : "payoff",
		sections,
		warnings: [
			...analysis.warnings,
			"Reference-guided draft assembly adapts your chosen source clips instead of copying shots from the reference timeline.",
		],
	};
}

function energyToScore(energy: ReferenceEnergyLevel): number {
	switch (energy) {
		case "high":
			return 0.85;
		case "medium":
			return 0.55;
		case "low":
		default:
			return 0.25;
	}
}

function scoreDescriptorRange({
	section,
	descriptor,
	range,
	reusePenalty,
}: {
	section: ReferenceShotPlan["sections"][number];
	descriptor: FootageDescriptor;
	range: FootageDescriptor["candidate_ranges"][number];
	reusePenalty: number;
}) {
	const rangeDurationMs = Math.max(1, range.end_ms - range.start_ms);
	const durationScore = clampNumber(
		1 - Math.abs(rangeDurationMs - section.target_duration_ms) / Math.max(section.target_duration_ms, 1),
		0,
		1,
	);
	const energyScore =
		1 - Math.abs(range.activity_score - energyToScore(section.desired_energy));
	const hookBias =
		section.role === "hook"
			? range.hook_score
			: section.role === "payoff" || section.role === "cta"
				? clampNumber(range.activity_score + 0.12, 0, 1)
				: clampNumber((range.activity_score + durationScore) / 2, 0, 1);
	const semanticBoost =
		range.transcript_cues.length > 0 || descriptor.transcript_cues.length > 0 ? 0.12 : 0;
	return Number(
		clampNumber(durationScore * 0.4 + energyScore * 0.3 + hookBias * 0.3 + semanticBoost - reusePenalty, 0, 1).toFixed(3),
	);
}

export function buildReferenceCandidateMatches({
	referenceShotPlan,
	footageDescriptors,
	locks = {},
}: {
	referenceShotPlan: ReferenceShotPlan | null;
	footageDescriptors: FootageDescriptor[];
	locks?: Record<string, ReferenceMatchLock>;
}): ReferenceDraftSectionMatch[] {
	if (!referenceShotPlan || footageDescriptors.length === 0) {
		return [];
	}

	const usedAssetCounts = new Map<string, number>();
	return referenceShotPlan.sections.map((section) => {
		const rankedCandidates = footageDescriptors
			.flatMap((descriptor) =>
				descriptor.candidate_ranges.map((range) => {
					const reusePenalty = (usedAssetCounts.get(descriptor.asset_id) ?? 0) * 0.08;
					const score = scoreDescriptorRange({
						section,
						descriptor,
						range,
						reusePenalty,
					});
					return {
						asset_id: descriptor.asset_id,
						asset_name: descriptor.asset_name,
						range_id: range.range_id,
						start_ms: range.start_ms,
						end_ms: range.end_ms,
						score,
						reasons: [
							`${descriptor.semantic_summary}.`,
							`Matches ${section.role} timing with ${Math.round(range.end_ms - range.start_ms)}ms of source footage.`,
							range.transcript_cues[0]
								? `Cue: ${range.transcript_cues[0]}.`
								: `Activity ${descriptor.activity_intensity} and cadence fit the reference.`,
						],
					};
				}),
			)
			.sort((left, right) => right.score - left.score)
			.slice(0, 3);
		const locked = locks[section.match_id] ?? null;
		const selected =
			(locked
				? rankedCandidates.find((candidate) => candidate.asset_id === locked.asset_id)
				: null) ??
			rankedCandidates[0];
		if (selected) {
			usedAssetCounts.set(
				selected.asset_id,
				(usedAssetCounts.get(selected.asset_id) ?? 0) + 1,
			);
		}
		return {
			match_id: section.match_id,
			section_label: section.label,
			section_role: section.role,
			target_start_ms: section.target_start_ms,
			target_duration_ms: section.target_duration_ms,
			selected_asset_id: selected?.asset_id ?? "",
			selected_asset_name: selected?.asset_name ?? "No candidate",
			selected_range_id: selected?.range_id ?? "",
			selected_start_ms: selected?.start_ms ?? 0,
			selected_end_ms: selected?.end_ms ?? section.target_duration_ms,
			reasons: selected?.reasons ?? [section.description],
			candidates: rankedCandidates,
			locked: Boolean(locked),
		};
	});
}

export function buildFootageMatchReadiness({
	referenceShotPlan,
	sourceAssetCount,
	candidateMatches,
}: {
	referenceShotPlan: ReferenceShotPlan | null;
	sourceAssetCount: number;
	candidateMatches: ReferenceDraftSectionMatch[];
}) {
	if (!referenceShotPlan) {
		return {
			ready: false,
			status: "attention" as const,
			reason: "Analyze a reference video before building a reference-guided draft.",
		};
	}
	if (sourceAssetCount === 0) {
		return {
			ready: false,
			status: "blocked" as const,
			reason: "Choose at least one source video for AI draft assembly.",
		};
	}
	if (candidateMatches.length === 0) {
		return {
			ready: false,
			status: "attention" as const,
			reason: "Source descriptors are incomplete, so draft matching may need more indexing.",
		};
	}
	return {
		ready: true,
		status: sourceAssetCount === 1 ? ("attention" as const) : ("ready" as const),
		reason:
			sourceAssetCount === 1
				? "Only one source clip is available, so the draft may reuse the same footage across multiple reference sections."
				: `${candidateMatches.length} reference sections are ready for source-footage matching.`,
	};
}

export function summarizeFootageDescriptor({
	descriptor,
}: {
	descriptor: FootageDescriptor | null;
}): string {
	if (!descriptor) {
		return "Descriptor unavailable";
	}
	return `${descriptor.activity_intensity} energy · ${descriptor.scene_cut_count} cuts · ${
		descriptor.transcript_cues[0] ?? "visual cue"
	}`;
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
