import {
	DEFAULT_BLEND_MODE,
	DEFAULT_OPACITY,
	DEFAULT_TRANSFORM,
} from "@/constants/timeline-constants";
import { DEFAULT_TEXT_ELEMENT } from "@/constants/text-constants";
import {
	DEFAULT_PROJECT_AUDIO_SETTINGS,
	buildDefaultProjectVersionPack,
} from "@/constants/project-constants";
import type { MediaAsset } from "@/types/assets";
import type {
	ClipMediaMetadata,
	MusicTrackAnalysis,
	ReferenceCaptionOcrWord,
	ReferenceEditAnalysis,
	ReferenceRecreationPlan,
	SourceRecreationAnalysis,
} from "@/types/clipforge";
import type { TProject } from "@/types/project";
import type {
	AudioTrack,
	TextElement,
	TextTrack,
	TimelineTrack,
	VideoTrack,
} from "@/types/timeline";
import { generateUUID } from "@/utils/id";
import { generateCaptionChunksFromWords } from "./caption-generator";
import { createCaptionTextElements } from "./caption-studio";
import { ensureClipForgeProjectData } from "./project-data";
import { buildWordsFromSegments } from "./transcription";

const DEFAULT_REFERENCE_CUT_MS = 1500;
const MIN_CUT_MS = 320;
const TARGET_CANVAS_WIDTH = 1080;
const TARGET_CANVAS_HEIGHT = 1920;
const SUSPICIOUS_CAPTION_TERMS = new Set(["fuck", "fucking"]);

export interface BuildReferenceRecreationPlanInput {
	project: TProject;
	mediaAssets: MediaAsset[];
	referenceAssetId: string;
	sourceAssetIds: string[];
	musicAssetId?: string | null;
}

