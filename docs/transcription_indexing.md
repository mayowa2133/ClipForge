# ClipForge Transcription Indexing

ClipForge indexes imported `video` and `audio` assets into clip-local metadata that is stored in `project.clipforge.mediaMetadataById`.

## Provider Order

1. `SRT Import`
2. `Whisper CLI` (when enabled)
3. Browser-local Whisper worker fallback

Every provider is normalized into:

- `words: [{ text, start_ms, end_ms }]`
- `segments: [{ text, start_ms, end_ms }]`
- transcription lifecycle fields (`status`, `provider`, `language`, `error`, `indexedAt`)

## Enabling Whisper CLI

Set these in `apps/web/.env.local`:

```bash
CLIPFORGE_WHISPER_CLI_ENABLED=true
NEXT_PUBLIC_CLIPFORGE_WHISPER_CLI_ENABLED=true
CLIPFORGE_WHISPER_CLI_BIN=whisper
CLIPFORGE_WHISPER_CLI_MODEL=small
```

ClipForge calls a local Next route at `/api/clipforge/transcribe`, which shells out to the configured Whisper binary and reads the JSON output.

## Fallback Behavior

If the CLI is disabled or unavailable, ClipForge falls back to the existing browser Whisper worker.

The browser worker currently returns segment timestamps, not native word timestamps. ClipForge synthesizes deterministic word timings by evenly subdividing each segment duration so downstream features still have a usable word stream.

## SRT Import

Each clip in the Assets panel supports `Import SRT...`.

- SRT import replaces transcript text/timings for that clip
- existing silence metadata is preserved
- ClipForge synthesizes deterministic word timings from segment timings

## Current Consumers

- Caption generation prefers indexed clip metadata first
- Chat project summarization uses indexed transcript snippets
- Silence-aware timeline ops continue to use the same clip metadata record
