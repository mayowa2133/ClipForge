# ClipForge auto-produce editing strategy

This is the durable record of *how* ClipForge turns a raw talking-head take into a
finished reel/TikTok, and *why* the pipeline is shaped the way it is. The behavior
is enforced in code (`executeAutoProducePipeline` in
`apps/web/src/core/managers/clipforge-manager.ts`); this document explains the
reasoning so the design survives refactors.

It was reverse-engineered by recreating a human reference edit (255s raw → 72s
final) from scratch with general tools (ffmpeg, openai-whisper, python/PIL), then
porting the learnings back into the pipeline.

## The pipeline (what it always does)

| Phase | Step | What it removes / adds |
|-------|------|------------------------|
| —  | Place raw video on the main track | — |
| —  | Silence analysis (waveform **RMS energy**, not Whisper gaps) | — |
| —  | Ensure transcript (Whisper indexing) | — |
| 1  | Cut silence gaps + repeated/mistake takes (transcript similarity) | dead air, obvious repeats |
| 2  | Word-level stutter removal | "only only", "that that" |
| 2b | **Re-transcribe the post-cut audio**, cut collapsed repeats | repeats Whisper hid (see Finding B) |
| 3  | AI editorial pass → trim toward target keep-ratio | overruns past ~0.28–0.30 of raw |
| —  | Word-by-word captions on the POST-CUT timeline | ALL-CAPS, white + thick black outline, lower-center |
| —  | Title overlay (full duration) | 2-line, upper third |
| —  | Background music (added last) | bed at ~0.30 volume |

Reference target shape: **1080×1920, ~72s, ~0.28 keep-ratio** vs the raw.

## Why it's shaped this way — two Whisper quirks

These two findings are the whole reason Phases use audio + re-transcription instead
of trusting the first transcript.

### Finding A — Whisper bundles pauses INTO word durations
A word that follows a long pause gets a stretched timestamp. Example from the
reference: the word "only" was timestamped 9.68 → 14.84s (5.16s) because the speaker
paused ~5s before saying it. **Word-to-word gaps therefore do NOT reveal pauses** —
the pause hides inside the next word's span.

➡️ **Cut on audio silence (`silence-detection.ts`, RMS energy), never on Whisper
word gaps.** Caption timing derived from raw word times also drifts for the same
reason.

### Finding B — Whisper COLLAPSES repeated speech, inconsistently
When a creator does multiple takes of the same line back-to-back, Whisper often
transcribes it **once**. In the reference raw, "Most people think that success comes
from talent…" (said twice) and "The desperate candidate… fear" (said 3×) each appear
a single time in the full-video transcript — the extra audio is still there, hidden
under a pause-inflated word.

**Consequence:** no transcript-based detector can cut a repeat the transcriber
deleted from the transcript. The first-pass repeat detector (Phase 1) literally
cannot see them.

➡️ **Re-transcribe the SHORTER post-cut audio (Phase 2b).** Whisper collapses less
on shorter input, so the repeats reappear in the fresh transcript and get cut. This
is implemented as `detectRepeatsByRetranscription`: rebuild the post-cut audio from
the surviving clips → encode WAV (`encodeWavPcm16`) → POST to the Whisper CLI
transcribe route → run `/detect-repeats` on the fresh transcript → apply the cuts.
It is non-fatal: if no CLI/cloud transcriber is available, the pass is skipped.

## Proof this works

Recreating the reference by hand with this strategy reproduced **94.8%** of the
reference transcript in order (208/221 words), at 1080×1920, with matching title and
caption styling. Running the strategy *through ClipForge* (with Phase 2b) on the same
raw footage removed both collapsed repeats ("Most people think" ×0, "desperate
candidate" ×0) and landed at 71.2s vs the 72s reference.

## Component map

- `apps/web/src/core/managers/clipforge-manager.ts` — `executeAutoProducePipeline`
  (the phases) and `detectRepeatsByRetranscription` (Phase 2b) + `encodeWavPcm16`.
- `apps/web/src/lib/clipforge/silence-detection.ts` — RMS/audio silence detection
  (Finding A).
- `/api/clipforge/transcribe` — Whisper CLI route used for the re-transcription.
- `/api/clipforge/detect-repeats` — repeat detector run on the fresh transcript.
