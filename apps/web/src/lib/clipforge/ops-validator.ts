import { calculateTotalDuration } from "@/lib/timeline";
import type {
	AddTextOverlayOp,
	ApplyColorGradeOp,
	AutoReframeOp,
	BeatSyncCutsOp,
	ExtractHighlightOp,
	FixCaptionTextOp,
	InsertBrollOp,
	MakeVersionOp,
	RemoveFillerOp,
	RemoveSilenceOp,
	SetAspectRatioOp,
	SetCaptionStyleOp,
	SetKeyframeEasingOp,
	SetSpeedRampOp,
	SmartZoomOp,
	CutRangeOp,
	DeleteSegmentOp,
	DuplicateSegmentOp,
	MoveSegmentOp,
	SwapSegmentsOp,
	TrimClipOp,
	TimelineDiffOp,
} from "@/types/clipforge";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";
import {
	ALLOWED_ASPECT_RATIO_PRESETS,
	ALLOWED_BROLL_FIT_MODES,
	ALLOWED_BROLL_LANES,
	ALLOWED_CAPTION_POSITIONS,
	ALLOWED_COLOR_GRADE_PRESETS,
	ALLOWED_HIGHLIGHT_MODES,
	ALLOWED_HIGHLIGHT_STRATEGIES,
	ALLOWED_KEYFRAME_EASING_TYPES,
	ALLOWED_KEYFRAME_PROPERTIES,
	ALLOWED_OVERLAY_TEXT_POSITIONS,
	ALLOWED_SMART_ZOOM_EASINGS,
	ALLOWED_SPEED_RAMP_CURVES,
	ALLOWED_TEXT_OVERLAY_STYLE_IDS,
	isKnownTimelineOpType,
} from "./timeline-ops-schema";

interface SegmentLocation {
	track: TimelineTrack;
	element: TimelineElement;
}

export interface TimelineOpsValidationError {
	opIndex: number;
	code: string;
	message: string;
}

export interface TimelineOpsValidationResult {
	valid: boolean;
	ops: TimelineDiffOp[];
	errors: TimelineOpsValidationError[];
}

export function validateTimelineDiffOps({
	project,
	ops,
	mediaAssets = [],
}: {
	project: TProject;
	ops: unknown[];
	mediaAssets?: MediaAsset[];
}): TimelineOpsValidationResult {
	const errors: TimelineOpsValidationError[] = [];
	const validatedOps: TimelineDiffOp[] = [];

	if (!Array.isArray(ops)) {
		return {
			valid: false,
			ops: [],
			errors: [
				{
					opIndex: -1,
					code: "ops_not_array",
					message: "Ops payload must be an array.",
				},
			],
		};
	}

	const activeScene =
		project.scenes.find((scene) => scene.id === project.currentSceneId) ??
		project.scenes[0];
	const tracks = activeScene?.tracks ?? [];
	const segmentLookup = buildSegmentLookup({ tracks });
	const mediaAssetLookup = new Map(mediaAssets.map((asset) => [asset.id, asset]));
	const totalDurationMs = Math.round(calculateTotalDuration({ tracks }) * 1000);

	for (const [opIndex, candidate] of ops.entries()) {
		const parseResult = validateSingleOp({
			opIndex,
			candidate,
			segmentLookup,
			mediaAssetLookup,
			totalDurationMs,
		});
		if (!parseResult.ok) {
			errors.push(...parseResult.errors);
			continue;
		}

		validatedOps.push(parseResult.op);
	}

	return {
		valid: errors.length === 0,
		ops: validatedOps,
		errors,
	};
}

