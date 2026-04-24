# ClipForge Production Readiness

ClipForge currently ships as a local-first browser editor with deterministic assistant workflows. The items below are the major product gaps that must be closed before positioning it as a fully managed, publish-critical creative platform.

## Closed in this pass

- ClipForge auto-edit and chat are enabled by default in the fork and Docker deployment.
- Planner docs now match the implementation: `auto` mode prefers deterministic planning first, then uses the model planner as fallback.
- High-level draft prompts can now request a model-backed creative brief in `auto`/`openai` modes when OpenAI is configured, with deterministic heuristic fallback.
- CI now runs typecheck, unit tests, ClipForge chat evals, and production build instead of soft-passing tests.
- App/auth metadata now uses ClipForge naming where the active code path exposes the product name.
- Production foundation APIs now exist for cloud project records, media sync state, share links, queued jobs, and rights receipts.

## Still Local-First

Projects and media are stored in browser storage: IndexedDB for project metadata and OPFS for media files. This preserves local-first privacy, but it means there is no account-backed backup, project sync, cross-device recovery, collaboration, or share-link workflow yet.

Foundation now available:
- authenticated cloud project records under `/api/clipforge/cloud/projects`
- media object sync records under `/api/clipforge/cloud/projects/{projectId}/media`
- share-link records under `/api/clipforge/cloud/projects/{projectId}/share-links`

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

Foundation now available:
- queued production jobs under `/api/clipforge/jobs` with transcription/export/publish/media-sync kinds

Production target:
- managed transcription queue with retries and progress
- native word-level timestamps
- language detection and diarization options
- privacy controls for upload/local-only behavior

## Export

Export currently runs in the browser through the shared render backend and Mediabunny. Recovery can produce diagnostics or a preview artifact when video export fails.

Foundation now available:
- export job records share the same queued job API as transcription

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

## Publishing And Rights

Direct platform publishing is not connected yet. Export destinations are used for warnings and file naming, but there are no TikTok, Instagram, or YouTube account connections, publish jobs, schedule status, or platform callbacks.

Foundation now available:
- publish job records under `/api/clipforge/jobs`
- rights receipt records under `/api/clipforge/rights/receipts`

Production target:
- destination OAuth connections and token refresh
- scheduled publish jobs with callback reconciliation
- title, description, hashtag, thumbnail, and artifact packaging
- automatic receipts for bundled/licensed assets
- destination-specific rights validation where rules are known
