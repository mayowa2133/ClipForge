/**
 * Content-aware cut matching.
 *
 * Matches a reference video's transcript against raw footage to determine
 * which segments from the source were kept in the final edit. Uses fuzzy
 * word matching with contraction expansion.
 *
 * All timestamps use milliseconds to match ClipForge's native conventions.
 */
import type { TranscriptSegment, TranscriptWord } from "@/types/clipforge";

export interface CutSegment {
	/** Index in the final timeline (0-based) */
	index: number;
	/** Start time in original footage (ms) */
	src_start_ms: number;
	/** End time in original footage (ms) */
	src_end_ms: number;
	/** Duration of this segment (ms) */
	duration_ms: number;
	/** Cumulative start in the output timeline (ms) */
	out_start_ms: number;
}

export interface MappedCaption {
	text: string;
	/** Start time in the OUTPUT timeline (ms) */
	start_ms: number;
	/** End time in the OUTPUT timeline (ms) */
	end_ms: number;
}

// ── Contraction expansion ──────────────────────────────────────

const CONTRACTIONS: Record<string, string[]> = {
	were: ["we", "are"],
	youre: ["you", "are"],
	its: ["it", "is"],
	thats: ["that", "is"],
	hes: ["he", "is"],
	shes: ["she", "is"],
	theyre: ["they", "are"],
	weve: ["we", "have"],
	youve: ["you", "have"],
	dont: ["do", "not"],
	doesnt: ["does", "not"],
	didnt: ["did", "not"],
	cant: ["can", "not"],
	wont: ["will", "not"],
	isnt: ["is", "not"],
	arent: ["are", "not"],
	wasnt: ["was", "not"],
	werent: ["were", "not"],
	im: ["i", "am"],
	ive: ["i", "have"],
	ill: ["i", "will"],
	id: ["i", "would"],
};

interface ExpandedWord {
	token: string;
	originalIdx: number;
	start_ms: number;
	end_ms: number;
}

// ── Main API ───────────────────────────────────────────────────

/**
 * Match reference transcript segments against raw footage words.
 * Returns segments from the source that recreate the reference content.
 */
export function matchTranscriptCuts(
	rawWords: TranscriptWord[],
	refSegments: TranscriptSegment[],
	paddingMs: number = 20,
): CutSegment[] {
	const allSegments: CutSegment[] = [];
	let outCursor = 0;

	const expanded = expandContractions(rawWords);

	for (const refSeg of refSegments) {
		const refText = normalize(refSeg.text);
		const refTokens = refText.split(/\s+/).filter(Boolean);
		if (refTokens.length === 0) continue;

		const match = findBestMatch(expanded, refTokens, allSegments);
		if (!match) continue;

		const subSegments = splitAtGaps(match.words, 1000); // 1s gap threshold

		for (const sub of subSegments) {
			const start = Math.max(0, sub.start_ms - paddingMs);
			const end = sub.end_ms + paddingMs;
			const dur = end - start;

			allSegments.push({
				index: allSegments.length,
				src_start_ms: start,
				src_end_ms: end,
				duration_ms: dur,
				out_start_ms: outCursor,
			});
			outCursor += dur;
		}
	}

	return allSegments;
}

/**
 * Build caption events from raw words, remapped to cut segments.
 */
export function buildMappedCaptions(
	rawWords: TranscriptWord[],
	segments: CutSegment[],
): MappedCaption[] {
	const captions: MappedCaption[] = [];

	for (const seg of segments) {
		const segWords = rawWords.filter(
			(w) =>
				w.start_ms >= seg.src_start_ms - 50 &&
				w.end_ms <= seg.src_end_ms + 50,
		);

		for (const word of segWords) {
			const offsetInSeg = word.start_ms - seg.src_start_ms;
			const endOffset = Math.min(
				word.end_ms - seg.src_start_ms,
				seg.duration_ms,
			);
			const text = word.text.trim();
			if (!text) continue;

			captions.push({
				text,
				start_ms: seg.out_start_ms + offsetInSeg,
				end_ms: seg.out_start_ms + endOffset,
			});
		}
	}

	return captions;
}

/**
 * Build cut segments from silence regions (simpler approach when no
 * reference video is available).
 */