function validateSingleOp({
	opIndex,
	candidate,
	segmentLookup,
	mediaAssetLookup,
	totalDurationMs,
}: {
	opIndex: number;
	candidate: unknown;
	segmentLookup: Map<string, SegmentLocation>;
	mediaAssetLookup: Map<string, MediaAsset>;
	totalDurationMs: number;
}):
	| { ok: true; op: TimelineDiffOp }
	| { ok: false; errors: TimelineOpsValidationError[] } {
	if (!isRecord(candidate)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "op_not_object",
					message: "Each op must be an object.",
				},
			],
		};
	}

	if (!isKnownTimelineOpType(candidate.type)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "unsupported_op",
					message: `Unsupported op type: ${String(candidate.type)}`,
				},
			],
		};
	}

	switch (candidate.type) {
		case "REMOVE_SILENCE":
			return validateRemoveSilenceOp({ opIndex, candidate });
		case "REMOVE_FILLER":
			return validateRemoveFillerOp({ opIndex, candidate });
		case "TRIM_CLIP":
			return validateTrimClipOp({ opIndex, candidate, segmentLookup });
		case "CUT_RANGE":
			return validateCutRangeOp({ opIndex, candidate });
		case "ADD_TEXT_OVERLAY":
			return validateAddTextOverlayOp({
				opIndex,
				candidate,
				totalDurationMs,
			});
		case "MOVE_SEGMENT":
			return validateMoveSegmentOp({ opIndex, candidate, segmentLookup });
		case "SWAP_SEGMENTS":
			return validateSwapSegmentsOp({ opIndex, candidate, segmentLookup });
		case "DELETE_SEGMENT":
			return validateDeleteSegmentOp({ opIndex, candidate, segmentLookup });
		case "DUPLICATE_SEGMENT":
			return validateDuplicateSegmentOp({ opIndex, candidate, segmentLookup });
		case "INSERT_BROLL":
			return validateInsertBrollOp({
				opIndex,
				candidate,
				mediaAssetLookup,
				totalDurationMs,
			});
		case "SET_ASPECT_RATIO":
			return validateSetAspectRatioOp({ opIndex, candidate });
		case "SET_CAPTION_STYLE":
			return validateSetCaptionStyleOp({ opIndex, candidate });
		case "FIX_CAPTION_TEXT":
			return validateFixCaptionTextOp({ opIndex, candidate, segmentLookup });
		case "MAKE_VERSION":
			return validateMakeVersionOp({ opIndex, candidate });
		case "AUTO_REFRAME":
			return validateAutoReframeOp({ opIndex, candidate });
		case "BEAT_SYNC_CUTS":
			return validateBeatSyncCutsOp({ opIndex, candidate, mediaAssetLookup });
		case "SET_SPEED_RAMP":
			return validateSetSpeedRampOp({ opIndex, candidate, segmentLookup });
		case "SMART_ZOOM":
			return validateSmartZoomOp({ opIndex, candidate, segmentLookup });
		case "EXTRACT_HIGHLIGHT":
			return validateExtractHighlightOp({ opIndex, candidate, segmentLookup });
		case "APPLY_COLOR_GRADE":
			return validateApplyColorGradeOp({ opIndex, candidate });
		case "SET_KEYFRAME_EASING":
			return validateSetKeyframeEasingOp({ opIndex, candidate, segmentLookup });
	}
}

function validateRemoveSilenceOp({
	opIndex,
	candidate,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		!isFiniteNumber(candidate.threshold_ms) ||
		!isFiniteNumber(candidate.pad_ms) ||
		!isFiniteNumber(candidate.min_keep_ms) ||
		candidate.threshold_ms <= 0 ||
		candidate.pad_ms < 0 ||
		candidate.min_keep_ms <= 0
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_remove_silence",
					message:
						"REMOVE_SILENCE requires threshold_ms>0, pad_ms>=0, min_keep_ms>0.",
				},
			],
		};
	}

	const op: RemoveSilenceOp = {
		type: "REMOVE_SILENCE",
		threshold_ms: candidate.threshold_ms,
		pad_ms: candidate.pad_ms,
		min_keep_ms: candidate.min_keep_ms,
	};
	return { ok: true, op };
}

function validateRemoveFillerOp({
	opIndex,
	candidate,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	const padMs = isFiniteNumber(candidate.pad_ms) ? candidate.pad_ms : 80;
	if (padMs < 0) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_remove_filler",
					message: "REMOVE_FILLER requires pad_ms >= 0.",
				},
			],
		};
	}

	const op: RemoveFillerOp = {
		type: "REMOVE_FILLER",
		pad_ms: padMs,
	};
	return { ok: true, op };
}

