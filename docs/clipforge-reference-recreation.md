# ClipForge Reference Recreation Workflow

This workflow is the operator-facing path for recreating a finished short from raw
footage, background music, and an edited reference.

## Human Workflow

1. Import the raw video, edited reference video, and background music.
2. In the Assets panel, set the edited video as the active reference.
3. Ask ClipForge chat to `match the reference`.
4. Review the proposed reference recreation draft before applying it:
   - Confirm the reference asset is the edited video.
   - Confirm the source asset pool contains the raw footage.
   - Confirm the imported music asset is selected.
5. Apply the draft.
6. Use the chat panel's `Reference recreation proof` section:
   - Duration delta should be close to zero, ideally below three seconds.
   - Filled slots should cover nearly all reference cut slots.
   - Alignment should be high enough for review.
   - Music should show `selected`.
7. Scrub the first hook cuts, caption timing, and final music mix.
8. Export the MP4.
9. Run the local comparison harness:

```sh
node _smoke-test/compare-reference.mjs _smoke-test/OUTPUT.mp4 _smoke-test/FINISHED-reference.mov
```

## Current Proof Harness

The comparison harness checks:

- Output duration delta against the reference.
- Portrait/aspect match.
- Sampled frame hash similarity.
- Audio RMS similarity with a small timing-offset tolerance.

Reports are written next to the smoke assets as
`_smoke-test/reference-comparison-<output-name>.json`.

## Current Verified Run

The current raw/music/reference smoke run passes the proof harness:

- Output: `_smoke-test/OUTPUT.mp4`
- Reference: `_smoke-test/FINISHED-reference.mov`
- Duration delta: `0.273s`
- Frame hash similarity: `0.8558`
- Audio RMS max-lag correlation: `0.3572`
- Report: `_smoke-test/reference-comparison-OUTPUT-mp4.json`

The proof run uses reference-duration pacing, exact raw-audio cut concatenation,
word captions, and a louder reference-style music bed. If a future reference
fails the audio check, tune the music volume or start offset before changing the
visual cut logic.
