# ClipForge Production Readiness

ClipForge currently ships as a local-first browser editor with deterministic assistant workflows. The items below are the major product gaps that must be closed before positioning it as a fully managed, publish-critical creative platform.

## Closed in this pass

- ClipForge auto-edit and chat are enabled by default in the fork and Docker deployment.
- Planner docs now match the implementation: `auto` mode prefers deterministic planning first, then uses the model planner as fallback.
- High-level draft prompts can now request a model-backed creative brief in `auto`/`openai` modes when OpenAI is configured, with deterministic heuristic fallback.
- CI now runs lint, unit tests, ClipForge chat evals, and production build instead of soft-passing tests.
- App/auth metadata now uses ClipForge naming where the active code path exposes the product name.

## Still Local-First

Projects and media are stored in browser storage: IndexedDB for project metadata and OPFS for media files. This preserves local-first privacy, but it means there is no account-backed backup, project sync, cross-device recovery, collaboration, or share-link workflow yet.

Production target:
- explicit `Local project` and `Cloud project` modes
- encrypted upload/sync pipeline for media
- per-user project records and storage quotas
- backup/recovery and export artifact history

## AI Creative Direction

High-level draft planning now has a model-backed creative brief step when OpenAI is configured, but the applied edit recipe remains deterministic and preset-driven. This keeps the workflow reliable and undoable while leaving deeper semantic creative direction as a production-hardening item.

Production target:
- eval suites for high-level creative outputs, not only command extraction
- trend/reference understanding beyond explicit user-provided cues
- version scoring for hook strength, pacing, and platform fit
- user-visible confidence, source signals, and editable assumptions

## Transcription

Current provider order is SRT import, optional local Whisper CLI, then browser Whisper. Browser Whisper provides segment timestamps; word timestamps are synthesized from segment timing.

Production target:
- managed transcription queue with retries and progress
- native word-level timestamps
- language detection and diarization options
- privacy controls for upload/local-only behavior

## Export

Export currently runs in the browser through the shared render backend and Mediabunny. Recovery can produce diagnostics or a preview artifact when video export fails.

Production target:
- server/worker render queue for long or publish-critical exports
- durable export artifacts with retry/resume
- parity checks across all supported effects
- platform-specific presets and validation

## Brand And Legal

ClipForge is a fork layered on OpenCut internals. Some package names and upstream references intentionally remain `opencut`, but public product surfaces should consistently say ClipForge unless referring to upstream lineage.

Production target:
- final domain and social handles
- updated privacy/terms copy for actual data flows
- explicit upstream attribution
- release checklist that blocks mixed-brand public pages
