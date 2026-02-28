# ClipForge Architecture (M11)

## Goals

ClipForge extends OpenCut in-place to support fast short-form editing workflows:

1. Multi-clip ingest and auto assembly
2. Caption generation and styling
3. Chat-driven, deterministic timeline editing
4. Reliable undo/redo and project persistence

## Integration Principle

ClipForge is layered onto OpenCut's existing architecture:

- Same UI shell, timeline, properties inspector, and media bin
- Same project model and storage pipeline
- Same command manager for undo/redo
- No separate editor state or duplicated timeline model

## Core Building Blocks

### 1) Timeline Diff Ops

ClipForge introduces a typed, deterministic operation schema (`timeline diff ops`) that captures edit intent. These ops are:

- validated before apply
- applied as commands
- undoable/redoable through OpenCut command history
- serializable in project data

### 2) Ops Validator + Apply Engine

- `OpsValidator` checks ids, ranges, presets, and constraints against current project/timeline state.
- Apply engine transforms the active OpenCut project using only allowed ops.
- A command wrapper snapshots before/after state and integrates with existing undo/redo.

### 3) ClipForge Project Extension

OpenCut project schema is extended with ClipForge metadata:

- media indexing metadata (transcript, silence map pointers)
- caption style state
- optional ops audit history

This is versioned through OpenCut's migration system.

### 4) Future Modules (Post-M1)

- Auto-edit pipeline that emits timeline ops
- Chat panel + provider abstraction that proposes ops JSON
- Ops review/apply UI

### 5) Media Indexing Pipeline

- Imported `video` and `audio` assets get ClipForge metadata shells immediately.
- Background indexing then resolves a transcriber in this order:
  - `SRT Import` when the user explicitly imports `.srt`
  - `Whisper CLI` via local Next API route when enabled
  - browser-local Whisper worker fallback
- All providers normalize into ClipForge's shared `words` + `segments` metadata shape.
- Silence maps are computed from decoded clip audio and stored alongside transcript metadata.
- Captions and transcript-aware chat summarization read from stored clip metadata first, then fall back to timeline transcription only when metadata is missing.

## Data Flow (Target MVP)

1. User imports clips
2. ClipForge indexes media metadata (transcript/silence map)
3. Auto-edit or chat generates proposed timeline ops
4. Ops are validated
5. Apply command mutates OpenCut project/timeline
6. Preview updates from same timeline state
7. Undo/redo and save continue through OpenCut managers
