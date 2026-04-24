# ClipForge Chat Prompting

## Goal

Convert plain-English edit requests into deterministic `TimelineDiffOp[]` JSON.

## Provider Contract

- Interface: `proposeEdits(userText, projectSummary, context) -> { ops, provider, fallbackUsed, warnings, rawText? }`
- Output: JSON ops only (no prose) at the model layer, wrapped in planner metadata for the UI
- Allowed ops are restricted to the ClipForge schema.

Planner context is explicit and request-scoped:

- `playhead_ms`
- `selected_segment_ids`
- `active_scene_id`

ClipForge now resolves implicit references with this precedence:

1. explicit reference in the prompt
2. current selection
3. same-request carry-over (`it`, `that one`)
4. playhead fallback

## Current Providers

1. `HeuristicChatOpsProvider`
2. `OpenAIChatOpsProvider` (browser client for the internal `/api/clipforge/chat/plan` route)
3. `FallbackChatOpsProvider` (`auto` mode: heuristic first, OpenAI fallback)

Planner modes:

- `auto` (default): prefers deterministic planning for supported edit intents and falls back to the server-backed model planner when deterministic planning is not definitive
- `heuristic`: uses deterministic local parsing only
- `openai`: forces the server-backed model planner and fails closed

Users can now change planner mode in-app from the left `Settings` tab. The env value still defines the initial default for a fresh browser state.

## In-app Health

- `AI Planner` settings also show planner health.
- Health is configuration-based only in M18:
  - `ready`: route is available and OpenAI server config is complete
  - `degraded`: route is available but the OpenAI server config is incomplete
  - `unavailable`: the health route itself could not complete
- The health check does not perform a live outbound request to OpenAI.

## Few-shot Prompt

Few-shot examples are stored in:

- `apps/web/src/lib/clipforge/chat/few-shot-prompt.ts`

The prompt includes examples for:

- pacing changes (`MAKE_VERSION`)
- pause removal (`REMOVE_SILENCE`)
- text overlays (`ADD_TEXT_OVERLAY`)
- caption style changes (`SET_CAPTION_STYLE`)
- transcript-precise targeted cuts (`CUT_RANGE`)
- imported-asset B-roll insertion (`INSERT_BROLL`)
- context-aware segment ops (`TRIM_CLIP`, `MOVE_SEGMENT`, `DELETE_SEGMENT`, `DUPLICATE_SEGMENT`)
- context-aware caption fixes (`FIX_CAPTION_TEXT`)

## Validation Loop

1. Build project summary (`ProjectSummarizer`)
   - transcript snippets are now sourced from indexed clip metadata when available
2. Provider proposes ops
   - server-backed model output is parsed and structurally guarded before it reaches the UI
   - phrase-based cuts and B-roll now resolve against indexed timeline word timestamps
3. Deterministic semantic safety runs before UI acceptance
   - repairs safe issues (for example: clamped ranges, recovered IDs)
   - drops unrecoverable ops
   - returns clarification when repair target recovery is ambiguous
4. Validator-aware deterministic reconciliation runs once
   - captures first-pass `validateOps` errors (`code`, `opIndex`)
   - applies deterministic repair/drop actions for known validator codes
   - re-validates exactly once before UI review acceptance
5. Deterministic non-mutating plan preview runs on reconciled ops
   - renders human-readable impact cards
   - supports per-op include/exclude toggles
   - re-validates the selected subset before apply
   - supports jump-to-target (seek + select) from each impact card
6. User reviews selected JSON ops in the chat panel
7. Apply via OpenCut command manager

The model layer never bypasses `OpsValidator`. Invalid model output is rejected before the normal validation pass, and `auto` mode falls back to the heuristic planner.

## B-roll Prompt Rules (MVP2)

- B-roll sources must already be imported into the media bin.
- The prompt must name the imported clip explicitly.
- The prompt must include an explicit timing window.

Examples:

- `add b-roll using beach.mp4 from 5s to 8s`
- `insert b roll using office-cutaway.mov from 12s to 15s`
- `use city.mp4 as b-roll from 3s to 6s`

Phrase-anchored B-roll is also supported:

- `add b-roll using beach.mp4 when i say "summer" for 3s`

## Text Overlay Prompt Rules (M14)

- Text overlays must include quoted text content.
- Position defaults to `top` when omitted.
- Start time defaults to the beginning of the timeline when omitted.

Examples:

- `add text at the top that says "this"`
- `put "watch this" at the top`
- `add text "subscribe" at the bottom for 3s`
- `add text here that says "watch this"`

## Context-Aware References (M20)

- Selection-first:
  - `this`
  - `that`
  - `this clip`
  - `this caption`
- Playhead-anchored:
  - `here`
  - `at the playhead`
  - `at this point`
- Same-request carry-over only:
  - `it`
  - `that one`

Carry-over never persists across separate chat submissions.

## Ambiguity Clarification (M21)

- If more than one valid clip or caption matches a single-target request, ClipForge no longer auto-picks the first match.
- The chat panel now shows a local clarification step first.
- After you choose one option, the planner re-runs and then shows the normal JSON ops review.
- Ordinal references (`first`, `second`, `last`) remain the preferred way to avoid clarification when multiple targets exist.
- Ambiguity safety now runs after planning in all modes (`auto`, `openai`, `heuristic`), so model output is also blocked when deterministic ambiguity remains.
- In `auto` mode, heuristic fallback still provides deterministic clarification when the model planner is non-definitive.

## Semantic Plan Safety (M23)

- After planner output, ClipForge applies a deterministic semantic safety pass before showing JSON for review.
- Safety outcomes:
  - repaired: the op is kept with deterministic fixes and a warning
  - dropped: the op is removed as unsafe/unrecoverable
  - blocked: no safe ops remain, or repair itself is ambiguous and clarification is required
- This layer is provider-agnostic and applies to `openai`, `auto`, and `heuristic`.
- `OpsValidator` remains the final authority before apply.

## Deterministic Plan Preview (M25)

- Preview is dry-run only and never mutates project state.
- Impact cards are deterministic and generated from before/after timeline snapshots.
- Users can disable individual ops before apply.
- Apply always runs on the selected subset only after validation passes.

## Export Preflight (M26 cross-reference)

- Chat-generated timelines and manual timelines now share the same top-right export preflight gate.
- Export preflight runs deterministic readiness checks before encoding starts and blocks export only on errors.
- One-click repair actions (when available) run explicitly via existing editor state/command paths, then preflight re-runs.
- Runtime export diagnostics remain the final authority after export starts.

## Phrase Cut Rules (M14)

- Phrase cuts require an exact quoted phrase.
- Matching is token-exact and uses indexed transcript words.
- If the phrase appears multiple times, the first occurrence is used unless the prompt specifies `first time`, `second time`, or `third time`.

Examples:

- `cut where i say "bro"`
- `remove the part where i say "bro"`
- `cut where i say "bro" the second time`
