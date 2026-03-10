# ClipForge MVP Flow

## Flow 0: Built-in Demo

1. Open a fresh empty project.
2. Click `Try Demo Project` in the onboarding modal (or in the empty `Assets` panel).
3. ClipForge creates a separate `ClipForge Demo` project and imports bundled demo clips through the normal media pipeline.
4. Demo transcript and silence metadata are seeded deterministically, so no Whisper setup is required.
5. ClipForge auto-builds a draft timeline, generates captions, and opens a short guided checklist.
6. Use the guided checklist to:
   - press play
   - open Chat
   - try a sample prompt
   - export from the top-right `Export` button

## Flow A: Import + Auto Edit

1. Open the Assets panel.
2. Click `Import Clips` and select multiple video clips.
3. ClipForge indexes imported clips in the background for captions and transcript-aware edits.
4. Click `Auto Edit TikTok`.
5. ClipForge builds a draft:
   - clips stitched in order
   - 9:16 aspect preset applied
   - silence-removal op pass applied using available silence metadata
6. Timeline + preview update in the same OpenCut editor surface.
7. Use normal OpenCut undo/redo to revert or refine.
8. The preview toolbar shows a fidelity status for the current render graph:
   - `Checking`: sampled parity is still running
   - `Exact`: sampled preview and export frames match without fallback
   - `Approximate`: fallback rendering was needed but no mismatch is known
   - `Unsupported`: parity mismatch or legacy fallback means preview should not be trusted as exact export output
9. If you need multiple publish formats, enable extra version targets in `Settings -> Version pack`, then switch the active preview target from the preview toolbar.
10. Use `Auto reframe selection` and `Apply safe layout` per target so the same edit remains usable for `9:16`, `1:1`, and `16:9` without rewriting the base scene.

## Flow B: Chat-driven Edits

1. Open the right-side `Chat` panel from the editor header toggle (or `Ctrl/Cmd + /`).
2. Optionally open the left `Settings` tab and choose the `AI Planner` mode (`Auto`, `OpenAI`, or `Heuristic`).
3. Enter a plain-English request (for example: `make it faster`).
4. The chat panel shows planner status before you submit:
   - `Heuristic mode active`
   - or OpenAI health (`ready`, `degraded`, `unavailable`)
   - plus current context (`selected` count and playhead time)
5. Chat planner proposes deterministic JSON timeline ops.
   - In `auto` mode, ClipForge prefers the server-backed model planner and falls back to the heuristic planner if needed.
6. If the target is ambiguous, the chat panel shows a clarification step first in all planner modes.
   - Choose the intended clip or caption, then ClipForge re-runs the plan.
7. Proposed ops are shown in review UI.
   - The review UI shows which planner produced the result and any fallback warnings.
   - A plan safety summary shows repaired/dropped/blocked outcomes across semantic safety + validator reconciliation.
   - Validator-aware reconciliation runs once before review so proposed ops are usually apply-ready.
   - A deterministic dry-run impact preview shows each op’s expected change before apply.
   - You can toggle individual ops on/off; ClipForge re-validates the selected subset.
   - `Jump` on a card seeks to its target time and selects the target segment when available.
8. Click `Apply` to validate + apply the selected subset through OpenCut command stack.
9. Use undo/redo normally and continue iterating.

Example chat prompts:

- `add b-roll using beach.mp4 from 5s to 8s`
- `add b-roll using beach.mp4 when i say "summer" for 3s`
- `add text at the top that says "this"`
- `cut where i say "bro"`
- `trim this clip by 0.5s at the start`
- `move this earlier by 1s`
- `replace "teh" with "the" in this caption`

## Flow C: Best-effort Export

1. Click the top-right `Export` button in the editor header.
2. The export popover runs deterministic preflight checks before render starts.
3. While the popover is open, preflight health refreshes reactively when timeline/media/project state changes.
4. Blocking issues disable the `Export` button until repaired.
5. For missing media blockers, use `Relink` first to restore the same missing `mediaId` with a compatible file and preserve timeline segment IDs/timing.
6. For compatibility blockers, preflight hard-blocks unresolved (`media-compatibility-unverified`) and incompatible decode paths (`unsupported-media-codec`, `unsupported-audio-decode`) before export starts.
7. Use `Scan` to verify unresolved compatibility, then `Relink` to replace incompatible media while preserving timeline IDs/timing.
8. If relink is not possible, use explicit destructive fallback (`Remove Affected Segments`) for that media reference.
9. Use per-issue `Fix` or `Fix all` for other deterministic repairs (for example invalid ranges or duration metadata mismatch).
10. Warning-only issues do not block export.
11. The export popover also shows the current preview fidelity report as a non-blocking trust signal.
12. ClipForge attempts OpenCut binary export once preflight is ready.
13. If export succeeds, a downloadable media file is produced.
14. If runtime export fails, the same popover shows deterministic recovery actions:
   - `Retry same settings`
   - `Retry safe profile` (for recommended deterministic fallback profile when available)
   - `Download diagnostics` incident bundle JSON
15. Every retry re-runs preflight before encoding starts.
16. If export is unavailable or fails in an unsupported case, ClipForge can still generate a preview artifact JSON snapshot as a last-resort fallback with diagnostics (including preflight snapshot metadata when available).
17. Export can now target the current active version or all enabled version-pack targets in one run, with target-specific suffixes on the output filenames.
