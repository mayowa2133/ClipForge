# ClipForge Milestone Plan

Project base: OpenCut (`upstream`: `https://github.com/OpenCut-app/OpenCut`)

## Milestones

- [x] M0: Clone upstream OpenCut and verify dev build boot.
- [x] M1: Timeline ops schema, validator, and apply engine integrated with OpenCut undo/redo.
- [x] M2: Media ingest UI and local metadata storage scaffolding.
- [x] M3: Silence detection + `REMOVE_SILENCE` implementation.
- [x] M4: `Auto Edit TikTok` command to build a draft timeline.
- [ ] M5: Caption generator with `Clean Bottom` and `Bold Center` templates.
- [ ] M6: Chat panel + provider abstraction + ops review/apply flow.
- [ ] M7: Preview stability and export integration hook.
- [ ] M8: Tests, docs completion, and sample project.

## Working Rules

- Keep all new features inside OpenCut's existing app shell and state model.
- Reuse OpenCut command history for undo/redo (no parallel timeline state).
- Keep ClipForge features behind flags:
  - `ENABLE_CLIPFORGE_AUTO_EDIT`
  - `ENABLE_CLIPFORGE_CHAT`
- Keep changes modular for upstream rebasing.
