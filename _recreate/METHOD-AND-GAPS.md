# Recreating "Operating from Abundance" with Claude Code tools — method, proof, and tool gaps

Goal: recreate the reference edit from the **raw video + background music** using only
general tools (ffmpeg, openai-whisper CLI, python/numpy, PIL) — **not** the ClipForge
pipeline — then port the learnings back into ClipForge.

Inputs:
- RAW: `_smoke-test/RAW-abundance-h264.mp4` (255.3s, 1080x1920)
- REFERENCE: `_smoke-test/FINISHED-abundance-h264.mp4` (72.0s, 1080x1920)
- MUSIC: `_smoke-test/MUSIC-background.mp3`

Output: `_recreate/RECREATED.mp4` (67.1s, 1080x1920) — also on Desktop as `RECREATED-claudecode.mp4`.

## Proof of replication
- **Voice content: 94.8% similarity** to the reference transcript (208/221 reference
  words reproduced in order; 94.1% recall, 95.4% precision).
- **Visual:** side-by-side frames at 12s/30s/48s match — same speaker moment, same
  title ("Always Operate from Abundance", 2 lines, upper third), same word-by-word
  ALL-CAPS captions (white + thick black outline, lower-center). See `_recreate/cmp/`.
- **Format:** 1080x1920, ~67–72s, music bed at 0.30.
- Remaining ~5%: Whisper transcription noise + a 5s pacing difference (the reference
  kept slightly more breath).

## Method (what actually worked)
1. **Transcribe** raw + reference with word timestamps (`whisper --model small --word_timestamps True`).
2. **Audio silence detection** with `ffmpeg silencedetect` (sample-accurate). Speech
   chunks = the complement of detected silence. *Do NOT use Whisper word-gap timing for
   cuts* (see Finding A).
3. **Reference-as-ground-truth content selection.** Align raw words to the reference
   (difflib). A raw word is KEPT if it appears in the reference, DELETED otherwise
   (repeats/retakes/editorial cuts are absent from the reference). Assign each raw word
   to a speech chunk **by its end-time** (robust to pause-inflation), keep chunks whose
   words are majority reference-matched.
4. **Iterative repeat removal.** After the first cut, **re-transcribe the CUT** (not the
   raw). Repeats the raw transcript collapsed become visible in the shorter cut
   transcript; remove any ≥6-word run that repeats within a 22-word window (the first,
   flubbed attempt). Threshold ≥6 avoids false positives on parallel phrasing
   ("is going to feel ... / the other is going to feel ...").
5. **Reconstruct** with ffmpeg trim+concat at the silence boundaries.
6. **Captions/title/music**: PIL renders a transparent ALL-CAPS word-by-word caption +
   2-line title overlay; ffmpeg composites it and mixes the music at 0.30.

## Findings (root causes that block transcript-only editing)
**Finding A — Whisper bundles pauses INTO word durations.** Example: the word "only"
is timestamped 9.68→14.84s (5.16s) because the speaker paused ~5s before it. So
word-to-word gaps do NOT reveal pauses — the pauses hide inside word spans. Cuts and
caption timing derived from word timestamps drift. Use audio silence boundaries.

**Finding B — Whisper COLLAPSES repeated speech, inconsistently.** In the full raw
transcript, "Most people think that success comes from talent…" (said twice) and
"The desperate candidate…fear" (said 3×) appear only ONCE. The repeated audio is still
there, hidden under a pause-inflated word. **No transcript-based detector can remove a
repeat the transcriber deleted.** Re-transcribing the shorter *cut* exposes them.

## ClipForge gaps (and status)
1. **Silence detection** — `lib/clipforge/silence-detection.ts` is already RMS/audio-based.
   ✅ NOT a gap.
2. **Repeat detection runs on the remapped ORIGINAL transcript.** Phase 2 uses
   `buildTimelineTranscriptWords`, which remaps the first Whisper pass (with its collapsed
   repeats, Finding B) and never re-transcribes the cut. ❌ GAP → fix below.
3. **Caption timing uses Whisper word times** that include bundled pauses (Finding A).
   Minor drift; lower priority.

## Fix implemented in the tool
Add a **post-cut re-transcription repeat pass** to `executeAutoProducePipeline`: after the
silence + first repeat cuts, rebuild the post-cut audio, re-transcribe it, and run the
sentence/phrase repeat detector on the FRESH transcript so collapsed repeats become
visible and get cut. (See clipforge-manager.ts Phase 2b.)
