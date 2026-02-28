# Timeline Ops Schema (M1)

ClipForge uses a deterministic `TimelineDiffOp[]` payload to represent edit intent.

## Allowed Ops

- `REMOVE_SILENCE { threshold_ms, pad_ms, min_keep_ms }`
- `TRIM_CLIP { clip_id, in_ms, out_ms }`
- `CUT_RANGE { start_ms, end_ms }`
- `MOVE_SEGMENT { segment_id, to_ms }`
- `SWAP_SEGMENTS { a_id, b_id }`
- `DELETE_SEGMENT { segment_id }`
- `DUPLICATE_SEGMENT { segment_id, to_ms }`
- `INSERT_BROLL { media_id, start_ms, end_ms, lane, fit_mode, mute }`
- `SET_ASPECT_RATIO { preset: "9:16" | "1:1" | "16:9" }`
- `SET_CAPTION_STYLE { style_id, font, size, position, outline, highlight_mode }`
- `FIX_CAPTION_TEXT { segment_id, from, to }`
- `MAKE_VERSION { duration_target_s, aggressiveness }`

## Safety and Validation

- Any op type outside this allow-list is rejected.
- Segment/clip ids must exist in active scene tracks.
- `INSERT_BROLL.media_id` must reference an imported visual asset (`video` or `image`).
- Numeric ranges are validated (`start < end`, non-negative, etc.).
- Caption and aspect-ratio enums are restricted.

## Apply Model

- Ops are applied in order to the active OpenCut scene/project state.
- Resulting before/after project snapshots are wrapped in a single command.
- Undo/redo uses OpenCut's command stack.

## Persistence

- Ops applied through ClipForge are appended to `project.clipforge.opsAudit`.
- Project schema is migrated to include ClipForge metadata (`v7 -> v8`).
