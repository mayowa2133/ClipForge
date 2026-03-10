import type { MediaAsset } from "@/types/assets";
import type {
	ClipMediaMetadata,
	FootageIntelligenceReport,
	FootageMomentScore,
	HookCandidate,
	KeepCutRecommendation,
	SilenceRegion,
	TranscriptWord,
} from "@/types/clipforge";
import type { TProject } from "@/types/project";
import type { SceneBeatMarker, TimelineTrack, VideoElement } from "@/types/timeline";
import { getElementPlaybackRate } from "@/lib/timeline";
import { buildTimelineTranscriptWords } from "./timeline-transcript";

const VISUAL_ANALYSIS_WARNING =
	"Some clips have no visual activity analysis, so hook scoring falls back to transcript and timing signals.";
const TRANSCRIPT_WARNING =
	"No transcript metadata is available, so scoring falls back to visual timing signals.";
const BEAT_WARNING =
	"No active beat grid is available, so rhythm-aware ranking is reduced.";

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function overlapDuration({
	startA,
	endA,
	startB,
	endB,
}: {
	startA: number;
	endA: number;
	startB: number;
	endB: number;
}): number {
	return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function buildWindowId({
	elementId,
	startTime,
	endTime,
}: {
	elementId: string;
	startTime: number;
	endTime: number;
}): string {
	return `${elementId}:${startTime.toFixed(3)}:${endTime.toFixed(3)}`;
}

function scoreTranscriptDensity({
	words,
	startMs,
	endMs,
}: {
	words: TranscriptWord[];
	startMs: number;
	endMs: number;
}): { densityScore: number; reasons: string[] } {
	const overlappingWords = words.filter(
		(word) => word.end_ms > startMs && word.start_ms < endMs,
	);
	if (overlappingWords.length === 0) {
		return { densityScore: 0, reasons: [] };
	}

	const durationS = Math.max(0.5, (endMs - startMs) / 1000);
	const wordsPerSecond = overlappingWords.length / durationS;
	const densityScore = clamp(wordsPerSecond / 3.5, 0, 1.2);
	const reasons: string[] = [];
	if (wordsPerSecond >= 2.2) {
		reasons.push("Speech is dense in this window.");
	} else if (wordsPerSecond >= 1.1) {
		reasons.push("Speech is present and steady here.");
	}
	return {
		densityScore,
		reasons,
	};
}

function scoreSilencePenalty({
	silenceRegions,
	startMs,
	endMs,
}: {
	silenceRegions: SilenceRegion[];
	startMs: number;
	endMs: number;
}): { penalty: number; reasons: string[] } {
	const totalDuration = Math.max(1, endMs - startMs);
	const silentDuration = silenceRegions.reduce(
		(total, region) =>
			total +
			overlapDuration({
				startA: startMs,
				endA: endMs,
				startB: region.start_ms,
				endB: region.end_ms,
			}),
		0,
	);
	const silentRatio = silentDuration / totalDuration;
	const reasons: string[] = [];
	if (silentRatio >= 0.5) {
		reasons.push("Long silence reduces opener strength.");
	} else if (silentRatio >= 0.2) {
		reasons.push("Some silence softens this moment.");
	}
	return {
		penalty: clamp(silentRatio, 0, 1),
		reasons,
	};
}

function hasBeatAlignment({
	beatMarkers,
	startTime,
	endTime,
}: {
	beatMarkers: SceneBeatMarker[];
	startTime: number;
	endTime: number;
}): boolean {
	return beatMarkers.some((marker) => {
		const beatTime = marker.time;
		return Math.abs(beatTime - startTime) <= 0.12 || Math.abs(beatTime - endTime) <= 0.12;
	});
}

function buildElementWords({
	timelineWords,
	elementId,
}: {
	timelineWords: ReturnType<typeof buildTimelineTranscriptWords>;
	elementId: string;
}): TranscriptWord[] {
	return timelineWords
		.filter((word) => word.segment_id === elementId)
		.map((word) => ({
			text: word.text,
			start_ms: word.start_ms,
			end_ms: word.end_ms,
		}));
}

function mapSourceTimeToTimeline({
	element,
	sourceTime,
}: {
	element: VideoElement;
	sourceTime: number;
}): number {
	const playbackRate = getElementPlaybackRate({ element });
	return Number((element.startTime + (sourceTime - element.trimStart) / playbackRate).toFixed(3));
}

function buildCandidateWindows({
	element,
	metadata,
	asset,
}: {
	element: VideoElement;
	metadata: ClipMediaMetadata | null;
	asset: MediaAsset | undefined;
}): Array<{ startTime: number; endTime: number; visualScore: number; sceneCut: boolean }> {
	const playbackRate = getElementPlaybackRate({ element });
	const visibleSourceStart = element.trimStart;
	const visibleSourceEnd = visibleSourceStart + element.duration * playbackRate;
	const activityWindows = asset?.visualAnalysis?.activityWindows ?? [];
	const sceneCuts = new Set(
		(asset?.visualAnalysis?.sceneCuts ?? []).map((time) => Number(time.toFixed(3))),
	);
	const windows = activityWindows
		.filter(
			(window) =>
				window.endTime > visibleSourceStart + 1e-4 &&
				window.startTime < visibleSourceEnd - 1e-4,
		)
		.map((window) => {
			const startSource = Math.max(visibleSourceStart, window.startTime);
			const endSource = Math.min(visibleSourceEnd, window.endTime);
			return {
				startTime: mapSourceTimeToTimeline({
					element,
					sourceTime: startSource,
				}),
				endTime: mapSourceTimeToTimeline({
					element,
					sourceTime: endSource,
				}),
				visualScore: clamp(window.score, 0, 1.5),
				sceneCut: sceneCuts.has(Number(startSource.toFixed(3))),
			};
		})
		.filter((window) => window.endTime - window.startTime >= 0.3);

	if (windows.length > 0) {
		return windows;
	}

	const metadataSegments = metadata?.segments ?? [];
	if (metadataSegments.length > 0) {
		return metadataSegments
			.map((segment) => {
				const startSource = clamp(segment.start_ms / 1000, visibleSourceStart, visibleSourceEnd);
				const endSource = clamp(segment.end_ms / 1000, visibleSourceStart, visibleSourceEnd);
				return {
					startTime: mapSourceTimeToTimeline({ element, sourceTime: startSource }),
					endTime: mapSourceTimeToTimeline({ element, sourceTime: endSource }),
					visualScore: 0.35,
					sceneCut: false,
				};
			})
			.filter((window) => window.endTime - window.startTime >= 0.3);
	}

	return [
		{
			startTime: Number(element.startTime.toFixed(3)),
			endTime: Number((element.startTime + Math.min(element.duration, 2)).toFixed(3)),
			visualScore: 0.2,
			sceneCut: false,
		},
	];
}

export function buildSceneFootageIntelligenceReport({
	project,
	mediaAssets,
	beatMarkers = [],
}: {
	project: TProject;
	mediaAssets: MediaAsset[];
	beatMarkers?: SceneBeatMarker[];
}): FootageIntelligenceReport {
	const activeScene =
		project.scenes.find((scene) => scene.id === project.currentSceneId) ??
		project.scenes[0] ??
		null;
	const generatedAt = new Date().toISOString();
	if (!activeScene) {
		return {
			generatedAt,
			hookCandidates: [],
			momentScores: [],
			keepCutRecommendations: [],
			warnings: ["No active scene is available for footage intelligence."],
		};
	}

	const mediaById = new Map(mediaAssets.map((asset) => [asset.id, asset]));
	const warnings = new Set<string>();
	const timelineWords = buildTimelineTranscriptWords({ project });
	const hasTranscript = timelineWords.length > 0;
	if (!hasTranscript) {
		warnings.add(TRANSCRIPT_WARNING);
	}
	if (beatMarkers.length === 0) {
		warnings.add(BEAT_WARNING);
	}

	const momentScores: FootageMomentScore[] = [];
	const keepCutRecommendations: KeepCutRecommendation[] = [];

	for (const track of activeScene.tracks) {
		if (track.type !== "video") continue;
		for (const element of track.elements) {
			if (element.type !== "video") continue;
			const metadata = project.clipforge?.mediaMetadataById[element.mediaId] ?? null;
			const asset = mediaById.get(element.mediaId);
			if (!asset?.visualAnalysis) {
				warnings.add(VISUAL_ANALYSIS_WARNING);
			}
			const elementWords = buildElementWords({
				timelineWords,
				elementId: element.id,
			});
			const windows = buildCandidateWindows({
				element,
				metadata,
				asset,
			});

			const scoredWindows = windows
				.map((window) => {
					const startMs = Math.round(window.startTime * 1000);
					const endMs = Math.round(window.endTime * 1000);
					const { densityScore, reasons: transcriptReasons } = scoreTranscriptDensity({
						words: elementWords,
						startMs,
						endMs,
					});
					const { penalty: silencePenalty, reasons: silenceReasons } = scoreSilencePenalty({
						silenceRegions: metadata?.silenceRegions ?? [],
						startMs: Math.round((element.trimStart + (window.startTime - element.startTime) * getElementPlaybackRate({ element })) * 1000),
						endMs: Math.round((element.trimStart + (window.endTime - element.startTime) * getElementPlaybackRate({ element })) * 1000),
					});
					const earlyBonus = window.startTime <= 2 ? 0.75 : window.startTime <= 5 ? 0.35 : 0;
					const beatBonus = hasBeatAlignment({
						beatMarkers,
						startTime: window.startTime,
						endTime: window.endTime,
					})
						? 0.3
						: 0;
					const sceneCutBonus = window.sceneCut ? 0.35 : 0;
					const visualScore = clamp(window.visualScore, 0, 1.5);
					const totalScore = Number(
						(
							visualScore * 2.2 +
							densityScore * 1.8 +
							earlyBonus +
							beatBonus +
							sceneCutBonus -
							silencePenalty * 1.6
						).toFixed(3),
					);
					const reasons = [
						...(visualScore >= 0.8
							? ["Visual change is strong here."]
							: visualScore >= 0.35
								? ["Visual activity is steady here."]
								: ["Visual change is limited here."]),
						...transcriptReasons,
						...(earlyBonus > 0 ? ["Starts early in the scene."] : []),
						...(beatBonus > 0 ? ["This window aligns with the active beat grid."] : []),
						...(sceneCutBonus > 0 ? ["A scene change helps this moment land cleanly."] : []),
						...silenceReasons,
					];
					return {
						id: buildWindowId({
							elementId: element.id,
							startTime: window.startTime,
							endTime: window.endTime,
						}),
						trackId: track.id,
						elementId: element.id,
						startTime: window.startTime,
						endTime: window.endTime,
						totalScore,
						reasons,
					} satisfies FootageMomentScore;
				})
				.sort((left, right) => {
					if (right.totalScore !== left.totalScore) {
						return right.totalScore - left.totalScore;
					}
					return left.startTime - right.startTime;
				});

			momentScores.push(...scoredWindows);

			const bestWindow = scoredWindows[0] ?? null;
			if (!bestWindow) continue;
			const elementEnd = element.startTime + element.duration;
			const recommendation: KeepCutRecommendation = {
				id: `keep-cut:${element.id}`,
				trackId: track.id,
				elementId: element.id,
				action:
					bestWindow.totalScore >= 2.4
						? "keep"
						: bestWindow.totalScore >= 1.2
							? "trim"
							: "cut",
				startTime:
					bestWindow.totalScore >= 1.2
						? bestWindow.startTime
						: Number(element.startTime.toFixed(3)),
				endTime:
					bestWindow.totalScore >= 1.2
						? bestWindow.endTime
						: Number(elementEnd.toFixed(3)),
				score: bestWindow.totalScore,
				reasons:
					bestWindow.totalScore >= 2.4
						? bestWindow.reasons
						: bestWindow.totalScore >= 1.2
							? [...bestWindow.reasons, "Trim to the strongest sub-window."]
							: [...bestWindow.reasons, "This span is weak or redundant."],
			};
			keepCutRecommendations.push(recommendation);
		}
	}

	const sceneDuration = activeScene.tracks.reduce(
		(maxDuration, track) =>
			Math.max(
				maxDuration,
				...track.elements.map((element) => element.startTime + element.duration),
			),
		0,
	);
	const hookCandidates: HookCandidate[] = momentScores
		.filter((score) => score.startTime <= Math.min(8, Math.max(4, sceneDuration * 0.35)))
		.slice()
		.sort((left, right) => {
			if (right.totalScore !== left.totalScore) {
				return right.totalScore - left.totalScore;
			}
			return left.startTime - right.startTime;
		})
		.slice(0, 3)
		.map((score) => ({
			id: `hook:${score.id}`,
			trackId: score.trackId,
			elementId: score.elementId,
			startTime: score.startTime,
			endTime: score.endTime,
			score: score.totalScore,
			reasons: score.reasons,
		}));

	if (hookCandidates.length === 0) {
		warnings.add("No strong opener was identified, so hook selection falls back to clip order.");
	}

	return {
		generatedAt,
		hookCandidates,
		momentScores: momentScores.sort((left, right) => {
			if (right.totalScore !== left.totalScore) {
				return right.totalScore - left.totalScore;
			}
			return left.startTime - right.startTime;
		}),
		keepCutRecommendations: keepCutRecommendations.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return left.startTime - right.startTime;
		}),
		warnings: [...warnings],
	};
}