function validateTrimClipOp({
	opIndex,
	candidate,
	segmentLookup,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
	segmentLookup: Map<string, SegmentLocation>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.clip_id !== "string" ||
		!isFiniteNumber(candidate.in_ms) ||
		!isFiniteNumber(candidate.out_ms) ||
		candidate.in_ms < 0 ||
		candidate.out_ms < 0
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_trim_clip",
					message: "TRIM_CLIP requires clip_id and non-negative in_ms/out_ms.",
				},
			],
		};
	}

	const target = segmentLookup.get(candidate.clip_id);
	if (!target) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "clip_not_found",
					message: `TRIM_CLIP clip_id not found: ${candidate.clip_id}`,
				},
			],
		};
	}

	const sourceDuration =
		target.element.duration + target.element.trimStart + target.element.trimEnd;
	if (candidate.in_ms + candidate.out_ms >= sourceDuration) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "trim_exceeds_source",
					message: "TRIM_CLIP in_ms + out_ms must be less than source duration.",
				},
			],
		};
	}

	const op: TrimClipOp = {
		type: "TRIM_CLIP",
		clip_id: candidate.clip_id,
		in_ms: candidate.in_ms,
		out_ms: candidate.out_ms,
	};
	return { ok: true, op };
}

function validateCutRangeOp({
	opIndex,
	candidate,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		!isFiniteNumber(candidate.start_ms) ||
		!isFiniteNumber(candidate.end_ms) ||
		candidate.start_ms < 0 ||
		candidate.end_ms <= candidate.start_ms
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_cut_range",
					message: "CUT_RANGE requires start_ms>=0 and end_ms>start_ms.",
				},
			],
		};
	}
	const op: CutRangeOp = {
		type: "CUT_RANGE",
		start_ms: candidate.start_ms,
		end_ms: candidate.end_ms,
	};
	return { ok: true, op };
}

function validateAddTextOverlayOp({
	opIndex,
	candidate,
	totalDurationMs,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
	totalDurationMs: number;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.text !== "string" ||
		candidate.text.trim().length === 0 ||
		candidate.text.trim().length > 140 ||
		!isFiniteNumber(candidate.start_ms) ||
		!isFiniteNumber(candidate.end_ms) ||
		candidate.start_ms < 0 ||
		candidate.end_ms <= candidate.start_ms ||
		typeof candidate.position !== "string" ||
		typeof candidate.style_id !== "string" ||
		typeof candidate.font !== "string" ||
		candidate.font.trim().length === 0 ||
		!isFiniteNumber(candidate.size) ||
		candidate.size < 24 ||
		candidate.size > 160 ||
		typeof candidate.color !== "string" ||
		typeof candidate.outline !== "boolean" ||
		typeof candidate.background !== "boolean"
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_add_text_overlay",
					message:
						"ADD_TEXT_OVERLAY requires text, a valid range, position, style, font, size, color, outline, and background.",
				},
			],
		};
	}

	if (
		totalDurationMs > 0 &&
		candidate.end_ms > totalDurationMs + 1000
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "add_text_overlay_invalid_range",
					message:
						"ADD_TEXT_OVERLAY must stay within the timeline duration (plus a 1s tail allowance).",
				},
			],
		};
	}

	if (!ALLOWED_OVERLAY_TEXT_POSITIONS.has(candidate.position)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "add_text_overlay_invalid_style",
					message: "ADD_TEXT_OVERLAY position must be top, center, or bottom.",
				},
			],
		};
	}

	if (!ALLOWED_TEXT_OVERLAY_STYLE_IDS.has(candidate.style_id)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "add_text_overlay_invalid_style",
					message:
						"ADD_TEXT_OVERLAY style_id must be one of clean-bottom, bold-center, overlay-top, or overlay-center.",
				},
			],
		};
	}

	if (!isHexColor(candidate.color)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "add_text_overlay_invalid_color",
					message: "ADD_TEXT_OVERLAY color must be a #RRGGBB hex value.",
				},
			],
		};
	}

	const op: AddTextOverlayOp = {
		type: "ADD_TEXT_OVERLAY",
		text: candidate.text.trim(),
		start_ms: candidate.start_ms,
		end_ms: candidate.end_ms,
		position: candidate.position as AddTextOverlayOp["position"],
		style_id: candidate.style_id as AddTextOverlayOp["style_id"],
		font: candidate.font.trim(),
		size: candidate.size,
		color: candidate.color,
		outline: candidate.outline,
		background: candidate.background,
	};
	return { ok: true, op };
}

