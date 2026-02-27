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

## Validation Loop

1. Build project summary (`ProjectSummarizer`)
2. Provider proposes ops
3. `OpsValidator` validates structure/ids/ranges
4. User reviews in chat panel
5. Apply via OpenCut command manager
