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
8. Click `Apply` to validate + apply ops through OpenCut command stack.
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
2. ClipForge attempts OpenCut binary export.
3. If export succeeds, a downloadable media file is produced.
4. If export is unavailable or fails in an unsupported case, ClipForge can still generate a preview artifact JSON snapshot as a last-resort fallback with diagnostics.