function validateMoveSegmentOp({
	opIndex,
	candidate,
	segmentLookup,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
	segmentLookup: Map<string, SegmentLocation>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.segment_id !== "string" ||
		!isFiniteNumber(candidate.to_ms) ||
		candidate.to_ms < 0
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_move_segment",
					message: "MOVE_SEGMENT requires segment_id and to_ms>=0.",
				},
			],
		};
	}

	if (!segmentLookup.has(candidate.segment_id)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "segment_not_found",
					message: `MOVE_SEGMENT segment_id not found: ${candidate.segment_id}`,
				},
			],
		};
	}

	const op: MoveSegmentOp = {
		type: "MOVE_SEGMENT",
		segment_id: candidate.segment_id,
		to_ms: candidate.to_ms,
	};
	return { ok: true, op };
}

function validateSwapSegmentsOp({
	opIndex,
	candidate,
	segmentLookup,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
	segmentLookup: Map<string, SegmentLocation>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.a_id !== "string" ||
		typeof candidate.b_id !== "string" ||
		candidate.a_id === candidate.b_id
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_swap_segments",
					message: "SWAP_SEGMENTS requires distinct a_id and b_id.",
				},
			],
		};
	}

	const aSegment = segmentLookup.get(candidate.a_id);
	const bSegment = segmentLookup.get(candidate.b_id);
	if (!aSegment || !bSegment) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "segment_not_found",
					message: "SWAP_SEGMENTS requires existing a_id and b_id.",
				},
			],
		};
	}

	if (aSegment.track.type !== bSegment.track.type) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "swap_track_type_mismatch",
					message:
						"SWAP_SEGMENTS currently requires both segments to be on the same track type.",
				},
			],
		};
	}

	const op: SwapSegmentsOp = {
		type: "SWAP_SEGMENTS",
		a_id: candidate.a_id,
		b_id: candidate.b_id,
	};
	return { ok: true, op };
}

function validateDeleteSegmentOp({
	opIndex,
	candidate,
	segmentLookup,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
	segmentLookup: Map<string, SegmentLocation>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (typeof candidate.segment_id !== "string") {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_delete_segment",
					message: "DELETE_SEGMENT requires segment_id.",
				},
			],
		};
	}

	if (!segmentLookup.has(candidate.segment_id)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "segment_not_found",
					message: `DELETE_SEGMENT segment_id not found: ${candidate.segment_id}`,
				},
			],
		};
	}

	const op: DeleteSegmentOp = {
		type: "DELETE_SEGMENT",
		segment_id: candidate.segment_id,
	};
	return { ok: true, op };
}

function validateDuplicateSegmentOp({
	opIndex,
	candidate,
	segmentLookup,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
	segmentLookup: Map<string, SegmentLocation>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.segment_id !== "string" ||
		!isFiniteNumber(candidate.to_ms) ||
		candidate.to_ms < 0
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_duplicate_segment",
					message: "DUPLICATE_SEGMENT requires segment_id and to_ms>=0.",
				},
			],
		};
	}

	if (!segmentLookup.has(candidate.segment_id)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "segment_not_found",
					message: `DUPLICATE_SEGMENT segment_id not found: ${candidate.segment_id}`,
				},
			],
		};
	}

	const op: DuplicateSegmentOp = {
		type: "DUPLICATE_SEGMENT",
		segment_id: candidate.segment_id,
		to_ms: candidate.to_ms,
	};
	return { ok: true, op };
}

