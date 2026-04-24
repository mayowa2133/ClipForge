# Lessons

This file records concrete engineering lessons from bugs, regressions, and implementation mistakes in ClipForge.

Use this format for new entries:

## YYYY-MM-DD - Short title
- Context: What we were building or changing.
- Failure: What went wrong.
- Root cause: The real technical cause.
- Fix: What changed.
- Guardrail: What to check next time to avoid repeating it.

## 2026-03-16 - Auto planner hid the command-first pipeline
- Context: Smoke-testing the M51 to M53 chat flows in the live UI.
- Failure: `Auto` mode returned legacy-style results instead of the newer command-first finishing flow.
- Root cause: Provider resolution preferred the OpenAI path before the heuristic planner, so any non-empty older response shape could win first.
- Fix: Switched auto resolution to prefer the deterministic heuristic planner first in `/apps/web/src/lib/clipforge/chat/provider-resolver.ts`.
- Guardrail: When shipping a new planner contract, verify the default provider path exercises it in the real UI, not just in isolated tests.

## 2026-03-16 - Reference-caption matching failed for transcriptless references
- Context: Testing the new reference-video guided finishing flow.
- Failure: `Only match the captions from the example` produced no safe commands for a reference clip without transcript-derived caption metadata.
- Root cause: Reference caption matching depended too heavily on transcript-backed reveal analysis and had no deterministic fallback.
- Fix: Added a tone-based caption reveal fallback in `/apps/web/src/lib/clipforge/reference-video.ts` and consumed it in `/apps/web/src/core/managers/clipforge-manager.ts`.
- Guardrail: Reference-analysis features must degrade gracefully when transcript, beat, or frame-derived metadata is missing.

## 2026-03-16 - Project saves could persist stale scene state
- Context: Investigating why opener-targeted prompts failed after reload.
- Failure: Reloaded local projects could lose their effective video timeline, causing prompts like `Speed up the opener 15%` to have no valid target.
- Root cause: `saveCurrentProject()` persisted `editor.scenes.getScenes()` instead of the live `editor.timeline` tracks, which let stale scene state overwrite real timeline state.
- Fix: Updated `/apps/web/src/core/managers/project-manager.ts` to save current timeline tracks and added regression coverage in `/apps/web/src/core/managers/__tests__/project-manager.test.ts`.
- Guardrail: Persistence code should always serialize the authoritative runtime state, not a secondary cached representation.

## 2026-03-16 - Heuristics should not assume current-scene summaries are populated
- Context: Improving direct edit prompts like speed changes and opener targeting.
- Failure: Some prompts could not resolve a valid clip target when `current_scene_segments` was empty even though top-level project segments still existed.
- Root cause: Heuristic targeting logic relied too narrowly on current-scene summaries.
- Fix: Added fallback targeting against top-level segment summaries in `/apps/web/src/lib/clipforge/chat/providers/heuristic.ts`.
- Guardrail: Planner context readers should treat nested summaries as optional views over the project, not the sole source of truth.

## 2026-03-17 - First-run UX checks must clear persisted browser state
- Context: Verifying M55 first-time guidance and assistant defaults in the live UI.
- Failure: The new `Start here` card and other first-run surfaces did not appear during the initial smoke pass, which made the implementation look incomplete.
- Root cause: Zustand persistence in localStorage preserved earlier onboarding and assistant-completion state, so the browser was not actually in a first-run condition.
- Fix: Clear persisted browser storage before first-run smoke tests and then re-run the launch path from `/projects`.
- Guardrail: Any UX milestone that changes onboarding, empty states, or first-use defaults needs a clean-storage verification pass in addition to normal smoke tests.

## 2026-03-17 - Large-file helper edits can silently land inside another function
- Context: Adding export-preflight presentation helpers during the M55 UI cleanup.
- Failure: TypeScript failed because the new exported helpers were inserted inside `formatExportDiagnostics()`, which broke both the existing function and the new exports.
- Root cause: In a long file, a patch was applied against the wrong anchor without re-checking the surrounding scope boundary.
- Fix: Moved the helpers back to module scope, corrected the export issue-code mappings to the real `ExportPreflightCode` union, and re-ran typecheck immediately.
- Guardrail: When adding exported helpers to long modules, re-open the exact insertion region after patching and confirm the new code is outside any enclosing function before moving on.
