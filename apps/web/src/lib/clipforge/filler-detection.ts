import type { TranscriptWord } from "@/types/clipforge";

export interface FillerRegion {
	start_ms: number;
	end_ms: number;
	word: string;
}

const FILLER_WORDS = new Set([
	"um", "uh", "umm", "uhh", "hmm", "hm", "er", "err",
	"ah", "ahh", "eh", "mhm", "mm", "mmm",
]);

const HESITATION_PATTERNS: RegExp[] = [
	/^u+[hm]+$/i,
	/^[ae]+h+$/i,
	/^h+m+$/i,
	/^m+h?m+$/i,
];

function normalize(word: string): string {
	return word.replace(/[^a-zA-Z]/g, "").toLowerCase();
}

export function isFillerWord(raw: string): boolean {
	const word = normalize(raw);
	if (word.length === 0) return false;
	if (FILLER_WORDS.has(word)) return true;
	return HESITATION_PATTERNS.some((pattern) => pattern.test(word));
}

export function detectFillerRegions(words: TranscriptWord[]): FillerRegion[] {
	const regions: FillerRegion[] = [];
	for (const w of words) {
		if (isFillerWord(w.text)) {
			regions.push({
				start_ms: w.start_ms,
				end_ms: w.end_ms,
				word: w.text,
			});
		}
	}
	return regions;
}

const MERGE_GAP_MS = 150;

export function mergeFillerRegions(regions: FillerRegion[]): FillerRegion[] {
	if (regions.length === 0) return [];
	const sorted = [...regions].sort((a, b) => a.start_ms - b.start_ms);
	const merged: FillerRegion[] = [{ ...sorted[0] }];
	for (let i = 1; i < sorted.length; i++) {
		const prev = merged[merged.length - 1];
		const curr = sorted[i];
		if (curr.start_ms - prev.end_ms <= MERGE_GAP_MS) {
			prev.end_ms = Math.max(prev.end_ms, curr.end_ms);
			prev.word += ` ${curr.word}`;
		} else {
			merged.push({ ...curr });
		}
	}
	return merged;
}