function validateInsertBrollOp({
	opIndex,
	candidate,
	mediaAssetLookup,
	totalDurationMs,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
	mediaAssetLookup: Map<string, MediaAsset>;
	totalDurationMs: number;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.media_id !== "string" ||
		!isFiniteNumber(candidate.start_ms) ||
		!isFiniteNumber(candidate.end_ms) ||
		candidate.start_ms < 0 ||
		candidate.end_ms <= candidate.start_ms
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "insert_broll_invalid_range",
					message:
						"INSERT_BROLL requires media_id, start_ms>=0, and end_ms>start_ms.",
				},
			],
		};
	}

	if (totalDurationMs > 0 && candidate.end_ms > totalDurationMs) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "insert_broll_invalid_range",
					message:
						"INSERT_BROLL must stay within the active timeline duration.",
				},
			],
		};
	}

	const mediaAsset = mediaAssetLookup.get(candidate.media_id);
	if (!mediaAsset) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "insert_broll_missing_asset",
					message: `INSERT_BROLL media_id not found: ${candidate.media_id}`,
				},
			],
		};
	}

	if (mediaAsset.type !== "video" && mediaAsset.type !== "image") {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "insert_broll_asset_not_visual",
					message: "INSERT_BROLL requires an imported video or image asset.",
				},
			],
		};
	}

	if (
		typeof candidate.lane !== "string" ||
		!ALLOWED_BROLL_LANES.has(candidate.lane)
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "insert_broll_invalid_lane",
					message: "INSERT_BROLL lane must be overlay-primary.",
				},
			],
		};
	}

	if (
		typeof candidate.fit_mode !== "string" ||
		!ALLOWED_BROLL_FIT_MODES.has(candidate.fit_mode)
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "insert_broll_invalid_fit_mode",
					message: "INSERT_BROLL fit_mode must be cover.",
				},
			],
		};
	}

	if (typeof candidate.mute !== "boolean") {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "insert_broll_invalid_mute",
					message: "INSERT_BROLL mute must be a boolean.",
				},
			],
		};
	}

	const op: InsertBrollOp = {
		type: "INSERT_BROLL",
		media_id: candidate.media_id,
		start_ms: candidate.start_ms,
		end_ms: candidate.end_ms,
		lane: "overlay-primary",
		fit_mode: "cover",
		mute: candidate.mute,
	};
	return { ok: true, op };
}

function validateSetAspectRatioOp({
	opIndex,
	candidate,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.preset !== "string" ||
		!ALLOWED_ASPECT_RATIO_PRESETS.has(candidate.preset)
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_aspect_ratio",
					message: "SET_ASPECT_RATIO preset must be one of 9:16, 1:1, 16:9.",
				},
			],
		};
	}
	const op: SetAspectRatioOp = {
		type: "SET_ASPECT_RATIO",
		preset: candidate.preset as SetAspectRatioOp["preset"],
	};
	return { ok: true, op };
}

function validateSetCaptionStyleOp({
	opIndex,
	candidate,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.style_id !== "string" ||
		typeof candidate.font !== "string" ||
		!isFiniteNumber(candidate.size) ||
		candidate.size <= 0 ||
		typeof candidate.position !== "string" ||
		typeof candidate.outline !== "boolean" ||
		typeof candidate.highlight_mode !== "string"
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_caption_style",
					message:
						"SET_CAPTION_STYLE requires style_id, font, size>0, position, outline, and highlight_mode.",
				},
			],
		};
	}

	if (!ALLOWED_CAPTION_POSITIONS.has(candidate.position)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_caption_position",
					message: "SET_CAPTION_STYLE position must be bottom or center.",
				},
			],
		};
	}

	if (!ALLOWED_HIGHLIGHT_MODES.has(candidate.highlight_mode)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_highlight_mode",
					message: "SET_CAPTION_STYLE highlight_mode must be none, line, or word.",
				},
			],
		};
	}

	const op: SetCaptionStyleOp = {
		type: "SET_CAPTION_STYLE",
		style_id: candidate.style_id,
		font: candidate.font,
		size: candidate.size,
		position: candidate.position as SetCaptionStyleOp["position"],
		outline: candidate.outline,
		highlight_mode:
			candidate.highlight_mode as SetCaptionStyleOp["highlight_mode"],
	};
	return { ok: true, op };
}

