# ClipForge Chat Prompting

## Goal

Convert plain-English edit requests into deterministic `TimelineDiffOp[]` JSON.

## Provider Contract

- Interface: `proposeEdits(userText, projectSummary) -> { ops, provider, fallbackUsed, warnings, rawText? }`
- Output: JSON ops only (no prose) at the model layer, wrapped in planner metadata for the UI
- Allowed ops are restricted to the ClipForge schema.

## Current Providers

1. `HeuristicChatOpsProvider`
2. `OpenAIChatOpsProvider` (browser client for the internal `/api/clipforge/chat/plan` route)
3. `FallbackChatOpsProvider` (`auto` mode: OpenAI first, heuristic fallback)

Planner modes:

- `auto` (default): prefers the server-backed model planner and falls back to heuristic planning if the model request fails or returns no usable ops
- `heuristic`: uses deterministic local parsing only
- `openai`: forces the server-backed model planner and fails closed

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

## Validation Loop

1. Build project summary (`ProjectSummarizer`)
   - transcript snippets are now sourced from indexed clip metadata when available
2. Provider proposes ops
   - server-backed model output is parsed and structurally guarded before it reaches the UI
   - phrase-based cuts and B-roll now resolve against indexed timeline word timestamps
3. `OpsValidator` validates structure/ids/ranges
4. User reviews in chat panel
5. Apply via OpenCut command manager

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

## Phrase Cut Rules (M14)

- Phrase cuts require an exact quoted phrase.
- Matching is token-exact and uses indexed transcript words.
- If the phrase appears multiple times, the first occurrence is used unless the prompt specifies `first time`, `second time`, or `third time`.

Examples:

- `cut where i say "bro"`
- `remove the part where i say "bro"`
- `cut where i say "bro" the second time`
