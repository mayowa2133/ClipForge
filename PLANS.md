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
- [x] M20: Context-aware chat planning with playhead, selection, and same-request carry-over.
- [x] M21: Ambiguity detection, clarification UI, and safe target resolution for chat.
- [x] M22: Provider-agnostic ambiguity safety layer across all planner modes.
- [x] M23: Project-aware plan safety and deterministic auto-repair before apply.
- [x] M24: Validator-aware deterministic reconciliation before apply.
- [x] M25: Deterministic plan preview, selective apply, and jump-to-target.
- [x] M26: Export preflight gate with deterministic one-click repairs.
- [x] M27: Runtime export recovery with safe retry profiles and incident diagnostics bundle.
- [x] M28: Missing media relink and non-destructive broken-reference recovery.
- [x] M29: Reactive project health snapshots and export preflight consistency across Assets/Export surfaces.
- [x] M30: Export media compatibility guard with guided non-destructive recovery.
- [x] M31: Preview fidelity status, sampled frame parity checks, and unsupported-feature trust layer.
- [x] M32: Manual editing core with replace media, clip speed, separate audio, freeze frame, and audio properties.
- [x] M33: Motion foundations with transitions, keyframes, and animated visual properties.
- [x] M34: Visual finishing foundations with filters, effects, and color adjustment.
- [x] M35: UX convention alignment for recent editing surfaces.
- [x] M36: Project workflow foundations with multi-scene assembly, storyboard, and project-wide export.
- [x] M37: Caption studio with transcript-first editing, timing, styling, and legacy caption adoption.
- [x] M38: Audio studio foundations with voiceover, music workflow, ducking, and project mix controls.
- [x] M39: Title and graphics studio with brand-aware presets and motion presets.
- [x] M40: Social overlay system with timestamp cards, routine labels, chapter cards, and reusable style variants.
- [x] M41: Music-paced editing with beat detection, beat markers, quantize, split-on-beats, and auto montage.
- [x] M42: Reusable creator workflow with templates, scene recipes, and project kits.
- [x] M43: Multi-format publishing with version packs, auto reframe, safe layout adaptation, and multi-version export.
- [x] M44: AI creative director with brief-to-draft TikTok recipe planning and deterministic draft assembly.
- [x] M45: Footage intelligence with hook selection, moment scoring, and keep/cut ranking.

## Working Rules

- Keep all new features inside OpenCut's existing app shell and state model.
- Reuse OpenCut command history for undo/redo (no parallel timeline state).
- Keep ClipForge features behind flags:
  - `ENABLE_CLIPFORGE_AUTO_EDIT`
  - `ENABLE_CLIPFORGE_CHAT`
- Keep changes modular for upstream rebasing.
- Milestone tracker hygiene is mandatory:
  - every shipped milestone must update this file in the same change
  - `PLANS.md` should reflect shipped state, not just planned state