function validateFixCaptionTextOp({
	opIndex,
	candidate,
	segmentLookup,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
	segmentLookup: Map<string, SegmentLocation>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.segment_id !== "string" ||
		typeof candidate.from !== "string" ||
		typeof candidate.to !== "string"
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_fix_caption_text",
					message: "FIX_CAPTION_TEXT requires segment_id, from, and to.",
				},
			],
		};
	}

	const segment = segmentLookup.get(candidate.segment_id);
	if (!segment) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "segment_not_found",
						message: `FIX_CAPTION_TEXT segment_id not found: ${candidate.segment_id}`,
					},
				],
			};
	}

	if (segment.element.type !== "text") {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "caption_segment_not_text",
					message: "FIX_CAPTION_TEXT can only target text segments.",
				},
			],
		};
	}

	const op: FixCaptionTextOp = {
		type: "FIX_CAPTION_TEXT",
		segment_id: candidate.segment_id,
		from: candidate.from,
		to: candidate.to,
	};
	return { ok: true, op };
}

function validateMakeVersionOp({
	opIndex,
	candidate,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		!isFiniteNumber(candidate.duration_target_s) ||
		!isFiniteNumber(candidate.aggressiveness) ||
		candidate.duration_target_s <= 0 ||
		candidate.aggressiveness < 0 ||
		candidate.aggressiveness > 1
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_make_version",
					message:
						"MAKE_VERSION requires duration_target_s>0 and aggressiveness between 0 and 1.",
				},
			],
		};
	}
	const op: MakeVersionOp = {
		type: "MAKE_VERSION",
		duration_target_s: candidate.duration_target_s,
		aggressiveness: candidate.aggressiveness,
	};
	return { ok: true, op };
}

function buildSegmentLookup({
	tracks,
}: {
	tracks: TimelineTrack[];
}): Map<string, SegmentLocation> {
	const lookup = new Map<string, SegmentLocation>();

	for (const track of tracks) {
		for (const element of track.elements) {
			lookup.set(element.id, { track, element });
		}
	}

	return lookup;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isHexColor(value: string): boolean {
	return /^#[0-9a-fA-F]{6}$/.test(value);
}

const ALLOWED_AUTO_REFRAME_FOCUS = new Set(["center", "top", "bottom"]);

function validateAutoReframeOp({
	opIndex,
	candidate,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.target_ratio !== "string" ||
		!ALLOWED_ASPECT_RATIO_PRESETS.has(candidate.target_ratio)
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_auto_reframe_ratio",
					message: "AUTO_REFRAME target_ratio must be one of 9:16, 1:1, 16:9.",
				},
			],
		};
	}

	const focus =
		typeof candidate.focus === "string" && ALLOWED_AUTO_REFRAME_FOCUS.has(candidate.focus)
			? candidate.focus
			: "center";

	const op: AutoReframeOp = {
		type: "AUTO_REFRAME",
		target_ratio: candidate.target_ratio as AutoReframeOp["target_ratio"],
		focus: focus as AutoReframeOp["focus"],
	};
	return { ok: true, op };
}

const ALLOWED_BEAT_SYNC_STRATEGIES = new Set(["on-beat", "on-downbeat", "half-beat"]);

function validateBeatSyncCutsOp({
	opIndex,
	candidate,
	mediaAssetLookup,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
	mediaAssetLookup: Map<string, MediaAsset>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (typeof candidate.source_asset_id !== "string") {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_beat_sync_source",
					message: "BEAT_SYNC_CUTS requires source_asset_id.",
				},
			],
		};
	}

	const asset = mediaAssetLookup.get(candidate.source_asset_id);
	if (!asset) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "beat_sync_asset_not_found",
					message: `BEAT_SYNC_CUTS source_asset_id not found: ${candidate.source_asset_id}`,
				},
			],
		};
	}

	if (asset.type !== "audio" && asset.type !== "video") {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "beat_sync_asset_not_audio",
					message: "BEAT_SYNC_CUTS requires an audio or video asset with audio.",
				},
			],
		};
	}

	const strategy =
		typeof candidate.strategy === "string" &&
		ALLOWED_BEAT_SYNC_STRATEGIES.has(candidate.strategy)
			? candidate.strategy
			: "on-beat";

	const op: BeatSyncCutsOp = {
		type: "BEAT_SYNC_CUTS",
		source_asset_id: candidate.source_asset_id,
		strategy: strategy as BeatSyncCutsOp["strategy"],
	};
	return { ok: true, op };
}