export interface BuildReferenceRecreationDraftResult {
	project: TProject;
	plan: ReferenceRecreationPlan;
	referenceEditAnalysis: ReferenceEditAnalysis;
	sourceAnalyses: Record<string, SourceRecreationAnalysis>;
	musicAnalysis: MusicTrackAnalysis | null;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function normalizeWordToken(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function aspectRatioPreset({
	width,
	height,
}: {
	width?: number;
	height?: number;
}): ReferenceEditAnalysis["aspect_ratio"] {
	if (typeof width !== "number" || typeof height !== "number" || height <= 0) {
		return "unknown";
	}
	const ratio = width / height;
	if (ratio < 0.8) return "9:16";
	if (ratio > 1.3) return "16:9";
	return "1:1";
}

function normalizeCutPoints({
	durationMs,
	sceneCutsSeconds,
}: {
	durationMs: number;
	sceneCutsSeconds: number[];
}): number[] {
	const detected = sceneCutsSeconds
		.map((cut) => Math.round(cut * 1000))
		.filter((cut) => cut >= MIN_CUT_MS && cut <= durationMs - MIN_CUT_MS)
		.sort((left, right) => left - right);
	const deduped = detected.filter(
		(cut, index) => index === 0 || cut - (detected[index - 1] ?? 0) >= 260,
	);
	if (deduped.length > 0) {
		return deduped;
	}

	const generated: number[] = [];
	for (
		let cursor = DEFAULT_REFERENCE_CUT_MS;
		cursor < durationMs - MIN_CUT_MS;
		cursor += DEFAULT_REFERENCE_CUT_MS
	) {
		generated.push(cursor);
	}
	return generated;
}

function buildReferenceCaptionOcrAnalysis({
	metadata,
}: {
	metadata: ClipMediaMetadata | null;
}): ReferenceEditAnalysis["caption_ocr"] {
	const words = (metadata?.words ?? [])
		.filter((word) => word.end_ms > word.start_ms && word.text.trim())
		.map(
			(word): ReferenceCaptionOcrWord => ({
				text: word.text,
				start_ms: word.start_ms,
				end_ms: word.end_ms,
				confidence: 0.82,
				source: "metadata",
			}),
		);

	if (words.length === 0) {
		return {
			source: "none",
			words: [],
			confidence: 0,
			warnings: [
				"Reference caption OCR has not been run yet; exact CapCut caption words must be reviewed or generated from source transcript.",
			],
		};
	}

	return {
		source: "metadata",
		words,
		confidence: 0.82,
		warnings: [
			"Reference caption words came from stored transcript metadata; replace with frame OCR when available for exact CapCut text.",
		],
	};
}

export function buildReferenceEditAnalysis({
	asset,
	metadata,
}: {
	asset: MediaAsset;
	metadata: ClipMediaMetadata | null;
}): ReferenceEditAnalysis {
	const durationMs = Math.max(1, Math.round((asset.duration ?? 0) * 1000));
	const cutPoints = normalizeCutPoints({
		durationMs,
		sceneCutsSeconds: asset.visualAnalysis?.sceneCuts ?? [],
	});
	const averageCutMs =
		cutPoints.length > 0
			? Math.round(durationMs / (cutPoints.length + 1))
			: null;
	const captionOcr = buildReferenceCaptionOcrAnalysis({ metadata });
	const warnings: string[] = [];
	if (!asset.visualAnalysis || asset.visualAnalysis.sceneCuts.length === 0) {
		warnings.push(
			"Reference cut boundaries are estimated because frame-difference analysis has not found stable scene cuts yet.",
		);
	}
	if (captionOcr.words.length === 0) {
		warnings.push(
			captionOcr.warnings[0] ?? "Reference caption OCR is missing.",
		);
	}
	if (!asset.beatAnalysis) {
		warnings.push(
			"Reference beat analysis is unavailable, so music sync uses the imported track from the start of the edit.",
		);
	}

	return {
		analyzedAt: new Date().toISOString(),
		reference_asset_id: asset.id,
		duration_ms: durationMs,
		aspect_ratio: aspectRatioPreset({
			width: asset.width,
			height: asset.height,
		}),
		cut_points_ms: cutPoints,
		cut_count: cutPoints.length,
		average_cut_ms: averageCutMs,
		caption_style: {
			mode: "word",
			text_transform: "uppercase",
			style_id: "reference-word-pop",
			font: "Anton",
			size: 78,
			position: "bottom",
			fill_color: "#FFFFFF",
			outline_color: "#000000",
			outline: true,
			shadow: true,
			safe_zone: "lower-center",
		},
		caption_ocr: captionOcr,
		audio_mix: {
			target_lufs: -11,
			true_peak_db: -0.7,
			voice_gain_db: 11,
			music_volume: 0.28,
			ducking_amount: 0.62,
			ducking_attack_ms: 70,
			ducking_release_ms: 260,
			soft_limiter: true,
			noise_reduction_enabled: true,
			noise_reduction_strength: 0.72,
			wind_reduction_enabled: true,
		},
		color_profile: "bt709-social",
		warnings,
	};
}

function buildSpeechRangesFromWords({
	assetId,
	words,
}: {
	assetId: string;
	words: ClipMediaMetadata["words"];
}): SourceRecreationAnalysis["speech_ranges"] {
	const sortedWords = [...words]
		.filter(
			(word) => word.end_ms > word.start_ms && word.text.trim().length > 0,
		)
		.sort((left, right) => left.start_ms - right.start_ms);
	const ranges: SourceRecreationAnalysis["speech_ranges"] = [];
	let current: typeof sortedWords = [];

	const flush = () => {
		if (current.length === 0) return;
		const first = current[0];
		const last = current[current.length - 1];
		if (!first || !last) {
			current = [];
			return;
		}
		const startMs = first.start_ms;
		const endMs = last.end_ms;
		const durationS = Math.max(0.3, (endMs - startMs) / 1000);
		const speechDensity = current.length / durationS;
		ranges.push({
			range_id: `${assetId}:speech:${ranges.length + 1}`,
			start_ms: startMs,
			end_ms: endMs,
			word_count: current.length,
			speech_density: Number(speechDensity.toFixed(2)),
			confidence: Number(clamp(speechDensity / 3.2, 0.35, 0.98).toFixed(2)),
			reasons: [
				speechDensity >= 2
					? "Dense source speech suitable for jump cuts."
					: "Source speech is usable but may need manual tightening.",
			],
		});
		current = [];
	};

	for (const word of sortedWords) {
		const previous = current[current.length - 1];
		if (previous && word.start_ms - previous.end_ms > 650) {
			flush();
		}
		current.push(word);
	}
	flush();

	return ranges.filter((range) => range.end_ms - range.start_ms >= 300);
}

function buildFallbackSpeechRanges({
	asset,
	metadata,
	durationMs,
}: {
	asset: MediaAsset;
	metadata: ClipMediaMetadata | null;
	durationMs: number;
}): SourceRecreationAnalysis["speech_ranges"] {
	const transcriptRanges = (metadata?.segments ?? [])
		.filter((segment) => segment.end_ms > segment.start_ms)
		.map((segment, index) => ({
			range_id: `${asset.id}:segment:${index + 1}`,
			start_ms: segment.start_ms,
			end_ms: segment.end_ms,
			word_count: segment.text.trim().split(/\s+/).filter(Boolean).length,
			speech_density: 1,
			confidence: 0.55,
			reasons: [
				"Transcript segment used because word timings are unavailable.",
			],
		}));
	if (transcriptRanges.length > 0) {
		return transcriptRanges;
	}

	const windows = asset.visualAnalysis?.activityWindows ?? [];
	if (windows.length > 0) {
		return windows.map((window, index) => ({
			range_id: `${asset.id}:activity:${index + 1}`,
			start_ms: Math.round(window.startTime * 1000),
			end_ms: Math.round(window.endTime * 1000),
			word_count: 0,
			speech_density: 0,
			confidence: Number(clamp(window.score, 0.25, 0.7).toFixed(2)),
			reasons: [
				"Visual activity used because transcript metadata is unavailable.",
			],
		}));
	}

	const ranges: SourceRecreationAnalysis["speech_ranges"] = [];
	for (let cursor = 0; cursor < durationMs; cursor += 5000) {
		ranges.push({
			range_id: `${asset.id}:fallback:${ranges.length + 1}`,
			start_ms: cursor,
			end_ms: Math.min(durationMs, cursor + 5000),
			word_count: 0,
			speech_density: 0,
			confidence: 0.25,
			reasons: [
				"Timing fallback used because no transcript or activity analysis is available.",
			],
		});
	}
	return ranges;
}

function buildSpeechRangesFromSilenceRegions({
	assetId,
	durationMs,
	silenceRegions,
}: {
	assetId: string;
	durationMs: number;
	silenceRegions: ClipMediaMetadata["silenceRegions"];
}): SourceRecreationAnalysis["speech_ranges"] {
	const sortedSilences = [...silenceRegions]
		.filter((region) => region.end_ms > region.start_ms)
		.sort((left, right) => left.start_ms - right.start_ms);
	const ranges: SourceRecreationAnalysis["speech_ranges"] = [];
	let cursorMs = 0;

	for (const silence of sortedSilences) {
		const startMs = clamp(Math.round(silence.start_ms), 0, durationMs);
		const endMs = clamp(Math.round(silence.end_ms), startMs, durationMs);
		if (startMs - cursorMs >= 120) {
			const durationS = Math.max(0.2, (startMs - cursorMs) / 1000);
			const dense = durationS > 1.8;
			ranges.push({
				range_id: `${assetId}:vad:${ranges.length + 1}`,
				start_ms: cursorMs,
				end_ms: startMs,
				word_count: 0,
				speech_density: 0,
				confidence: dense ? 0.72 : 0.62,
				reasons: dense
					? ["Dense non-silent source region derived from dead-air analysis."]
					: ["Non-silent source region derived from dead-air analysis."],
			});
		}
		cursorMs = Math.max(cursorMs, endMs);
	}

	if (durationMs - cursorMs >= 120) {
		ranges.push({
			range_id: `${assetId}:vad:${ranges.length + 1}`,
			start_ms: cursorMs,
			end_ms: durationMs,
			word_count: 0,
			speech_density: 0,
			confidence: 0.62,
			reasons: ["Non-silent source region derived from dead-air analysis."],
		});
	}

	return ranges;
}

export function buildSourceRecreationAnalysis({
	asset,
	metadata,
}: {
	asset: MediaAsset;
	metadata: ClipMediaMetadata | null;
}): SourceRecreationAnalysis {
	const durationMs = Math.max(1, Math.round((asset.duration ?? 0) * 1000));
	const wordRanges = buildSpeechRangesFromWords({
		assetId: asset.id,
		words: metadata?.words ?? [],
	});
	const vadRanges =
		wordRanges.length === 0 && metadata?.silenceRegions.length
			? buildSpeechRangesFromSilenceRegions({
					assetId: asset.id,
					durationMs,
					silenceRegions: metadata.silenceRegions,
				})
			: [];
	const speechRanges =
		wordRanges.length > 0
			? wordRanges
			: vadRanges.length > 0
				? vadRanges
				: buildFallbackSpeechRanges({
						asset,
						metadata,
						durationMs,
					});
	const warnings: string[] = [];
	if (!metadata || (metadata.words.length === 0 && vadRanges.length === 0)) {
		warnings.push(
			"Source word timings are unavailable, so cut selection falls back to transcript segments or visual activity.",
		);
	}
	if (vadRanges.length > 0) {
		warnings.push(
			"Source transcript words are unavailable; recreation cut ranges use dead-air analysis.",
		);
	}
	if (!asset.visualAnalysis) {
		warnings.push(
			"Face-aware framing is approximated with center-crop because visual analysis is unavailable.",
		);
	}

	return {
		analyzedAt: new Date().toISOString(),
		asset_id: asset.id,
		duration_ms: durationMs,
		aspect_ratio: aspectRatioPreset({
			width: asset.width,
			height: asset.height,
		}),
		speech_ranges: speechRanges,
		dead_air_ranges: metadata?.silenceRegions ?? [],
		face_framing: "unknown",
		warnings,
	};
}

export function buildMusicTrackAnalysis({
	asset,
}: {
	asset: MediaAsset;
}): MusicTrackAnalysis {
	const rightsProfile =
		asset.rightsProfile === "universal"
			? "universal"
			: asset.musicSourceType === "user-imported"
				? "user-managed"
				: "unknown";
	return {
		analyzedAt: new Date().toISOString(),
		asset_id: asset.id,
		duration_ms: Math.max(1, Math.round((asset.duration ?? 0) * 1000)),
		bpm: asset.beatAnalysis?.bpm ?? null,
		recommended_volume: 0.28,
		loop_to_project_end: true,
		rights_profile: rightsProfile,
		warnings:
			rightsProfile === "unknown"
				? [
						"Music rights are unknown; treat this as user-managed until confirmed.",
					]
				: [],
	};
}

function resolveMusicAsset({
	mediaAssets,
	musicAssetId,
}: {
	mediaAssets: MediaAsset[];
	musicAssetId?: string | null;
}): (MediaAsset & { type: "audio" }) | null {
	if (musicAssetId) {
		return (
			mediaAssets.find(
				(asset): asset is MediaAsset & { type: "audio" } =>
					asset.id === musicAssetId && asset.type === "audio",
			) ?? null
		);
	}

	const importedAudio = mediaAssets
		.filter(
			(asset): asset is MediaAsset & { type: "audio" } =>
				asset.type === "audio" && !asset.ephemeral,
		)
		.sort((left, right) => {
			const leftImported = left.musicSourceType === "user-imported" ? 0 : 1;
			const rightImported = right.musicSourceType === "user-imported" ? 0 : 1;
			if (leftImported !== rightImported) return leftImported - rightImported;
			const leftNameScore = /\b(music|song|instrumental|beat|track)\b/i.test(
				left.name,
			)
				? 0
				: 1;
			const rightNameScore = /\b(music|song|instrumental|beat|track)\b/i.test(
				right.name,
			)
				? 0
				: 1;
			if (leftNameScore !== rightNameScore)
				return leftNameScore - rightNameScore;
			return left.name.localeCompare(right.name);
		});
	return importedAudio[0] ?? null;
}

function buildTimelineBoundaries({
	durationMs,
	cutPointsMs,
}: {
	durationMs: number;
	cutPointsMs: number[];
}) {
	const boundaries = [
		0,
		...cutPointsMs.filter((point) => point > 0 && point < durationMs),
		durationMs,
	].sort((left, right) => left - right);
	return boundaries
		.slice(0, -1)
		.map((startMs, index) => ({
			start_ms: startMs,
			end_ms: boundaries[index + 1] ?? durationMs,
		}))
		.filter((range) => range.end_ms - range.start_ms >= MIN_CUT_MS);
}

function wordsInRange({
	words,
	startMs,
	endMs,
}: {
	words: ClipMediaMetadata["words"];
	startMs: number;
	endMs: number;
}): ClipMediaMetadata["words"] {
	return words.filter((word) => {
		const midpointMs = (word.start_ms + word.end_ms) / 2;
		return midpointMs >= startMs && midpointMs < endMs;
	});
}

function tokenSequence(words: Array<{ text: string }>): string[] {
	return words
		.map((word) => normalizeWordToken(word.text))
		.filter((token) => token.length > 0);
}

function orderedTokenOverlap({
	sourceTokens,
	referenceTokens,
}: {
	sourceTokens: string[];
	referenceTokens: string[];
}): number {
	if (referenceTokens.length === 0) return 0.5;
	if (sourceTokens.length === 0) return 0;
	let sourceIndex = 0;
	let matched = 0;
	for (const token of referenceTokens) {
		while (sourceIndex < sourceTokens.length) {
			const sourceToken = sourceTokens[sourceIndex];
			sourceIndex += 1;
			if (sourceToken === token) {
				matched += 1;
				break;
			}
		}
	}
	return clamp(matched / referenceTokens.length, 0, 1);
}

function boundaryReferenceWords({
	referenceWords,
	boundary,
}: {
	referenceWords: ReferenceCaptionOcrWord[];
	boundary: { start_ms: number; end_ms: number };
}): ReferenceCaptionOcrWord[] {
	return referenceWords.filter((word) => {
		const midpointMs = (word.start_ms + word.end_ms) / 2;
		return midpointMs >= boundary.start_ms && midpointMs < boundary.end_ms;
	});
}

function silenceBoundaryScore({
	silenceRegions,
	startMs,
	endMs,
}: {
	silenceRegions: ClipMediaMetadata["silenceRegions"];
	startMs: number;
	endMs: number;
}): number {
	if (silenceRegions.length === 0) return 0.65;
	const insideSilence = (timeMs: number) =>
		silenceRegions.some(
			(region) => timeMs >= region.start_ms && timeMs <= region.end_ms,
		);
	const overlapsSilence = silenceRegions.some(
		(region) => startMs < region.end_ms && endMs > region.start_ms,
	);
	let score = 0.75;
	if (!insideSilence(startMs)) score += 0.12;
	if (!insideSilence(endMs)) score += 0.08;
	if (overlapsSilence) score -= 0.22;
	return clamp(score, 0, 1);
}

function activityScoreForRange({
	asset,
	startMs,
	endMs,
}: {
	asset: MediaAsset;
	startMs: number;
	endMs: number;
}): number {
	const windows = asset.visualAnalysis?.activityWindows ?? [];
	if (windows.length === 0) return 0.45;
	let weightedScore = 0;
	let coveredMs = 0;
	for (const window of windows) {
		const windowStartMs = Math.round(window.startTime * 1000);
		const windowEndMs = Math.round(window.endTime * 1000);
		const overlapMs = Math.max(
			0,
			Math.min(endMs, windowEndMs) - Math.max(startMs, windowStartMs),
		);
		if (overlapMs <= 0) continue;
		weightedScore += overlapMs * clamp(window.score, 0, 1);
		coveredMs += overlapMs;
	}
	if (coveredMs <= 0) return 0.45;
	return clamp(weightedScore / coveredMs, 0, 1);
}

function candidateStartPoints({
	range,
	sourceWords,
	referenceTokens,
	minSourceStartMs,
}: {
	range: SourceRecreationAnalysis["speech_ranges"][number];
	sourceWords: ClipMediaMetadata["words"];
	referenceTokens: string[];
	minSourceStartMs: number;
}): number[] {
	const starts = new Set<number>([
		Math.max(range.start_ms, minSourceStartMs),
		range.start_ms,
	]);
	const referenceTokenSet = new Set(referenceTokens);
	for (const word of sourceWords) {
		if (word.start_ms < range.start_ms || word.start_ms >= range.end_ms) {
			continue;
		}
		if (word.start_ms < minSourceStartMs) continue;
		const token = normalizeWordToken(word.text);
		if (referenceTokenSet.size === 0 || referenceTokenSet.has(token)) {
			starts.add(word.start_ms);
		}
	}
	return [...starts]
		.filter((startMs) => startMs >= range.start_ms && startMs < range.end_ms)
		.sort((left, right) => left - right)
		.slice(0, 32);
}

function buildSourceRangesForPlan({
	sources,
	boundaries,
	mediaMetadataById,
	referenceWords,
}: {
	sources: Array<{ asset: MediaAsset; analysis: SourceRecreationAnalysis }>;
	boundaries: Array<{ start_ms: number; end_ms: number }>;
	mediaMetadataById: Record<string, ClipMediaMetadata>;
	referenceWords: ReferenceCaptionOcrWord[];
}): ReferenceRecreationPlan["source_ranges"] {
	const targetDurationMs = boundaries.at(-1)?.end_ms ?? 0;
	const ranges: ReferenceRecreationPlan["source_ranges"] = [];
	let timelineCursorMs = 0;
	const sourceCursorByAsset = new Map<string, number>();

	for (const boundary of boundaries) {
		if (timelineCursorMs >= targetDurationMs) break;
		const requestedDurationMs = boundary.end_ms - boundary.start_ms;
		const targetRemainingMs = targetDurationMs - timelineCursorMs;
		const targetClipMs = Math.min(requestedDurationMs, targetRemainingMs);
		const referenceBoundaryWords = boundaryReferenceWords({
			referenceWords,
			boundary,
		});
		const referenceTokens = tokenSequence(referenceBoundaryWords);
		let bestCandidate: {
			asset: MediaAsset;
			range: SourceRecreationAnalysis["speech_ranges"][number];
			sourceStartMs: number;
			sourceEndMs: number;
			durationMs: number;
			scoreBreakdown: ReferenceRecreationPlan["source_ranges"][number]["score_breakdown"];
			agentScore: number;
		} | null = null;

		for (const { asset, analysis } of sources) {
			const metadata = mediaMetadataById[asset.id];
			const sourceWords =
				metadata?.words && metadata.words.length > 0
					? metadata.words
					: buildWordsFromSegments({ segments: metadata?.segments ?? [] });
			const minSourceStartMs = sourceCursorByAsset.get(asset.id) ?? 0;
			const assetDurationMs = Math.max(
				1,
				Math.round((asset.duration ?? 0) * 1000),
			);

			for (const range of analysis.speech_ranges
				.filter((candidate) => candidate.end_ms - candidate.start_ms >= 120)
				.sort((left, right) => left.start_ms - right.start_ms)) {
				if (range.end_ms <= minSourceStartMs + 80) continue;
				const starts = candidateStartPoints({
					range,
					sourceWords,
					referenceTokens,
					minSourceStartMs,
				});
				for (const startMs of starts) {
					const sourceStartMs = clamp(
						startMs,
						minSourceStartMs,
						assetDurationMs,
					);
					const sourceEndMs = clamp(
						sourceStartMs + targetClipMs,
						sourceStartMs,
						Math.min(range.end_ms, assetDurationMs),
					);
					const durationMs = sourceEndMs - sourceStartMs;
					if (durationMs < 120) continue;
					const sourceRangeWords = wordsInRange({
						words: sourceWords,
						startMs: sourceStartMs,
						endMs: sourceEndMs,
					});
					const sourceTokens = tokenSequence(sourceRangeWords);
					const scoreBreakdown = {
						speech: clamp(range.confidence, 0, 1),
						pause: silenceBoundaryScore({
							silenceRegions: metadata?.silenceRegions ?? [],
							startMs: sourceStartMs,
							endMs: sourceEndMs,
						}),
						semantic: orderedTokenOverlap({
							sourceTokens,
							referenceTokens,
						}),
						activity: activityScoreForRange({
							asset,
							startMs: sourceStartMs,
							endMs: sourceEndMs,
						}),
						cadence: clamp(
							1 -
								Math.abs(durationMs - targetClipMs) / Math.max(targetClipMs, 1),
							0,
							1,
						),
					};
					const agentScore =
						scoreBreakdown.speech * 0.28 +
						scoreBreakdown.semantic * 0.22 +
						scoreBreakdown.pause * 0.18 +
						scoreBreakdown.activity * 0.16 +
						scoreBreakdown.cadence * 0.16;
					if (!bestCandidate || agentScore > bestCandidate.agentScore) {
						bestCandidate = {
							asset,
							range,
							sourceStartMs,
							sourceEndMs,
							durationMs,
							scoreBreakdown,
							agentScore,
						};
					}
				}
			}
		}

		if (!bestCandidate) continue;
		const reasons = [
			`Edit-selection agent score ${bestCandidate.agentScore.toFixed(2)} from speech, pause, semantic, visual activity, and reference cadence signals.`,
			...bestCandidate.range.reasons,
		];
		if (
			referenceTokens.length > 0 &&
			bestCandidate.scoreBreakdown.semantic > 0
		) {
			reasons.push(
				`Matched ${Math.round(
					bestCandidate.scoreBreakdown.semantic * 100,
				)}% of the reference caption tokens for this cut.`,
			);
		}
		ranges.push({
			range_id: `${bestCandidate.asset.id}:recreate:${ranges.length + 1}`,
			source_asset_id: bestCandidate.asset.id,
			source_asset_name: bestCandidate.asset.name,
			source_start_ms: bestCandidate.sourceStartMs,
			source_end_ms: bestCandidate.sourceEndMs,
			timeline_start_ms: timelineCursorMs,
			target_duration_ms: bestCandidate.durationMs,
			confidence: Number(bestCandidate.agentScore.toFixed(2)),
			agent_score: Number(bestCandidate.agentScore.toFixed(3)),
			score_breakdown: {
				speech: Number(bestCandidate.scoreBreakdown.speech.toFixed(3)),
				pause: Number(bestCandidate.scoreBreakdown.pause.toFixed(3)),
				semantic: Number(bestCandidate.scoreBreakdown.semantic.toFixed(3)),
				activity: Number(bestCandidate.scoreBreakdown.activity.toFixed(3)),
				cadence: Number(bestCandidate.scoreBreakdown.cadence.toFixed(3)),
			},
			reasons,
		});
		timelineCursorMs += bestCandidate.durationMs;
		sourceCursorByAsset.set(bestCandidate.asset.id, bestCandidate.sourceEndMs);
	}

	return ranges;
}

function buildCaptionCorrectionReview({
	sourceMetadata,
	referenceWords,
}: {
	sourceMetadata: ClipMediaMetadata[];
	referenceWords: ReferenceCaptionOcrWord[];
}): { terms: string[]; warnings: string[] } {
	const referenceTokenSet = new Set(tokenSequence(referenceWords));
	const terms = new Set<string>();
	for (const metadata of sourceMetadata) {
		const words =
			metadata.words.length > 0
				? metadata.words
				: buildWordsFromSegments({ segments: metadata.segments });
		for (const word of words) {
			const token = normalizeWordToken(word.text);
			if (!SUSPICIOUS_CAPTION_TERMS.has(token)) continue;
			if (referenceTokenSet.size === 0 || !referenceTokenSet.has(token)) {
				terms.add(token);
			}
		}
	}

	const warnings: string[] = [];
	if (terms.size > 0) {
		warnings.push(
			`Auto captions include terms that should be manually reviewed before export: ${[...terms].join(", ")}.`,
		);
	}
	if (referenceWords.length === 0) {
		warnings.push(
			"Run reference caption OCR or manually correct the transcript before final captions; this draft is using the source transcript.",
		);
	}
	for (const metadata of sourceMetadata) {
		if (
			metadata.transcriptionProvider === "browser-whisper" &&
			metadata.words.length === 0 &&
			metadata.segments.length > 0
		) {
			warnings.push(
				"Browser Whisper returned chunk-level timings for at least one source; word caption timing is approximated and should be reviewed.",
			);
			break;
		}
	}

	return { terms: [...terms], warnings };
}

export function buildReferenceRecreationPlan({
	project,
	mediaAssets,
	referenceAssetId,
	sourceAssetIds,
	musicAssetId = null,
}: BuildReferenceRecreationPlanInput): {
	plan: ReferenceRecreationPlan;
	referenceEditAnalysis: ReferenceEditAnalysis;
	sourceAnalyses: Record<string, SourceRecreationAnalysis>;
	musicAnalysis: MusicTrackAnalysis | null;
} {
	const clipforgeProject = ensureClipForgeProjectData({ project });
	const referenceAsset = mediaAssets.find(
		(asset) => asset.id === referenceAssetId && asset.type === "video",
	);
	if (!referenceAsset) {
		throw new Error("Reference recreation requires a video reference asset.");
	}
	const sourceAssets = sourceAssetIds
		.map((assetId) =>
			mediaAssets.find(
				(asset): asset is MediaAsset & { type: "video" } =>
					asset.id === assetId && asset.type === "video" && !asset.ephemeral,
			),
		)
		.filter((asset): asset is MediaAsset & { type: "video" } => Boolean(asset));
	if (sourceAssets.length === 0) {
		throw new Error(
			"Reference recreation requires at least one source video asset.",
		);
	}

	const referenceEditAnalysis =
		clipforgeProject.clipforge.referenceEditAnalysisByAssetId[
			referenceAsset.id
		] ??
		buildReferenceEditAnalysis({
			asset: referenceAsset,
			metadata:
				clipforgeProject.clipforge.mediaMetadataById[referenceAsset.id] ?? null,
		});
	const sourceAnalyses = Object.fromEntries(
		sourceAssets.map((asset) => [
			asset.id,
			clipforgeProject.clipforge.sourceRecreationAnalysisByAssetId[asset.id] ??
				buildSourceRecreationAnalysis({
					asset,
					metadata:
						clipforgeProject.clipforge.mediaMetadataById[asset.id] ?? null,
				}),
		]),
	);
	const musicAsset = resolveMusicAsset({ mediaAssets, musicAssetId });
	const musicAnalysis = musicAsset
		? (clipforgeProject.clipforge.musicTrackAnalysisByAssetId[musicAsset.id] ??
			buildMusicTrackAnalysis({ asset: musicAsset }))
		: null;
	const boundaries = buildTimelineBoundaries({
		durationMs: referenceEditAnalysis.duration_ms,
		cutPointsMs: referenceEditAnalysis.cut_points_ms,
	});
	const sourceMetadata = sourceAssets
		.map(
			(asset) => clipforgeProject.clipforge.mediaMetadataById[asset.id] ?? null,
		)
		.filter((metadata): metadata is ClipMediaMetadata => Boolean(metadata));
	const referenceWords = referenceEditAnalysis.caption_ocr.words;
	const sourceRanges = buildSourceRangesForPlan({
		sources: sourceAssets.map((asset) => ({
			asset,
			analysis: sourceAnalyses[asset.id] as SourceRecreationAnalysis,
		})),
		boundaries,
		mediaMetadataById: clipforgeProject.clipforge.mediaMetadataById,
		referenceWords,
	});
	const usesWordTimings = sourceMetadata.some(
		(metadata) => metadata.words.length > 0,
	);
	const hasCaptionTranscript = sourceMetadata.some(
		(metadata) => metadata.words.length > 0 || metadata.segments.length > 0,
	);
	const captionReview = buildCaptionCorrectionReview({
		sourceMetadata,
		referenceWords,
	});
	const alignmentConfidence =
		sourceRanges.length > 0
			? sourceRanges.reduce((sum, range) => sum + range.agent_score, 0) /
				sourceRanges.length
			: 0;
	const warnings = [
		...referenceEditAnalysis.warnings,
		...referenceEditAnalysis.caption_ocr.warnings,
		...Object.values(sourceAnalyses).flatMap((analysis) => analysis.warnings),
		...(musicAnalysis?.warnings ?? []),
		...captionReview.warnings,
	];
	if (sourceRanges.length < boundaries.length) {
		warnings.push(
			"Some reference cut slots could not be filled from source analysis and were omitted from the draft.",
		);
	}
	if (!musicAsset) {
		warnings.push(
			"No imported music asset was selected, so the draft will keep only camera audio.",
		);
	}

	const plan: ReferenceRecreationPlan = {
		plan_id: generateUUID(),
		createdAt: new Date().toISOString(),
		reference_asset_id: referenceAsset.id,
		source_asset_ids: sourceAssets.map((asset) => asset.id),
		music_asset_id: musicAsset?.id ?? null,
		target_duration_ms: referenceEditAnalysis.duration_ms,
		cut_points_ms: referenceEditAnalysis.cut_points_ms,
		source_ranges: sourceRanges,
		caption_style: referenceEditAnalysis.caption_style,
		caption_generation: {
			source:
				referenceWords.length > 0
					? "reference-ocr"
					: hasCaptionTranscript
						? "compound-audio"
						: "none",
			template_id: referenceEditAnalysis.caption_style.style_id,
			max_words_per_caption: 1,
			min_display_ms: 160,
			uses_word_timings: referenceWords.length > 0 || usesWordTimings,
			reference_words: referenceWords,
			needs_review_terms: captionReview.terms,
			correction_warnings: captionReview.warnings,
			alignment_confidence: Number(clamp(alignmentConfidence, 0, 1).toFixed(3)),
		},
		audio_mix: musicAnalysis
			? {
					...referenceEditAnalysis.audio_mix,
					music_volume: musicAnalysis.recommended_volume,
				}
			: referenceEditAnalysis.audio_mix,
		crop: {
			target_aspect_ratio: "9:16",
			canvas_width: TARGET_CANVAS_WIDTH,
			canvas_height: TARGET_CANVAS_HEIGHT,
			strategy: sourceAssets.some((asset) => asset.visualAnalysis)
				? "center-face-safe"
				: "center-crop",
		},
		warnings,
	};

	return {
		plan,
		referenceEditAnalysis,
		sourceAnalyses,
		musicAnalysis,
	};
}

function buildMainVideoTrack({
	existingTrack,
	mediaAssets,
	plan,
}: {
	existingTrack: VideoTrack | null;
	mediaAssets: MediaAsset[];
	plan: ReferenceRecreationPlan;
}): { track: VideoTrack; voiceElements: AudioTrack["elements"] } {
	const track: VideoTrack = {
		id: existingTrack?.id ?? generateUUID(),
		type: "video",
		name: existingTrack?.name ?? "Main video",
		isMain: true,
		muted: existingTrack?.muted ?? false,
		hidden: existingTrack?.hidden ?? false,
		elements: [],
	};
	const voiceElements: AudioTrack["elements"] = [];

	const buildFaceSafeCoverTransform = () => ({ ...DEFAULT_TRANSFORM });

	for (const range of plan.source_ranges) {
		const asset = mediaAssets.find(
			(candidate) => candidate.id === range.source_asset_id,
		);
		if (!asset) continue;
		const linkedGroupId = generateUUID();
		const duration = Math.max(0.1, range.target_duration_ms / 1000);
		const trimStart = range.source_start_ms / 1000;
		const trimEnd = Math.max(
			0,
			(asset.duration ?? duration) - range.source_end_ms / 1000,
		);
		const elementId = generateUUID();
		track.elements.push({
			id: elementId,
			type: "video",
			mediaId: asset.id,
			name: `${asset.name} · ${range.range_id.split(":").at(-1) ?? "cut"}`,
			duration,
			startTime: range.timeline_start_ms / 1000,
			trimStart,
			trimEnd,
			fit: "cover",
			muted: true,
			hidden: false,
			transform: buildFaceSafeCoverTransform(),
			opacity: DEFAULT_OPACITY,
			blendMode: DEFAULT_BLEND_MODE,
			linkedGroupId,
		});
		voiceElements.push({
			id: generateUUID(),
			type: "audio",
			sourceType: "upload",
			mediaId: asset.id,
			name: `${asset.name} voice`,
			duration,
			startTime: range.timeline_start_ms / 1000,
			trimStart,
			trimEnd,
			role: "voiceover",
			volume: 1,
			normalizationGainDb: plan.audio_mix.voice_gain_db,
			muted: false,
			playbackRate: 1,
			fadeInDuration: 0,
			fadeOutDuration: 0,
			linkedGroupId,
			animationSfxSync: null,
		});
	}

	return {
		track,
		voiceElements,
	};
}

function normalizeCaptionToken(text: string): string {
	return text
		.trim()
		.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
		.replace(/\s+/g, " ");
}

function buildCompoundCaptionWords({
	plan,
	mediaMetadataById,
}: {
	plan: ReferenceRecreationPlan;
	mediaMetadataById: Record<string, ClipMediaMetadata>;
}): Array<{ text: string; startTime: number; endTime: number }> {
	if (
		plan.caption_generation.source === "reference-ocr" &&
		plan.caption_generation.reference_words.length > 0
	) {
		return plan.caption_generation.reference_words
			.flatMap((word) => {
				const text = normalizeCaptionToken(word.text);
				if (!text || word.end_ms <= word.start_ms) return [];
				return [
					{
						text,
						startTime: word.start_ms / 1000,
						endTime: word.end_ms / 1000,
					},
				];
			})
			.sort((left, right) => left.startTime - right.startTime);
	}

	const wordCache = new Map<string, ClipMediaMetadata["words"]>();
	const getWordsForAsset = (assetId: string) => {
		const cached = wordCache.get(assetId);
		if (cached) return cached;
		const metadata = mediaMetadataById[assetId];
		const words =
			metadata?.words && metadata.words.length > 0
				? metadata.words
				: buildWordsFromSegments({ segments: metadata?.segments ?? [] });
		wordCache.set(assetId, words);
		return words;
	};

	return plan.source_ranges
		.flatMap((range) => {
			const words = getWordsForAsset(range.source_asset_id);
			return words.flatMap((word) => {
				const sourceMidpointMs = (word.start_ms + word.end_ms) / 2;
				if (
					sourceMidpointMs < range.source_start_ms ||
					sourceMidpointMs >= range.source_end_ms
				) {
					return [];
				}
				const sourceStartMs = Math.max(word.start_ms, range.source_start_ms);
				const sourceEndMs = Math.min(word.end_ms, range.source_end_ms);
				if (sourceEndMs <= sourceStartMs) return [];
				const text = normalizeCaptionToken(word.text);
				if (!text) return [];
				const timelineStartMs =
					range.timeline_start_ms + (sourceStartMs - range.source_start_ms);
				const timelineEndMs =
					range.timeline_start_ms + (sourceEndMs - range.source_start_ms);
				if (timelineEndMs - timelineStartMs < 35) return [];
				return [
					{
						text,
						startTime: timelineStartMs / 1000,
						endTime: timelineEndMs / 1000,
					},
				];
			});
		})
		.sort((left, right) => left.startTime - right.startTime);
}

function styleReferenceCaptionElement({
	element,
	plan,
}: {
	element: TextElement;
	plan: ReferenceRecreationPlan;
}): TextElement {
	const content =
		plan.caption_style.text_transform === "uppercase"
			? element.content.toUpperCase()
			: element.content;
	const words = element.captionTiming?.words.map((word) => ({
		...word,
		text:
			plan.caption_style.text_transform === "uppercase"
				? word.text.toUpperCase()
				: word.text,
	}));

	return {
		...element,
		content,
		captionTiming: words ? { words } : null,
		fontFamily: plan.caption_style.font,
		fontSize: plan.caption_style.size,
		fontWeight: "bold",
		color: plan.caption_style.fill_color,
		stroke: plan.caption_style.outline
			? {
					color: plan.caption_style.outline_color,
					width: 5,
				}
			: null,
		textAlign: "center",
		background: {
			...DEFAULT_TEXT_ELEMENT.background,
			color: "transparent",
			paddingX: 0,
			paddingY: 0,
			cornerRadius: 0,
		},
		transform: {
			...element.transform,
			position: {
				...element.transform.position,
				y:
					plan.caption_style.safe_zone === "center"
						? 0
						: Math.round(plan.crop.canvas_height * 0.34),
			},
		},
	};
}

function buildCompoundCaptionElements({
	plan,
	mediaMetadataById,
}: {
	plan: ReferenceRecreationPlan;
	mediaMetadataById: Record<string, ClipMediaMetadata>;
}): TextElement[] {
	const compoundWords = buildCompoundCaptionWords({ plan, mediaMetadataById });
	if (compoundWords.length === 0) return [];

	return generateCaptionChunksFromWords({
		words: compoundWords,
		options: {
			maxWordsPerChunk: plan.caption_generation.max_words_per_caption,
			maxCharsPerLine: 24,
			maxLines: 1,
			minDisplaySeconds: plan.caption_generation.min_display_ms / 1000,
		},
	}).map((chunk, index): TextElement => {
		const base: TextElement = {
			...DEFAULT_TEXT_ELEMENT,
			id: generateUUID(),
			role: "caption",
			captionTiming: chunk.words ? { words: chunk.words } : null,
			name: `Caption ${index + 1}`,
			content: chunk.text,
			duration: chunk.duration,
			startTime: chunk.startTime,
		};
		return styleReferenceCaptionElement({ element: base, plan });
	});
}

function buildCaptionTrack({
	project,
	existingTrack,
	plan,
}: {
	project: TProject;
	existingTrack: TextTrack | null;
	plan: ReferenceRecreationPlan;
}): TextTrack {
	const styledProject = {
		...project,
		clipforge: {
			...ensureClipForgeProjectData({ project }).clipforge,
			activeCaptionStyleId: plan.caption_style.style_id,
			captionStylesById: {
				...ensureClipForgeProjectData({ project }).clipforge.captionStylesById,
				[plan.caption_style.style_id]: {
					style_id: plan.caption_style.style_id,
					font: plan.caption_style.font,
					size: plan.caption_style.size,
					position: plan.caption_style.position,
					outline: plan.caption_style.outline,
					highlight_mode: "word",
					reveal_preset_id: "pop-line",
					sound_sync_preset_id: "caption-pop-bright",
				},
			},
		},
	} as TProject;
	const compoundGenerated =
		plan.caption_generation.source === "compound-audio" ||
		plan.caption_generation.source === "reference-ocr"
			? buildCompoundCaptionElements({
					plan,
					mediaMetadataById: ensureClipForgeProjectData({ project }).clipforge
						.mediaMetadataById,
				})
			: [];
	const generated =
		compoundGenerated.length > 0
			? compoundGenerated
			: createCaptionTextElements({
					project: styledProject,
					styleId: plan.caption_style.style_id,
					options: {
						maxWordsPerChunk: 1,
						maxCharsPerLine: 16,
						maxLines: 1,
						minDisplaySeconds: 0.16,
					},
				}).map(
					(element): TextElement =>
						styleReferenceCaptionElement({ element, plan }),
				);

	return {
		id: existingTrack?.id ?? generateUUID(),
		type: "text",
		name: existingTrack?.name ?? "Captions",
		hidden: existingTrack?.hidden ?? false,
		elements: generated,
	};
}

function buildAudioTrack({
	existingTrack,
	plan,
	mediaAssets,
	voiceElements,
}: {
	existingTrack: AudioTrack | null;
	plan: ReferenceRecreationPlan;
	mediaAssets: MediaAsset[];
	voiceElements: AudioTrack["elements"];
}): AudioTrack | null {
	const musicAsset = plan.music_asset_id
		? mediaAssets.find(
				(asset) => asset.id === plan.music_asset_id && asset.type === "audio",
			)
		: null;
	const elements = [...voiceElements].sort(
		(left, right) => left.startTime - right.startTime,
	);
	if (musicAsset) {
		const musicDurationMs = Math.max(
			1,
			Math.round((musicAsset.duration ?? 0) * 1000),
		);
		let cursorMs = 0;
		while (cursorMs < plan.target_duration_ms) {
			const durationMs = Math.min(
				musicDurationMs,
				plan.target_duration_ms - cursorMs,
			);
			elements.push({
				id: generateUUID(),
				type: "audio",
				sourceType: "upload",
				mediaId: musicAsset.id,
				name: musicAsset.name,
				duration: durationMs / 1000,
				startTime: cursorMs / 1000,
				trimStart: 0,
				trimEnd: Math.max(
					0,
					(musicAsset.duration ?? durationMs / 1000) - durationMs / 1000,
				),
				role: "music",
				volume: plan.audio_mix.music_volume,
				normalizationGainDb: null,
				muted: false,
				playbackRate: 1,
				fadeInDuration: cursorMs === 0 ? 0.12 : 0,
				fadeOutDuration:
					cursorMs + durationMs >= plan.target_duration_ms ? 0.28 : 0,
				linkedGroupId: null,
				animationSfxSync: null,
			});
			cursorMs += musicDurationMs;
		}
	}

	if (elements.length === 0) {
		return null;
	}

	return {
		id: existingTrack?.id ?? generateUUID(),
		type: "audio",
		name: existingTrack?.name ?? "Audio",
		muted: existingTrack?.muted ?? false,
		volume: existingTrack?.volume ?? 1,
		elements: elements.sort((left, right) => left.startTime - right.startTime),
	};
}

export function buildReferenceRecreationDraft({
	project,
	mediaAssets,
	referenceAssetId,
	sourceAssetIds,
	musicAssetId = null,
}: BuildReferenceRecreationPlanInput): BuildReferenceRecreationDraftResult {
	const baseProject = structuredClone(ensureClipForgeProjectData({ project }));
	const activeScene =
		baseProject.scenes.find(
			(scene) => scene.id === baseProject.currentSceneId,
		) ??
		baseProject.scenes[0] ??
		null;
	if (!activeScene) {
		throw new Error("Reference recreation requires an active scene.");
	}

	const { plan, referenceEditAnalysis, sourceAnalyses, musicAnalysis } =
		buildReferenceRecreationPlan({
			project: baseProject,
			mediaAssets,
			referenceAssetId,
			sourceAssetIds,
			musicAssetId,
		});
	const existingMainTrack =
		activeScene.tracks.find(
			(track): track is VideoTrack =>
				track.type === "video" && track.isMain === true,
		) ?? null;
	const existingCaptionTrack =
		activeScene.tracks.find(
			(track): track is TextTrack => track.type === "text",
		) ?? null;
	const existingAudioTrack =
		activeScene.tracks.find(
			(track): track is AudioTrack => track.type === "audio",
		) ?? null;
	const main = buildMainVideoTrack({
		existingTrack: existingMainTrack,
		mediaAssets,
		plan,
	});
	const sceneForCaptions = {
		...baseProject,
		scenes: baseProject.scenes.map((scene) =>
			scene.id === activeScene.id
				? {
						...scene,
						tracks: [main.track],
					}
				: scene,
		),
	};
	const captionTrack = buildCaptionTrack({
		project: sceneForCaptions,
		existingTrack: existingCaptionTrack,
		plan,
	});
	const audioTrack = buildAudioTrack({
		existingTrack: existingAudioTrack,
		plan,
		mediaAssets,
		voiceElements: main.voiceElements,
	});
	const nextTracks: TimelineTrack[] = audioTrack
		? [main.track, captionTrack, audioTrack]
		: [main.track, captionTrack];

	activeScene.tracks = nextTracks;
	activeScene.updatedAt = new Date();

	baseProject.settings = {
		...baseProject.settings,
		canvasSize: {
			width: TARGET_CANVAS_WIDTH,
			height: TARGET_CANVAS_HEIGHT,
		},
		originalCanvasSize:
			baseProject.settings.originalCanvasSize ??
			baseProject.settings.canvasSize,
		versionPack: buildDefaultProjectVersionPack({
			canvasSize: {
				width: TARGET_CANVAS_WIDTH,
				height: TARGET_CANVAS_HEIGHT,
			},
		}),
		audio: {
			...DEFAULT_PROJECT_AUDIO_SETTINGS,
			...(baseProject.settings.audio ?? {}),
			masterVolume: 1,
			duckingEnabled: true,
			duckingAmount: plan.audio_mix.ducking_amount,
			duckingAttackMs: plan.audio_mix.ducking_attack_ms,
			duckingReleaseMs: plan.audio_mix.ducking_release_ms,
			audioPolishPresetId: "voice-forward",
			softLimiterEnabled: plan.audio_mix.soft_limiter,
			noiseReductionEnabled: plan.audio_mix.noise_reduction_enabled,
			noiseReductionStrength: plan.audio_mix.noise_reduction_strength,
			windReductionEnabled: plan.audio_mix.wind_reduction_enabled,
		},
		polishProfileId: "talking-head",
	};
	baseProject.metadata.duration = plan.target_duration_ms / 1000;
	baseProject.metadata.updatedAt = new Date();
	baseProject.clipforge = {
		...baseProject.clipforge,
		activeReferenceVideoAssetId: referenceAssetId,
		assemblySourceAssetIds: sourceAssetIds,
		referenceEditAnalysisByAssetId: {
			...baseProject.clipforge.referenceEditAnalysisByAssetId,
			[referenceAssetId]: referenceEditAnalysis,
		},
		sourceRecreationAnalysisByAssetId: {
			...baseProject.clipforge.sourceRecreationAnalysisByAssetId,
			...sourceAnalyses,
		},
		musicTrackAnalysisByAssetId: musicAnalysis
			? {
					...baseProject.clipforge.musicTrackAnalysisByAssetId,
					[musicAnalysis.asset_id]: musicAnalysis,
				}
			: baseProject.clipforge.musicTrackAnalysisByAssetId,
		referenceRecreationPlansById: {
			...baseProject.clipforge.referenceRecreationPlansById,
			[plan.plan_id]: plan,
		},
		activeReferenceRecreationPlanId: plan.plan_id,
		activeCaptionStyleId: plan.caption_style.style_id,
		captionStylesById: {
			...baseProject.clipforge.captionStylesById,
			[plan.caption_style.style_id]: {
				style_id: plan.caption_style.style_id,
				font: plan.caption_style.font,
				size: plan.caption_style.size,
				position: plan.caption_style.position,
				outline: plan.caption_style.outline,
				highlight_mode: "word",
				reveal_preset_id: "pop-line",
				sound_sync_preset_id: "caption-pop-bright",
			},
		},
		captionTrackIdsBySceneId: {
			...baseProject.clipforge.captionTrackIdsBySceneId,
			[activeScene.id]: captionTrack.id,
		},
	};

	return {
		project: baseProject,
		plan,
		referenceEditAnalysis,
		sourceAnalyses,
		musicAnalysis,
	};
}
