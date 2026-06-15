/**
 * Content-aware cut matcher.
 *
 * Matches the reference video's transcript against the raw footage transcript
 * to find which segments from the source were kept in the final edit.
 *
 * Key improvements over naive matching:
 * - Handles contractions (we're → we are)
 * - Splits matched spans at gaps > 1s in source audio
 * - Lower match threshold with weighted scoring
 */
import type { TranscriptWord, KeptSegment, CaptionEvent } from "./types";

export interface TranscriptSegment {
  text: string;
  start_s: number;
  end_s: number;
  words: TranscriptWord[];
}

// Contraction expansion map
const CONTRACTIONS: Record<string, string[]> = {
  "were": ["we", "are"],
  "youre": ["you", "are"],
  "its": ["it", "is"],
  "thats": ["that", "is"],
  "hes": ["he", "is"],
  "shes": ["she", "is"],
  "theyre": ["they", "are"],
  "weve": ["we", "have"],
  "youve": ["you", "have"],
  "dont": ["do", "not"],
  "doesnt": ["does", "not"],
  "didnt": ["did", "not"],
  "cant": ["can", "not"],
  "wont": ["will", "not"],
  "isnt": ["is", "not"],
  "arent": ["are", "not"],
  "wasnt": ["was", "not"],
  "werent": ["were", "not"],
  "im": ["i", "am"],
  "ive": ["i", "have"],
  "ill": ["i", "will"],
  "id": ["i", "would"],
};

/**
 * Match reference transcript segments against raw footage words.
 * Returns kept segments (source timestamps) that recreate the reference content.
 */
export function matchCuts(
  rawWords: TranscriptWord[],
  refSegments: TranscriptSegment[]
): KeptSegment[] {
  const allSegments: KeptSegment[] = [];
  let outCursor = 0;

  // Expand raw words to handle contractions
  const expandedRaw = expandContractions(rawWords);

  for (const refSeg of refSegments) {
    const refText = normalize(refSeg.text);
    const refTokens = refText.split(/\s+/).filter(Boolean);

    if (refTokens.length === 0) continue;

    // Find best match in expanded raw words
    const match = findBestMatch(expandedRaw, refTokens, allSegments);

    if (!match) continue;

    // Split the match at gaps > MAX_GAP_S in the source
    const subSegments = splitAtGaps(match.words, 1.0);

    for (const sub of subSegments) {
      const start = Math.max(0, sub.start_s - 0.02);
      const end = sub.end_s + 0.02;
      const dur = end - start;

      allSegments.push({
        index: allSegments.length,
        src_start_s: round3(start),
        src_end_s: round3(end),
        duration_s: round3(dur),
        out_start_s: round3(outCursor),
      });
      outCursor += dur;
    }
  }

  return allSegments;
}

interface ExpandedWord {
  /** Normalized text */
  token: string;
  /** Original raw word this maps back to */
  originalIdx: number;
  /** Source timestamp (start) */
  start_s: number;
  /** Source timestamp (end) */
  end_s: number;
}

/**
 * Expand contractions in raw words. E.g., "We're" at position i
 * becomes two entries: {token: "we", ...} and {token: "are", ...}
 * both mapping back to the same original word and timestamps.
 */
function expandContractions(rawWords: TranscriptWord[]): ExpandedWord[] {
  const result: ExpandedWord[] = [];

  for (let i = 0; i < rawWords.length; i++) {
    const w = rawWords[i];
    const normed = normalize(w.word);

    // Check if this is a contraction
    const expansion = CONTRACTIONS[normed];
    if (expansion) {
      // Split time evenly between expanded words
      const partDur = (w.end_s - w.start_s) / expansion.length;
      for (let j = 0; j < expansion.length; j++) {
        result.push({
          token: expansion[j],
          originalIdx: i,
          start_s: w.start_s + j * partDur,
          end_s: w.start_s + (j + 1) * partDur,
        });
      }
    } else {
      result.push({
        token: normed,
        originalIdx: i,
        start_s: w.start_s,
        end_s: w.end_s,
      });
    }
  }

  return result;
}

interface MatchResult {
  words: ExpandedWord[];
  score: number;
}

/**
 * Find the best matching word sequence. Uses sliding window with
 * contraction-expanded raw words.
 */
function findBestMatch(
  expanded: ExpandedWord[],
  refTokens: string[],
  alreadyUsed: KeptSegment[]
): MatchResult | null {
  let bestScore = -1;
  let bestWords: ExpandedWord[] = [];

  for (let i = 0; i <= expanded.length - refTokens.length; i++) {
    const candidateStart = expanded[i].start_s;
    const candidateEnd = expanded[Math.min(i + refTokens.length - 1, expanded.length - 1)].end_s;

    // Skip if overlapping with already-used segments
    if (isOverlapping(candidateStart, candidateEnd, alreadyUsed)) {
      continue;
    }

    // Score this alignment
    let score = 0;
    const matchedWords: ExpandedWord[] = [];

    for (let j = 0; j < refTokens.length; j++) {
      const idx = i + j;
      if (idx >= expanded.length) break;

      const raw = expanded[idx].token;
      const ref = refTokens[j];

      if (raw === ref) {
        score += 1.0;
      } else if (fuzzyMatch(raw, ref)) {
        score += 0.6;
      }

      matchedWords.push(expanded[idx]);
    }

    const normalizedScore = score / refTokens.length;

    if (normalizedScore > bestScore && normalizedScore > 0.3) {
      bestScore = normalizedScore;
      bestWords = matchedWords;
    }
  }

  if (bestScore > 0 && bestWords.length > 0) {
    return { words: bestWords, score: bestScore };
  }

  return null;
}