export function buildCutsFromSilence(
	totalDurationMs: number,
	silenceRegions: Array<{ start_ms: number; end_ms: number }>,
	paddingMs: number = 50,
): CutSegment[] {
	if (silenceRegions.length === 0) {
		return [
			{
				index: 0,
				src_start_ms: 0,
				src_end_ms: totalDurationMs,
				duration_ms: totalDurationMs,
				out_start_ms: 0,
			},
		];
	}

	const sorted = [...silenceRegions].sort((a, b) => a.start_ms - b.start_ms);
	const kept: CutSegment[] = [];
	let cursor = 0;
	let outCursor = 0;

	for (const silence of sorted) {
		const speechStart = cursor;
		const speechEnd = silence.start_ms;

		if (speechEnd > speechStart + 50) {
			const start = Math.max(0, speechStart - paddingMs);
			const end = Math.min(totalDurationMs, speechEnd + paddingMs);
			const dur = end - start;

			kept.push({
				index: kept.length,
				src_start_ms: start,
				src_end_ms: end,
				duration_ms: dur,
				out_start_ms: outCursor,
			});
			outCursor += dur;
		}
		cursor = silence.end_ms;
	}

	// Trailing speech
	if (cursor < totalDurationMs - 50) {
		const start = Math.max(0, cursor - paddingMs);
		const end = totalDurationMs;
		const dur = end - start;
		kept.push({
			index: kept.length,
			src_start_ms: start,
			src_end_ms: end,
			duration_ms: dur,
			out_start_ms: outCursor,
		});
	}

	return kept;
}

// ── Internal helpers ───────────────────────────────────────────

function expandContractions(rawWords: TranscriptWord[]): ExpandedWord[] {
	const result: ExpandedWord[] = [];

	for (let i = 0; i < rawWords.length; i++) {
		const w = rawWords[i];
		const normed = normalize(w.text);
		const expansion = CONTRACTIONS[normed];

		if (expansion) {
			const partDur = (w.end_ms - w.start_ms) / expansion.length;
			for (let j = 0; j < expansion.length; j++) {
				result.push({
					token: expansion[j],
					originalIdx: i,
					start_ms: w.start_ms + j * partDur,
					end_ms: w.start_ms + (j + 1) * partDur,
				});
			}
		} else {
			result.push({
				token: normed,
				originalIdx: i,
				start_ms: w.start_ms,
				end_ms: w.end_ms,
			});
		}
	}

	return result;
}

function findBestMatch(
	expanded: ExpandedWord[],
	refTokens: string[],
	alreadyUsed: CutSegment[],
): { words: ExpandedWord[]; score: number } | null {
	let bestScore = -1;
	let bestWords: ExpandedWord[] = [];

	for (let i = 0; i <= expanded.length - refTokens.length; i++) {
		const candidateStart = expanded[i].start_ms;
		const candidateEnd =
			expanded[Math.min(i + refTokens.length - 1, expanded.length - 1)]
				.end_ms;

		if (isOverlapping(candidateStart, candidateEnd, alreadyUsed)) continue;

		let score = 0;
		const matched: ExpandedWord[] = [];

		for (let j = 0; j < refTokens.length; j++) {
			const idx = i + j;
			if (idx >= expanded.length) break;
			const raw = expanded[idx].token;
			const ref = refTokens[j];

			if (raw === ref) score += 1.0;
			else if (fuzzyMatch(raw, ref)) score += 0.6;

			matched.push(expanded[idx]);
		}

		const normalized = score / refTokens.length;
		if (normalized > bestScore && normalized > 0.3) {
			bestScore = normalized;
			bestWords = matched;
		}
	}

	if (bestScore > 0 && bestWords.length > 0) {
		return { words: bestWords, score: bestScore };
	}
	return null;
}

function splitAtGaps(
	words: ExpandedWord[],
	maxGapMs: number,
): Array<{ start_ms: number; end_ms: number }> {
	if (words.length === 0) return [];

	const parts: Array<{ start_ms: number; end_ms: number }> = [];
	let partStart = words[0].start_ms;
	let prevEnd = words[0].end_ms;

	for (let i = 1; i < words.length; i++) {
		const gap = words[i].start_ms - prevEnd;
		if (gap > maxGapMs) {
			parts.push({ start_ms: partStart, end_ms: prevEnd });
			partStart = words[i].start_ms;
		}
		prevEnd = words[i].end_ms;
	}

	parts.push({ start_ms: partStart, end_ms: prevEnd });
	return parts;
}

function isOverlapping(
	startMs: number,
	endMs: number,
	used: CutSegment[],
): boolean {
	for (const seg of used) {
		if (startMs < seg.src_end_ms && endMs > seg.src_start_ms) return true;
	}
	return false;
}

function normalize(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, "")
		.trim();
}

function fuzzyMatch(a: string, b: string): boolean {
	if (a === b) return true;
	if (Math.abs(a.length - b.length) > 2) return false;
	if (a.startsWith(b) || b.startsWith(a)) return true;
	let diff = 0;
	const maxLen = Math.max(a.length, b.length);
	for (let i = 0; i < maxLen; i++) {
		if (a[i] !== b[i]) diff++;
	}
	return diff <= 1;
}
