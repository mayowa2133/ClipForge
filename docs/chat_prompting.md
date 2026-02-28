# ClipForge Chat Prompting

## Goal

Convert plain-English edit requests into deterministic `TimelineDiffOp[]` JSON.

## Provider Contract

- Interface: `proposeEdits(userText, projectSummary) -> ops[]`
- Output: JSON ops only (no prose)
- Allowed ops are restricted to the ClipForge schema.

## Current Providers

1. `HeuristicChatOpsProvider` (default local provider)
2. `OpenAIChatOpsProvider` (optional; requires API key)

## Few-shot Prompt

Few-shot examples are stored in:

- `apps/web/src/lib/clipforge/chat/few-shot-prompt.ts`

The prompt includes examples for:

- pacing changes (`MAKE_VERSION`)
- pause removal (`REMOVE_SILENCE`)
- caption style changes (`SET_CAPTION_STYLE`)
- targeted cuts (`CUT_RANGE`)
- imported-asset B-roll insertion (`INSERT_BROLL`)

## Validation Loop

1. Build project summary (`ProjectSummarizer`)
   - transcript snippets are now sourced from indexed clip metadata when available
2. Provider proposes ops
3. `OpsValidator` validates structure/ids/ranges
4. User reviews in chat panel
5. Apply via OpenCut command manager

## B-roll Prompt Rules (MVP2)

- B-roll sources must already be imported into the media bin.
- The prompt must name the imported clip explicitly.
- The prompt must include an explicit timing window.

Examples:

- `add b-roll using beach.mp4 from 5s to 8s`
- `insert b roll using office-cutaway.mov from 12s to 15s`
- `use city.mp4 as b-roll from 3s to 6s`
