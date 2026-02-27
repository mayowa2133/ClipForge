import type {
	FixCaptionTextOp,
	MakeVersionOp,
	RemoveSilenceOp,
	SetAspectRatioOp,
	SetCaptionStyleOp,
	CutRangeOp,
	DeleteSegmentOp,
	DuplicateSegmentOp,
	MoveSegmentOp,
	SwapSegmentsOp,
	TrimClipOp,
	TimelineDiffOp,
} from "@/types/clipforge";
import type { TProject } from "@/types/project";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";
import {
	ALLOWED_ASPECT_RATIO_PRESETS,
	ALLOWED_CAPTION_POSITIONS,
	ALLOWED_HIGHLIGHT_MODES,
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
}: {
	project: TProject;
	ops: unknown[];
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

	for (const [opIndex, candidate] of ops.entries()) {
		const parseResult = validateSingleOp({
			opIndex,
			candidate,
			segmentLookup,
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
}: {
	opIndex: number;
	candidate: unknown;
	segmentLookup: Map<string, SegmentLocation>;
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
		case "TRIM_CLIP":
			return validateTrimClipOp({ opIndex, candidate, segmentLookup });
		case "CUT_RANGE":
			return validateCutRangeOp({ opIndex, candidate });
		case "MOVE_SEGMENT":
			return validateMoveSegmentOp({ opIndex, candidate, segmentLookup });
		case "SWAP_SEGMENTS":
			return validateSwapSegmentsOp({ opIndex, candidate, segmentLookup });
		case "DELETE_SEGMENT":
			return validateDeleteSegmentOp({ opIndex, candidate, segmentLookup });
		case "DUPLICATE_SEGMENT":
			return validateDuplicateSegmentOp({ opIndex, candidate, segmentLookup });
		case "SET_ASPECT_RATIO":
			return validateSetAspectRatioOp({ opIndex, candidate });
		case "SET_CAPTION_STYLE":
			return validateSetCaptionStyleOp({ opIndex, candidate });
		case "FIX_CAPTION_TEXT":
			return validateFixCaptionTextOp({ opIndex, candidate, segmentLookup });
		case "MAKE_VERSION":
			return validateMakeVersionOp({ opIndex, candidate });
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
