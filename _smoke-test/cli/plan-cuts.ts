/**
 * Cut planner — converts silence regions into kept segments.
 *
 * Takes the full duration and detected silence regions, then computes
 * which parts of the original footage to keep (the speech parts).
 * Also remaps transcript word timestamps from source to output timeline.
 */
import type { SilenceRegion, KeptSegment, TranscriptWord, CaptionEvent } from "./types";

/**
 * Given silence regions and total duration, compute the segments to keep.
 * Adds configurable padding around speech boundaries.
 */
export function planCuts(
  totalDuration_s: number,
  silenceRegions: SilenceRegion[],
  padBefore_s: number = 0.05,
  padAfter_s: number = 0.05
): KeptSegment[] {
  if (silenceRegions.length === 0) {
    return [
      {
        index: 0,
        src_start_s: 0,
        src_end_s: totalDuration_s,
        duration_s: totalDuration_s,
        out_start_s: 0,
      },
    ];
  }

  // Sort silence regions by start time
  const sorted = [...silenceRegions].sort((a, b) => a.start_s - b.start_s);

  // Build kept regions as the gaps between silence
  const kept: KeptSegment[] = [];
  let cursor = 0; // current position in source
  let outCursor = 0; // current position in output

  for (const silence of sorted) {
    // Speech region: from cursor to start of silence
    const speechStart = cursor;
    const speechEnd = silence.start_s;

    if (speechEnd > speechStart + 0.05) {
      // Apply padding: extend into silence slightly
      const start = Math.max(0, speechStart - padBefore_s);
      const end = Math.min(totalDuration_s, speechEnd + padAfter_s);
      const dur = end - start;

      kept.push({
        index: kept.length,
        src_start_s: roundMs(start),
        src_end_s: roundMs(end),
        duration_s: roundMs(dur),
        out_start_s: roundMs(outCursor),
      });

      outCursor += dur;
    }

    // Move cursor past the silence
    cursor = silence.end_s;
  }

  // Handle trailing speech after last silence
  if (cursor < totalDuration_s - 0.05) {
    const start = Math.max(0, cursor - padBefore_s);
    const end = totalDuration_s;
    const dur = end - start;

    kept.push({
      index: kept.length,
      src_start_s: roundMs(start),
      src_end_s: roundMs(end),
      duration_s: roundMs(dur),
      out_start_s: roundMs(outCursor),
    });
  }

  return kept;
}

/**
 * Remap transcript words from source timeline to output timeline.
 * Only keeps words that fall within a kept segment.
 */
export function remapWordsToOutput(
  words: TranscriptWord[],
  segments: KeptSegment[]
): CaptionEvent[] {
  const captions: CaptionEvent[] = [];

  for (const word of words) {
    // Find which segment this word falls in
    const seg = segments.find(
      (s) => word.start_s >= s.src_start_s - 0.01 && word.start_s < s.src_end_s + 0.01
    );

    if (!seg) continue; // Word is in a silent region that was cut

    // Remap: offset within the source segment + output segment start
    const offsetInSeg = word.start_s - seg.src_start_s;
    const endOffsetInSeg = Math.min(word.end_s - seg.src_start_s, seg.duration_s);

    captions.push({
      text: word.word.trim(),
      start_s: roundMs(seg.out_start_s + offsetInSeg),
      end_s: roundMs(seg.out_start_s + endOffsetInSeg),
    });
  }

  return captions;
}

function roundMs(v: number): number {
  return Math.round(v * 1000) / 1000;
}
