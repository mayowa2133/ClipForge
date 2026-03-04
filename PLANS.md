# ClipForge Milestone Plan

Project base: OpenCut (`upstream`: `https://github.com/OpenCut-app/OpenCut`)

## Milestones

- [x] M0: Clone upstream OpenCut and verify dev build boot.
- [x] M1: Timeline ops schema, validator, and apply engine integrated with OpenCut undo/redo.
- [x] M2: Media ingest UI and local metadata storage scaffolding.
- [x] M3: Silence detection + `REMOVE_SILENCE` implementation.
- [x] M4: `Auto Edit TikTok` command to build a draft timeline.
- [x] M5: Caption generator with `Clean Bottom` and `Bold Center` templates.
- [x] M6: Chat panel + provider abstraction + ops review/apply flow.
- [x] M7: Preview stability and export integration hook.
- [x] M8: Tests, docs completion, and sample project.
- [x] M9: Right-docked Chat panel with persisted split and shortcut.
- [x] M10: Chat-driven B-roll insertion from imported assets.
- [x] M10.1: Heuristic parser fix for B-roll prompts.
- [x] M11: Local Whisper indexing and transcript metadata pipeline.
- [x] M12: Shared binary preview backend contract.
- [x] M13: Video decode and compositing in the shared binary backend.
- [x] M14: Expanded chat ops for text overlays and phrase-aware edits.
- [x] M15: Production-ready model-backed chat planner with deterministic guardrails.
- [x] M16: Hardened export pipeline with diagnostics and parity checks.
- [x] M17: Demo project onboarding and guided first-run experience.
- [x] M18: In-app AI settings, planner health, and chat diagnostics.
- [x] M19: Expand chat planner to full deterministic segment ops.
- [ ] M20: Context-aware chat planning with playhead, selection, and same-request carry-over.

## Working Rules

- Keep all new features inside OpenCut's existing app shell and state model.
- Reuse OpenCut command history for undo/redo (no parallel timeline state).
- Keep ClipForge features behind flags:
  - `ENABLE_CLIPFORGE_AUTO_EDIT`
  - `ENABLE_CLIPFORGE_CHAT`
- Keep changes modular for upstream rebasing.
