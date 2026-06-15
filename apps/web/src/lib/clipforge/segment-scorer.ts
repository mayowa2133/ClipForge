/**
 * Content-quality scoring for segments within a single long raw video.
 *
 * Given silence regions, gaze windows, and an optional transcript, divides
 * the video into speech segments and scores each one.  The highest-scoring
 * segments are kept to produce a finished cut at the creator's target duration.
 */
import type { SilenceRegion } from "@/types/clipforge";

export interface ScoredSegment {
	startMs: number;
	endMs: number;
	durationMs: number;
	score: number;
	speechWordCount: number;
	avgGazeScore: number;
	isSilence: boolean;
}

export interface GazeWindowLike {
	startMs: number;
	endMs: number;
	/** 1 = on-camera, 0 = off-camera */
	score: number;
}

export interface TranscriptWordLike {
	start_ms: number;
	end_ms: number;
	text: string;
}

/**
 * Extract speech segments from silence regions.
 *
 * Returns intervals that are NOT silent — i.e. the speaking moments.
 * Adjacent silences separated by less than `mergeSpeechGapMs` are treated
 * as a single speech block.
 */
export function extractSpeechSegments({
	silenceRegions,
	totalDurationMs,
	minSpeechMs = 300,
	mergeSpeechGapMs = 500,
}: {
	silenceRegions: SilenceRegion[];
	totalDurationMs: number;
	minSpeechMs?: number;
	mergeSpeechGapMs?: number;
}): Array<{ startMs: number; endMs: number }> {
	if (totalDurationMs <= 0) return [];
	if (silenceRegions.length === 0) {
		return [{ startMs: 0, endMs: totalDurationMs }];
	}

	// Sort silence regions by start time
	const sorted = [...silenceRegions].sort(
		(a, b) => a.start_ms - b.start_ms,
	);

	// Find the gaps between silence regions — these are speech segments
	const speech: Array<{ startMs: number; endMs: number }> = [];
	let cursor = 0;

	for (const region of sorted) {
		const segStart = cursor;
		const segEnd = region.start_ms;
		if (segEnd - segStart >= minSpeechMs) {
			speech.push({ startMs: segStart, endMs: segEnd });
		}
		cursor = Math.max(cursor, region.end_ms);
	}

	// Trailing speech after the last silence
	if (totalDurationMs - cursor >= minSpeechMs) {
		speech.push({ startMs: cursor, endMs: totalDurationMs });
	}

	// Merge speech blocks separated by a tiny silence gap
	const merged: Array<{ startMs: number; endMs: number }> = [];
	for (const seg of speech) {
		const last = merged[merged.length - 1];
		if (last && seg.startMs - last.endMs <= mergeSpeechGapMs) {
			last.endMs = seg.endMs;
		} else {
			merged.push({ ...seg });
		}
	}

	return merged;
}

/**
 * Score each speech segment using available signals.
 *
 * Scoring formula (higher = better content to keep):
 *   speechDensity × 2.5   — words/second (good delivery)
 *   + gazeScore × 2.0      — creator is on camera (engaging)
 *   + durationBonus × 0.5  — moderate-length segments preferred
 *   − shortPenalty          — very short segments (<1s) penalised
 */
export function scoreSpeechSegments({
	segments,
	gazeWindows = [],
	transcriptWords = [],
}: {
	segments: Array<{ startMs: number; endMs: number }>;
	gazeWindows?: GazeWindowLike[];
	transcriptWords?: TranscriptWordLike[];
}): ScoredSegment[] {
	return segments.map((seg) => {
		const durationMs = Math.max(1, seg.endMs - seg.startMs);
		const durationS = durationMs / 1000;

		// --- Speech density ---
		const wordsInSegment = transcriptWords.filter(
			(w) => w.start_ms >= seg.startMs && w.end_ms <= seg.endMs,
		);
		const wordsPerSecond =
			wordsInSegment.length > 0 ? wordsInSegment.length / durationS : 0;
		// Typical good pace: 2.5–3.5 wps; score 1.0 at 3 wps
		const speechScore = Math.min(1.5, wordsPerSecond / 3);

		// --- Gaze score (average over segment) ---
		const overlappingGaze = gazeWindows.filter(
			(w) => w.startMs < seg.endMs && w.endMs > seg.startMs,
		);
		const avgGazeScore =
			overlappingGaze.length > 0
				? overlappingGaze.reduce((sum, w) => {
						const overlapStart = Math.max(w.startMs, seg.startMs);
						const overlapEnd = Math.min(w.endMs, seg.endMs);
						const weight = (overlapEnd - overlapStart) / durationMs;
						return sum + w.score * weight;
					}, 0)
				: 0.5; // Neutral assumption when gaze data is missing

		// --- Duration bonus: prefer 3–15s segments ---
		let durationBonus = 0;
		if (durationS >= 3 && durationS <= 15) {
			durationBonus = 1.0;
		} else if (durationS >= 1.5 && durationS < 3) {
			durationBonus = 0.5;
		} else if (durationS > 15 && durationS <= 30) {
			durationBonus = 0.6;
		} else if (durationS > 30) {
			durationBonus = 0.3; // Very long segments — might include rambling
		}

		// --- Short segment penalty ---
		const shortPenalty = durationS < 1 ? 0.8 : 0;

		const rawScore =
			speechScore * 2.5 +
			avgGazeScore * 2.0 +
			durationBonus * 0.5 -
			shortPenalty;

		const score = Math.max(0, Number(rawScore.toFixed(4)));

		return {
			startMs: seg.startMs,
			endMs: seg.endMs,
			durationMs,
			score,
			speechWordCount: wordsInSegment.length,
			avgGazeScore: Number(avgGazeScore.toFixed(3)),
			isSilence: false,
		};
	});
}

