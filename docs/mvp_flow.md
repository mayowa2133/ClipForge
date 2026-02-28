# ClipForge MVP Flow

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
2. Enter a plain-English request (for example: `make it faster`).
3. Chat provider proposes deterministic JSON timeline ops.
4. Proposed ops are shown in review UI.
5. Click `Apply` to validate + apply ops through OpenCut command stack.
6. Use undo/redo normally and continue iterating.

Example B-roll prompt:

- `add b-roll using beach.mp4 from 5s to 8s`

## Flow C: Best-effort Export

1. Click `Export` in the Assets panel.
2. ClipForge attempts OpenCut binary export.
3. If export succeeds, a downloadable media file is produced.
4. If export is unavailable, ClipForge generates a preview artifact JSON snapshot.
