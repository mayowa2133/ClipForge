import type { TimelineDiffOp } from "@/types/clipforge";

export const ALLOWED_TIMELINE_OP_TYPES = new Set<TimelineDiffOp["type"]>([
	"REMOVE_SILENCE",
	"TRIM_CLIP",
	"CUT_RANGE",
	"MOVE_SEGMENT",
	"SWAP_SEGMENTS",
	"DELETE_SEGMENT",
	"DUPLICATE_SEGMENT",
	"SET_ASPECT_RATIO",
	"SET_CAPTION_STYLE",
	"FIX_CAPTION_TEXT",
	"MAKE_VERSION",
]);

export const ALLOWED_ASPECT_RATIO_PRESETS = new Set(["9:16", "1:1", "16:9"]);
export const ALLOWED_CAPTION_POSITIONS = new Set(["bottom", "center"]);
export const ALLOWED_HIGHLIGHT_MODES = new Set(["none", "line", "word"]);

export function isKnownTimelineOpType(type: unknown): type is TimelineDiffOp["type"] {
	return (
		typeof type === "string" &&
		ALLOWED_TIMELINE_OP_TYPES.has(type as TimelineDiffOp["type"])
	);
}