/**
 * Select the best speech segments to hit a target duration.
 *
 * Returns the segments to KEEP (sorted by original time order).
 * The caller should generate CUT_RANGE ops for the gaps between them.
 */
export function selectBestSegments({
	scoredSegments,
	targetKeepRatio,
	totalDurationMs,
	minSegmentsToKeep = 3,
}: {
	scoredSegments: ScoredSegment[];
	targetKeepRatio: number;
	totalDurationMs: number;
	minSegmentsToKeep?: number;
}): ScoredSegment[] {
	if (scoredSegments.length === 0) return [];

	const targetDurationMs = Math.round(totalDurationMs * targetKeepRatio);

	// Sort by score descending
	const byScore = [...scoredSegments].sort((a, b) => b.score - a.score);

	// Greedily pick highest-score segments until we hit the target duration
	const kept = new Set<number>();
	let keptDurationMs = 0;

	for (const seg of byScore) {
		if (
			keptDurationMs >= targetDurationMs &&
			kept.size >= minSegmentsToKeep
		) {
			break;
		}
		kept.add(seg.startMs);
		keptDurationMs += seg.durationMs;
	}

	// Ensure at least minSegmentsToKeep are kept
	if (kept.size < minSegmentsToKeep) {
		for (const seg of byScore.slice(0, minSegmentsToKeep)) {
			kept.add(seg.startMs);
		}
	}

	// Return kept segments in chronological order
	return scoredSegments
		.filter((seg) => kept.has(seg.startMs))
		.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Generate CUT_RANGE operations to remove the content between kept segments.
 *
 * Gaps before the first kept segment and after the last are also removed.
 */
export function buildCutOpsFromKeptSegments({
	keptSegments,
	totalDurationMs,
	minGapMs = 200,
}: {
	keptSegments: ScoredSegment[];
	totalDurationMs: number;
	minGapMs?: number;
}): Array<{ type: "CUT_RANGE"; start_ms: number; end_ms: number }> {
	if (keptSegments.length === 0) return [];

	const cuts: Array<{ type: "CUT_RANGE"; start_ms: number; end_ms: number }> =
		[];

	// Gap before first kept segment
	const firstStart = keptSegments[0]?.startMs ?? 0;
	if (firstStart >= minGapMs) {
		cuts.push({ type: "CUT_RANGE", start_ms: 0, end_ms: firstStart });
	}

	// Gaps between kept segments
	for (let i = 0; i < keptSegments.length - 1; i++) {
		const current = keptSegments[i];
		const next = keptSegments[i + 1];
		if (!current || !next) continue;
		const gapStart = current.endMs;
		const gapEnd = next.startMs;
		if (gapEnd - gapStart >= minGapMs) {
			cuts.push({ type: "CUT_RANGE", start_ms: gapStart, end_ms: gapEnd });
		}
	}

	// Gap after last kept segment
	const lastEnd = keptSegments[keptSegments.length - 1]?.endMs ?? totalDurationMs;
	if (totalDurationMs - lastEnd >= minGapMs) {
		cuts.push({ type: "CUT_RANGE", start_ms: lastEnd, end_ms: totalDurationMs });
	}

	// Sort by start time (cuts must be applied in reverse order by the engine
	// or the engine handles them — sort ascending for consistency)
	return cuts.sort((a, b) => a.start_ms - b.start_ms);
}
