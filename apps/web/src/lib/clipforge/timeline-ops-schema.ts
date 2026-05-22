import type { TimelineDiffOp } from "@/types/clipforge";

export const ALLOWED_TIMELINE_OP_TYPES = new Set<TimelineDiffOp["type"]>([
	"REMOVE_SILENCE",
	"REMOVE_FILLER",
	"TRIM_CLIP",
	"CUT_RANGE",
	"ADD_TEXT_OVERLAY",
	"MOVE_SEGMENT",
	"SWAP_SEGMENTS",
	"DELETE_SEGMENT",
	"DUPLICATE_SEGMENT",
	"INSERT_BROLL",
	"SET_ASPECT_RATIO",
	"SET_CAPTION_STYLE",
	"FIX_CAPTION_TEXT",
	"MAKE_VERSION",
	"AUTO_REFRAME",
	"BEAT_SYNC_CUTS",
	"SET_SPEED_RAMP",
	"SMART_ZOOM",
	"EXTRACT_HIGHLIGHT",
	"APPLY_COLOR_GRADE",
	"SET_KEYFRAME_EASING",
]);

export const ALLOWED_ASPECT_RATIO_PRESETS = new Set(["9:16", "1:1", "16:9"]);
export const ALLOWED_CAPTION_POSITIONS = new Set(["bottom", "center"]);
export const ALLOWED_OVERLAY_TEXT_POSITIONS = new Set(["top", "center", "bottom"]);
export const ALLOWED_HIGHLIGHT_MODES = new Set(["none", "line", "word"]);
export const ALLOWED_BROLL_LANES = new Set(["overlay-primary"]);
export const ALLOWED_BROLL_FIT_MODES = new Set(["cover"]);
export const ALLOWED_TEXT_OVERLAY_STYLE_IDS = new Set([
	"clean-bottom",
	"bold-center",
	"overlay-top",
	"overlay-center",
]);

export const ALLOWED_SPEED_RAMP_CURVES = new Set([
	"ease-in",
	"ease-out",
	"ease-in-out",
	"flash",
]);
export const ALLOWED_SMART_ZOOM_EASINGS = new Set([
	"linear",
	"ease-in",
	"ease-out",
	"ease-in-out",
]);
export const ALLOWED_HIGHLIGHT_STRATEGIES = new Set([
	"visual-peaks",
	"speech-density",
	"combined",
]);
export const ALLOWED_COLOR_GRADE_PRESETS = new Set([
	"warm-vintage",
	"cool-cinematic",
	"vibrant-social",
	"desaturated-film",
	"golden-hour",
	"moody-dark",
]);
export const ALLOWED_KEYFRAME_EASING_TYPES = new Set([
	"linear",
	"ease-in",
	"ease-out",
	"ease-in-out",
	"spring",
	"bounce",
]);
export const ALLOWED_KEYFRAME_PROPERTIES = new Set([
	"position",
	"scale",
	"rotation",
	"opacity",
]);

export function isKnownTimelineOpType(type: unknown): type is TimelineDiffOp["type"] {
	return (
		typeof type === "string" &&
		ALLOWED_TIMELINE_OP_TYPES.has(type as TimelineDiffOp["type"])
	);
}