function validateSetSpeedRampOp({
	opIndex,
	candidate,
	segmentLookup,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
	segmentLookup: Map<string, SegmentLocation>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.clip_id !== "string" ||
		!isFiniteNumber(candidate.speed_start) ||
		!isFiniteNumber(candidate.speed_end) ||
		!isFiniteNumber(candidate.ramp_start_ms) ||
		!isFiniteNumber(candidate.ramp_end_ms)
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_speed_ramp",
					message:
						"SET_SPEED_RAMP requires clip_id, speed_start, speed_end, ramp_start_ms, and ramp_end_ms.",
				},
			],
		};
	}

	if (!segmentLookup.has(candidate.clip_id)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "clip_not_found",
					message: `SET_SPEED_RAMP clip_id not found: ${candidate.clip_id}`,
				},
			],
		};
	}

	if (candidate.speed_start < 0.1 || candidate.speed_start > 4.0 ||
		candidate.speed_end < 0.1 || candidate.speed_end > 4.0) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_speed_range",
					message: "SET_SPEED_RAMP speed values must be between 0.1 and 4.0.",
				},
			],
		};
	}

	if (candidate.ramp_start_ms < 0 || candidate.ramp_end_ms <= candidate.ramp_start_ms) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_ramp_range",
					message: "SET_SPEED_RAMP requires ramp_start_ms>=0 and ramp_end_ms>ramp_start_ms.",
				},
			],
		};
	}

	const curve =
		typeof candidate.curve === "string" && ALLOWED_SPEED_RAMP_CURVES.has(candidate.curve)
			? candidate.curve
			: "ease-in-out";

	const op: SetSpeedRampOp = {
		type: "SET_SPEED_RAMP",
		clip_id: candidate.clip_id,
		curve: curve as SetSpeedRampOp["curve"],
		speed_start: candidate.speed_start,
		speed_end: candidate.speed_end,
		ramp_start_ms: candidate.ramp_start_ms,
		ramp_end_ms: candidate.ramp_end_ms,
	};
	return { ok: true, op };
}

function validateSmartZoomOp({
	opIndex,
	candidate,
	segmentLookup,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
	segmentLookup: Map<string, SegmentLocation>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.clip_id !== "string" ||
		!isFiniteNumber(candidate.zoom_start) ||
		!isFiniteNumber(candidate.zoom_end) ||
		!isFiniteNumber(candidate.focus_x) ||
		!isFiniteNumber(candidate.focus_y)
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_smart_zoom",
					message:
						"SMART_ZOOM requires clip_id, zoom_start, zoom_end, focus_x, and focus_y.",
				},
			],
		};
	}

	if (!segmentLookup.has(candidate.clip_id)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "clip_not_found",
					message: `SMART_ZOOM clip_id not found: ${candidate.clip_id}`,
				},
			],
		};
	}

	if (candidate.zoom_start < 0.5 || candidate.zoom_start > 3.0 ||
		candidate.zoom_end < 0.5 || candidate.zoom_end > 3.0) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_zoom_range",
					message: "SMART_ZOOM zoom values must be between 0.5 and 3.0.",
				},
			],
		};
	}

	if (candidate.focus_x < 0 || candidate.focus_x > 1 ||
		candidate.focus_y < 0 || candidate.focus_y > 1) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_focus_point",
					message: "SMART_ZOOM focus_x and focus_y must be between 0 and 1.",
				},
			],
		};
	}

	const ease =
		typeof candidate.ease === "string" && ALLOWED_SMART_ZOOM_EASINGS.has(candidate.ease)
			? candidate.ease
			: "ease-in-out";

	const op: SmartZoomOp = {
		type: "SMART_ZOOM",
		clip_id: candidate.clip_id,
		zoom_start: candidate.zoom_start,
		zoom_end: candidate.zoom_end,
		focus_x: candidate.focus_x,
		focus_y: candidate.focus_y,
		ease: ease as SmartZoomOp["ease"],
	};
	return { ok: true, op };
}