/**
 * Split a matched word sequence at gaps larger than maxGap seconds.
 * This prevents including long silent stretches within a matched segment.
 */
function splitAtGaps(
  words: ExpandedWord[],
  maxGap: number
): Array<{ start_s: number; end_s: number }> {
  if (words.length === 0) return [];

  const parts: Array<{ start_s: number; end_s: number }> = [];
  let partStart = words[0].start_s;
  let prevEnd = words[0].end_s;

  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start_s - prevEnd;

    if (gap > maxGap) {
      // End current part, start new one
      parts.push({ start_s: partStart, end_s: prevEnd });
      partStart = words[i].start_s;
    }

    prevEnd = words[i].end_s;
  }

  // Close final part
  parts.push({ start_s: partStart, end_s: prevEnd });

  return parts;
}

function isOverlapping(start: number, end: number, used: KeptSegment[]): boolean {
  for (const seg of used) {
    if (start < seg.src_end_s && end > seg.src_start_s) {
      return true;
    }
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
  // Allow 1 character difference
  let diff = 0;
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    if (a[i] !== b[i]) diff++;
  }
  return diff <= 1;
}

/**
 * Build caption events from raw words, remapped to the output timeline.
 */
export function buildCaptions(
  rawWords: TranscriptWord[],
  segments: KeptSegment[]
): CaptionEvent[] {
  const captions: CaptionEvent[] = [];

  for (const seg of segments) {
    const segWords = rawWords.filter(
      (w) => w.start_s >= seg.src_start_s - 0.05 && w.end_s <= seg.src_end_s + 0.05
    );

    for (const word of segWords) {
      const offsetInSeg = word.start_s - seg.src_start_s;
      const endOffset = Math.min(word.end_s - seg.src_start_s, seg.duration_s);

      const text = word.word.trim();
      if (!text) continue;

      captions.push({
        text,
        start_s: round3(seg.out_start_s + offsetInSeg),
        end_s: round3(seg.out_start_s + endOffset),
      });
    }
  }

  return captions;
}

/**
 * Build caption events from reference words.
 *
 * Reference recreation should display the reference caption text when the
 * reference transcript/OCR is available. The source transcript is useful for
 * finding the raw-video cut ranges, but it can differ from the finished edit's
 * captions ("We're" vs "You are", "people" vs "you"). This keeps the rendered
 * caption text locked to the reference.
 */
export function buildReferenceCaptions(
  refSegments: TranscriptSegment[],
  targetDurationS?: number
): CaptionEvent[] {
  const captions = refSegments.flatMap((segment) => {
    if (segment.words.length > 0) {
      return segment.words.flatMap((word) => {
        const text = word.word.trim();
        if (!text || word.end_s <= word.start_s) return [];
        return [
          {
            text,
            start_s: round3(word.start_s),
            end_s: round3(word.end_s),
          },
        ];
      });
    }

    const tokens = segment.text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || segment.end_s <= segment.start_s) return [];
    const step = (segment.end_s - segment.start_s) / tokens.length;
    return tokens.map((text, index) => ({
      text,
      start_s: round3(segment.start_s + step * index),
      end_s: round3(segment.start_s + step * (index + 1)),
    }));
  });

  const lastEndS = captions.at(-1)?.end_s ?? 0;
  const scale =
    targetDurationS && lastEndS > 0 && Math.abs(targetDurationS - lastEndS) > 0.05
      ? targetDurationS / lastEndS
      : 1;

  return captions
    .map((caption) => ({
      ...caption,
      start_s: round3(caption.start_s * scale),
      end_s: round3(caption.end_s * scale),
    }))
    .sort((left, right) => left.start_s - right.start_s);
}

/**
 * Parse Whisper JSON into transcript segments (sentence-level).
 */
export function parseWhisperSegments(data: any): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  if (!data.segments) return segments;

  for (const seg of data.segments) {
    const words: TranscriptWord[] = [];
    if (seg.words) {
      for (const w of seg.words) {
        words.push({
          word: w.word?.trim() ?? "",
          start_s: Number(w.start),
          end_s: Number(w.end),
        });
      }
    }

    segments.push({
      text: seg.text?.trim() ?? "",
      start_s: Number(seg.start),
      end_s: Number(seg.end),
      words,
    });
  }

  return segments;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