function validateExtractHighlightOp({
	opIndex,
	candidate,
	segmentLookup,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
	segmentLookup: Map<string, SegmentLocation>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.source_clip_id !== "string" ||
		!isFiniteNumber(candidate.target_duration_s) ||
		candidate.target_duration_s <= 0
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_extract_highlight",
					message:
						"EXTRACT_HIGHLIGHT requires source_clip_id and target_duration_s>0.",
				},
			],
		};
	}

	if (!segmentLookup.has(candidate.source_clip_id)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "clip_not_found",
					message: `EXTRACT_HIGHLIGHT source_clip_id not found: ${candidate.source_clip_id}`,
				},
			],
		};
	}

	const strategy =
		typeof candidate.strategy === "string" &&
		ALLOWED_HIGHLIGHT_STRATEGIES.has(candidate.strategy)
			? candidate.strategy
			: "combined";

	const keepOriginal =
		typeof candidate.keep_original === "boolean" ? candidate.keep_original : false;

	const op: ExtractHighlightOp = {
		type: "EXTRACT_HIGHLIGHT",
		source_clip_id: candidate.source_clip_id,
		target_duration_s: candidate.target_duration_s,
		strategy: strategy as ExtractHighlightOp["strategy"],
		keep_original: keepOriginal,
	};
	return { ok: true, op };
}

function validateApplyColorGradeOp({
	opIndex,
	candidate,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.preset !== "string" ||
		!ALLOWED_COLOR_GRADE_PRESETS.has(candidate.preset)
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_color_grade_preset",
					message:
						"APPLY_COLOR_GRADE preset must be one of warm-vintage, cool-cinematic, vibrant-social, desaturated-film, golden-hour, moody-dark.",
				},
			],
		};
	}

	if (!isFiniteNumber(candidate.intensity) || candidate.intensity < 0 || candidate.intensity > 1) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_color_grade_intensity",
					message: "APPLY_COLOR_GRADE intensity must be between 0 and 1.",
				},
			],
		};
	}

	if (candidate.clip_id !== null && typeof candidate.clip_id !== "string") {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_color_grade_clip_id",
					message: "APPLY_COLOR_GRADE clip_id must be a string or null.",
				},
			],
		};
	}

	const op: ApplyColorGradeOp = {
		type: "APPLY_COLOR_GRADE",
		preset: candidate.preset as ApplyColorGradeOp["preset"],
		intensity: candidate.intensity,
		clip_id: (candidate.clip_id as string) ?? null,
	};
	return { ok: true, op };
}

function validateSetKeyframeEasingOp({
	opIndex,
	candidate,
	segmentLookup,
}: {
	opIndex: number;
	candidate: Record<string, unknown>;
	segmentLookup: Map<string, SegmentLocation>;
}): { ok: true; op: TimelineDiffOp } | { ok: false; errors: TimelineOpsValidationError[] } {
	if (
		typeof candidate.element_id !== "string" ||
		typeof candidate.property !== "string" ||
		typeof candidate.easing !== "string" ||
		!isFiniteNumber(candidate.keyframe_index) ||
		candidate.keyframe_index < 0
	) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_keyframe_easing",
					message:
						"SET_KEYFRAME_EASING requires element_id, property, easing, and keyframe_index>=0.",
				},
			],
		};
	}

	if (!segmentLookup.has(candidate.element_id)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "element_not_found",
					message: `SET_KEYFRAME_EASING element_id not found: ${candidate.element_id}`,
				},
			],
		};
	}

	if (!ALLOWED_KEYFRAME_PROPERTIES.has(candidate.property)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_keyframe_property",
					message:
						"SET_KEYFRAME_EASING property must be position, scale, rotation, or opacity.",
				},
			],
		};
	}

	if (!ALLOWED_KEYFRAME_EASING_TYPES.has(candidate.easing)) {
		return {
			ok: false,
			errors: [
				{
					opIndex,
					code: "invalid_easing_type",
					message:
						"SET_KEYFRAME_EASING easing must be linear, ease-in, ease-out, ease-in-out, spring, or bounce.",
				},
			],
		};
	}

	const op: SetKeyframeEasingOp = {
		type: "SET_KEYFRAME_EASING",
		element_id: candidate.element_id,
		property: candidate.property as SetKeyframeEasingOp["property"],
		easing: candidate.easing as SetKeyframeEasingOp["easing"],
		keyframe_index: Math.floor(candidate.keyframe_index),
	};
	return { ok: true, op };
}
