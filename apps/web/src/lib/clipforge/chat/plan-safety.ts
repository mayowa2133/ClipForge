import { isKnownTimelineOpType } from "@/lib/clipforge/timeline-ops-schema";
import {
	collectTargetIntents,
	type TargetIntent,
} from "@/lib/clipforge/chat/ambiguity-guard";
import { buildClarificationRequest } from "@/lib/clipforge/chat/chat-clarification";
import {
	createEmptyResolutionState,
	findImplicitCandidates,
	updateResolutionStateFromSegment,
	type ChatResolutionState,
} from "@/lib/clipforge/chat/context-resolution";
import { splitCompoundRequest } from "@/lib/clipforge/chat/compound-request";
import {
	findCaptionReferenceCandidates,
	findSegmentReferenceCandidates,
} from "@/lib/clipforge/segment-resolution";
import type {
	AddTextOverlayOp,
	BrollFitMode,
	BrollLane,
	CaptionHighlightMode,
	CaptionPosition,
	ClipForgeAspectRatioPreset,
	FixCaptionTextOp,
	MakeVersionOp,
	OverlayTextPosition,
	TextOverlayStyleId,
	TimelineDiffOp,
} from "@/types/clipforge";
import type {
	ChatClarificationRequest,
	ChatPlanSafetyCode,
	ChatPlanSafetyNotice,
	ChatPlanSafetySummary,
	ChatPlannerContext,
	ChatPlannerOverrides,
	ProjectSegmentSummary,
	ProjectSummary,
} from "./types";

const VALID_ASPECT_PRESETS = new Set<ClipForgeAspectRatioPreset>(["9:16", "1:1", "16:9"]);
const VALID_CAPTION_POSITIONS = new Set<CaptionPosition>(["bottom", "center"]);
const VALID_HIGHLIGHT_MODES = new Set<CaptionHighlightMode>(["none", "line", "word"]);
const VALID_TEXT_POSITIONS = new Set<OverlayTextPosition>(["top", "center", "bottom"]);
const VALID_TEXT_STYLE_IDS = new Set<TextOverlayStyleId>([
	"clean-bottom",
	"bold-center",
	"overlay-top",
	"overlay-center",
]);
const VALID_BROLL_LANES = new Set<BrollLane>(["overlay-primary"]);
const VALID_BROLL_FIT_MODES = new Set<BrollFitMode>(["cover"]);

export interface SemanticPlanSafetyResult {
	ops: TimelineDiffOp[];
	clarification: ChatClarificationRequest | null;
	safety: ChatPlanSafetySummary;
	warnings: string[];
}

interface SemanticPlanSafetyState {
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	overrides?: ChatPlannerOverrides;
	timelineDurationMs: number;
	overlayMaxEndMs: number;
	segmentById: Map<string, ProjectSegmentSummary>;
	assetTypeById: Map<string, ProjectSummary["media_assets"][number]["type"]>;
	deletedSegmentIds: Set<string>;
	resolutionState: ChatResolutionState;
	intentsByOperation: Record<TargetIntent["operation"], TargetIntent[]>;
	intentCursors: Record<TargetIntent["operation"], number>;
	notices: ChatPlanSafetyNotice[];
	seenSignatures: Set<string>;
}

interface ResolutionResult {
	segment: ProjectSegmentSummary | null;
	clarification: ChatClarificationRequest | null;
}

interface RepairTargetResult {
	segmentId: string | null;
	segment: ProjectSegmentSummary | null;
	clarification: ChatClarificationRequest | null;
}

export function evaluateSemanticPlanSafety({
	userText,
	projectSummary,
	context,
	overrides,
	ops,
}: {
	userText: string;
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	overrides?: ChatPlannerOverrides;
	ops: TimelineDiffOp[];
}): SemanticPlanSafetyResult {
	const intentsByOperation = collectPromptIntentsByOperation({ userText });
	const timelineDurationMs = Math.max(0, Math.round(projectSummary.total_duration_s * 1000));
	const state: SemanticPlanSafetyState = {
		projectSummary,
		context,
		overrides,
		timelineDurationMs,
		overlayMaxEndMs: timelineDurationMs + 1000,
		segmentById: new Map(projectSummary.segments.map((segment) => [segment.segment_id, segment])),
		assetTypeById: new Map(
			projectSummary.media_assets.map((asset) => [asset.asset_id, asset.type]),
		),
		deletedSegmentIds: new Set<string>(),
		resolutionState: createEmptyResolutionState(),
		intentsByOperation,
		intentCursors: {
			trim: 0,
			move: 0,
			swap: 0,
			delete: 0,
			duplicate: 0,
			"fix-caption": 0,
		},
		notices: [],
		seenSignatures: new Set<string>(),
	};

	const keptOps: TimelineDiffOp[] = [];
	for (const [opIndex, candidate] of ops.entries()) {
		if (!isKnownTimelineOpType(candidate.type)) {
			recordNotice(state, {
				code: "dropped_unrecoverable",
				severity: "error",
				message: `Dropped unsupported op type at index ${opIndex}.`,
				opIndex,
				dropped: true,
			});
			continue;
		}

		const normalized = normalizeOp({
			state,
			op: candidate,
			opIndex,
		});
		if (normalized.clarification) {
			recordNotice(state, {
				code: "blocked_ambiguous_repair_target",
				severity: "error",
				message:
					"Ambiguous target detected while repairing planner output. Clarification is required before proposing ops.",
				opIndex,
			});
			return {
				ops: [],
				clarification: normalized.clarification,
				safety: buildSafetySummary({
					notices: state.notices,
					blocked: true,
				}),
				warnings: projectWarningsFromNotices(state.notices),
			};
		}
		if (!normalized.op) {
			continue;
		}

		const signature = JSON.stringify(normalized.op);
		if (state.seenSignatures.has(signature)) {
			recordNotice(state, {
				code: "dropped_cross_op_conflict",
				severity: "error",
				message: `Dropped duplicate op at index ${opIndex}.`,
				opIndex,
				dropped: true,
			});
			continue;
		}

		state.seenSignatures.add(signature);
		keptOps.push(normalized.op);

		if (normalized.op.type === "DELETE_SEGMENT") {
			state.deletedSegmentIds.add(normalized.op.segment_id);
		}
	}

	if (keptOps.length === 0 && state.notices.some((notice) => notice.dropped)) {
		recordNotice(state, {
			code: "blocked_no_safe_ops",
			severity: "error",
			message: "No safe deterministic ops remain after semantic safety checks.",
		});
	}

	const blocked = state.notices.some(
		(notice) =>
			notice.code === "blocked_no_safe_ops" ||
			notice.code === "blocked_ambiguous_repair_target",
	);

	return {
		ops: blocked ? [] : keptOps,
		clarification: null,
		safety: buildSafetySummary({
			notices: state.notices,
			blocked,
		}),
		warnings: projectWarningsFromNotices(state.notices),
	};
}

function normalizeOp({
	state,
	op,
	opIndex,
}: {
	state: SemanticPlanSafetyState;
	op: TimelineDiffOp;
	opIndex: number;
}): { op: TimelineDiffOp | null; clarification: ChatClarificationRequest | null } {
	switch (op.type) {
		case "TRIM_CLIP":
			return normalizeTrimClipOp({ state, op, opIndex });
		case "MOVE_SEGMENT":
			return normalizeMoveSegmentOp({ state, op, opIndex });
		case "SWAP_SEGMENTS":
			return normalizeSwapSegmentsOp({ state, op, opIndex });
		case "DELETE_SEGMENT":
			return normalizeDeleteSegmentOp({ state, op, opIndex });
		case "DUPLICATE_SEGMENT":
			return normalizeDuplicateSegmentOp({ state, op, opIndex });
		case "FIX_CAPTION_TEXT":
			return normalizeFixCaptionTextOp({ state, op, opIndex });
		case "ADD_TEXT_OVERLAY":
			return normalizeAddTextOverlayOp({ state, op, opIndex });
		case "CUT_RANGE":
			return normalizeCutRangeOp({ state, op, opIndex });
		case "INSERT_BROLL":
			return normalizeInsertBrollOp({ state, op, opIndex });
		case "MAKE_VERSION":
			return normalizeMakeVersionOp({ state, op, opIndex });
		case "SET_CAPTION_STYLE":
			return normalizeSetCaptionStyleOp({ state, op, opIndex });
		case "SET_ASPECT_RATIO":
			return normalizeSetAspectRatioOp({ state, op, opIndex });
		case "REMOVE_SILENCE":
			return normalizeRemoveSilenceOp({ state, op, opIndex });
		default:
			return { op, clarification: null };
	}
}

function normalizeTrimClipOp({
	state,
	op,
	opIndex,
}: {
	state: SemanticPlanSafetyState;
	op: TimelineDiffOp;
	opIndex: number;
}): { op: TimelineDiffOp | null; clarification: ChatClarificationRequest | null } {
	const target = repairTargetFromIntentIfNeeded({
		state,
		opIndex,
		operation: "trim",
		currentSegmentId: "clip_id" in op ? op.clip_id : "",
		allowedKinds: ["video"],
	});
	if (target.clarification) return { op: null, clarification: target.clarification };
	if (!target.segmentId || !target.segment) {
		return { op: null, clarification: null };
	}

	let inMs = Number.isFinite((op as any).in_ms) ? Math.max(0, (op as any).in_ms) : 0;
	let outMs = Number.isFinite((op as any).out_ms) ? Math.max(0, (op as any).out_ms) : 0;
	if ((op as any).in_ms !== inMs || (op as any).out_ms !== outMs) {
		recordNotice(state, {
			code: "repaired_time_clamped",
			severity: "warning",
			message: "TRIM_CLIP values were clamped to non-negative milliseconds.",
			opIndex,
			repaired: true,
		});
	}

	const sourceDuration = Math.max(0, target.segment.end_ms - target.segment.start_ms);
	if (sourceDuration <= 1) {
		recordNotice(state, {
			code: "dropped_invalid_range",
			severity: "error",
			message: "Dropped TRIM_CLIP because the target clip has no trimmable duration.",
			opIndex,
			dropped: true,
		});
		return { op: null, clarification: null };
	}

	const maxTrim = Math.max(0, sourceDuration - 1);
	if (inMs + outMs > maxTrim) {
		if (inMs >= maxTrim) {
			inMs = maxTrim;
			outMs = 0;
		} else {
			outMs = Math.max(0, maxTrim - inMs);
		}
		recordNotice(state, {
			code: "repaired_time_clamped",
			severity: "warning",
			message: "TRIM_CLIP was clamped to remain below source duration.",
			opIndex,
			repaired: true,
		});
	}

	if (inMs === 0 && outMs === 0) {
		recordNotice(state, {
			code: "dropped_noop",
			severity: "error",
			message: "Dropped TRIM_CLIP because it would not change the clip.",
			opIndex,
			dropped: true,
		});
		return { op: null, clarification: null };
	}

	state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, target.segment);
	return {
		op: {
			type: "TRIM_CLIP",
			clip_id: target.segmentId,
			in_ms: inMs,
			out_ms: outMs,
		},
		clarification: null,
	};
}

function normalizeMoveSegmentOp({
	state,
	op,
	opIndex,
}: {
	state: SemanticPlanSafetyState;
	op: TimelineDiffOp;
	opIndex: number;
}): { op: TimelineDiffOp | null; clarification: ChatClarificationRequest | null } {
	const target = repairTargetFromIntentIfNeeded({
		state,
		opIndex,
		operation: "move",
		currentSegmentId: "segment_id" in op ? op.segment_id : "",
		allowedKinds: ["video"],
	});
	if (target.clarification) return { op: null, clarification: target.clarification };
	if (!target.segmentId || !target.segment) {
		return { op: null, clarification: null };
	}

	let toMs = Number.isFinite((op as any).to_ms) ? Math.max(0, (op as any).to_ms) : 0;
	if ((op as any).to_ms !== toMs) {
		recordNotice(state, {
			code: "repaired_time_clamped",
			severity: "warning",
			message: "MOVE_SEGMENT to_ms was clamped to a non-negative value.",
			opIndex,
			repaired: true,
		});
	}
	if (state.timelineDurationMs > 0 && toMs > state.timelineDurationMs) {
		toMs = state.timelineDurationMs;
		recordNotice(state, {
			code: "repaired_time_clamped",
			severity: "warning",
			message: "MOVE_SEGMENT to_ms was clamped to timeline duration.",
			opIndex,
			repaired: true,
		});
	}
	if (toMs === target.segment.start_ms) {
		recordNotice(state, {
			code: "dropped_noop",
			severity: "error",
			message: "Dropped MOVE_SEGMENT because it would not move the target segment.",
			opIndex,
			dropped: true,
		});
		return { op: null, clarification: null };
	}

	state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, target.segment);
	return {
		op: {
			type: "MOVE_SEGMENT",
			segment_id: target.segmentId,
			to_ms: toMs,
		},
		clarification: null,
	};
}

function normalizeSwapSegmentsOp({
	state,
	op,
	opIndex,
}: {
	state: SemanticPlanSafetyState;
	op: TimelineDiffOp;
	opIndex: number;
}): { op: TimelineDiffOp | null; clarification: ChatClarificationRequest | null } {
	const leftIntent = takeNextIntent({ state, operation: "swap" });
	const rightIntent = takeNextIntent({ state, operation: "swap" });

	const left = repairTargetFromIntentIfNeeded({
		state,
		opIndex,
		operation: "swap",
		currentSegmentId: "a_id" in op ? op.a_id : "",
		allowedKinds: ["video"],
		explicitIntent: leftIntent,
	});
	if (left.clarification) return { op: null, clarification: left.clarification };
	const right = repairTargetFromIntentIfNeeded({
		state,
		opIndex,
		operation: "swap",
		currentSegmentId: "b_id" in op ? op.b_id : "",
		allowedKinds: ["video"],
		explicitIntent: rightIntent,
	});
	if (right.clarification) return { op: null, clarification: right.clarification };

	if (!left.segmentId || !right.segmentId || !left.segment || !right.segment) {
		recordNotice(state, {
			code: "dropped_target_not_found",
			severity: "error",
			message: "Dropped SWAP_SEGMENTS because one or both target segments could not be resolved.",
			opIndex,
			dropped: true,
		});
		return { op: null, clarification: null };
	}

	if (left.segmentId === right.segmentId) {
		recordNotice(state, {
			code: "dropped_cross_op_conflict",
			severity: "error",
			message: "Dropped SWAP_SEGMENTS because both targets resolved to the same segment.",
			opIndex,
			dropped: true,
		});
		return { op: null, clarification: null };
	}

	state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, right.segment);
	return {
		op: {
			type: "SWAP_SEGMENTS",
			a_id: left.segmentId,
			b_id: right.segmentId,
		},
		clarification: null,
	};
}

function normalizeDeleteSegmentOp({
	state,
	op,
	opIndex,
}: {
	state: SemanticPlanSafetyState;
	op: TimelineDiffOp;
	opIndex: number;
}): { op: TimelineDiffOp | null; clarification: ChatClarificationRequest | null } {
	const target = repairTargetFromIntentIfNeeded({
		state,
		opIndex,
		operation: "delete",
		currentSegmentId: "segment_id" in op ? op.segment_id : "",
		allowedKinds: ["video"],
	});
	if (target.clarification) return { op: null, clarification: target.clarification };
	if (!target.segmentId || !target.segment) {
		return { op: null, clarification: null };
	}

	state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, target.segment);
	return {
		op: {
			type: "DELETE_SEGMENT",
			segment_id: target.segmentId,
		},
		clarification: null,
	};
}

function normalizeDuplicateSegmentOp({
	state,
	op,
	opIndex,
}: {
	state: SemanticPlanSafetyState;
	op: TimelineDiffOp;
	opIndex: number;
}): { op: TimelineDiffOp | null; clarification: ChatClarificationRequest | null } {
	const target = repairTargetFromIntentIfNeeded({
		state,
		opIndex,
		operation: "duplicate",
		currentSegmentId: "segment_id" in op ? op.segment_id : "",
		allowedKinds: ["video"],
	});
	if (target.clarification) return { op: null, clarification: target.clarification };
	if (!target.segmentId || !target.segment) {
		return { op: null, clarification: null };
	}

	let toMs = Number.isFinite((op as any).to_ms) ? Math.max(0, (op as any).to_ms) : target.segment.end_ms;
	if ((op as any).to_ms !== toMs) {
		recordNotice(state, {
			code: "repaired_time_clamped",
			severity: "warning",
			message: "DUPLICATE_SEGMENT to_ms was repaired to a non-negative value.",
			opIndex,
			repaired: true,
		});
	}
	if (state.timelineDurationMs > 0 && toMs > state.timelineDurationMs) {
		toMs = state.timelineDurationMs;
		recordNotice(state, {
			code: "repaired_time_clamped",
			severity: "warning",
			message: "DUPLICATE_SEGMENT to_ms was clamped to timeline duration.",
			opIndex,
			repaired: true,
		});
	}

	state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, target.segment);
	return {
		op: {
			type: "DUPLICATE_SEGMENT",
			segment_id: target.segmentId,
			to_ms: toMs,
		},
		clarification: null,
	};
}

function normalizeFixCaptionTextOp({
	state,
	op,
	opIndex,
}: {
	state: SemanticPlanSafetyState;
	op: TimelineDiffOp;
	opIndex: number;
}): { op: TimelineDiffOp | null; clarification: ChatClarificationRequest | null } {
	const target = repairTargetFromIntentIfNeeded({
		state,
		opIndex,
		operation: "fix-caption",
		currentSegmentId: "segment_id" in op ? op.segment_id : "",
		allowedKinds: ["caption"],
	});
	if (target.clarification) return { op: null, clarification: target.clarification };
	if (!target.segmentId || !target.segment) {
		return { op: null, clarification: null };
	}

	let from = typeof (op as any).from === "string" ? (op as any).from : "";
	const to = typeof (op as any).to === "string" ? (op as any).to : "";
	if (from.trim().length === 0) {
		from = target.segment.text_content;
		recordNotice(state, {
			code: "repaired_value_clamped",
			severity: "warning",
			message: "FIX_CAPTION_TEXT missing `from` value was repaired from caption text content.",
			opIndex,
			repaired: true,
		});
	}
	if (to.trim().length === 0) {
		recordNotice(state, {
			code: "dropped_unrecoverable",
			severity: "error",
			message: "Dropped FIX_CAPTION_TEXT because `to` is empty.",
			opIndex,
			dropped: true,
		});
		return { op: null, clarification: null };
	}
	if (from === to) {
		recordNotice(state, {
			code: "dropped_noop",
			severity: "error",
			message: "Dropped FIX_CAPTION_TEXT because `from` and `to` are identical.",
			opIndex,
			dropped: true,
		});
		return { op: null, clarification: null };
	}

	state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, target.segment);
	return {
		op: {
			type: "FIX_CAPTION_TEXT",
			segment_id: target.segmentId,
			from,
			to,
		} satisfies FixCaptionTextOp,
		clarification: null,
	};
}

function normalizeAddTextOverlayOp({
	state,
	op,
	opIndex,
}: {
	state: SemanticPlanSafetyState;
	op: TimelineDiffOp;
	opIndex: number;
}): { op: TimelineDiffOp | null; clarification: ChatClarificationRequest | null } {
	let text = typeof (op as any).text === "string" ? (op as any).text.trim() : "";
	if (text.length === 0) {
		recordNotice(state, {
			code: "dropped_unrecoverable",
			severity: "error",
			message: "Dropped ADD_TEXT_OVERLAY because text is empty.",
			opIndex,
			dropped: true,
		});
		return { op: null, clarification: null };
	}
	if (text.length > 140) {
		text = text.slice(0, 140);
		recordNotice(state, {
			code: "repaired_overlay_text_truncated",
			severity: "warning",
			message: "ADD_TEXT_OVERLAY text was truncated to 140 characters.",
			opIndex,
			repaired: true,
		});
	}

	let startMs = Number.isFinite((op as any).start_ms) ? (op as any).start_ms : 0;
	let endMs = Number.isFinite((op as any).end_ms) ? (op as any).end_ms : startMs + 2500;
	const originalStart = startMs;
	const originalEnd = endMs;
	startMs = clamp(startMs, 0, state.overlayMaxEndMs);
	endMs = clamp(endMs, 0, state.overlayMaxEndMs);
	if (startMs !== originalStart || endMs !== originalEnd) {
		recordNotice(state, {
			code: "repaired_time_clamped",
			severity: "warning",
			message: "ADD_TEXT_OVERLAY range was clamped to timeline bounds.",
			opIndex,
			repaired: true,
		});
	}
	if (endMs <= startMs) {
		endMs = Math.min(state.overlayMaxEndMs, startMs + 2500);
		recordNotice(state, {
			code: "repaired_time_clamped",
			severity: "warning",
			message: "ADD_TEXT_OVERLAY end time was repaired to keep a positive duration.",
			opIndex,
			repaired: true,
		});
	}
	if (endMs <= startMs) {
		recordNotice(state, {
			code: "dropped_invalid_range",
			severity: "error",
			message: "Dropped ADD_TEXT_OVERLAY because its range is invalid after repair.",
			opIndex,
			dropped: true,
		});
		return { op: null, clarification: null };
	}

	let position = typeof (op as any).position === "string" ? (op as any).position : "top";
	if (!VALID_TEXT_POSITIONS.has(position as OverlayTextPosition)) {
		position = "top";
		recordNotice(state, {
			code: "repaired_overlay_style_defaulted",
			severity: "warning",
			message: "ADD_TEXT_OVERLAY position defaulted to `top`.",
			opIndex,
			repaired: true,
		});
	}

	let styleId = typeof (op as any).style_id === "string" ? (op as any).style_id : "overlay-top";
	if (!VALID_TEXT_STYLE_IDS.has(styleId as TextOverlayStyleId)) {
		styleId = "overlay-top";
		recordNotice(state, {
			code: "repaired_overlay_style_defaulted",
			severity: "warning",
			message: "ADD_TEXT_OVERLAY style_id defaulted to `overlay-top`.",
			opIndex,
			repaired: true,
		});
	}

	let font = typeof (op as any).font === "string" ? (op as any).font.trim() : "";
	if (font.length === 0) {
		font = "Arial";
		recordNotice(state, {
			code: "repaired_value_clamped",
			severity: "warning",
			message: "ADD_TEXT_OVERLAY font defaulted to `Arial`.",
			opIndex,
			repaired: true,
		});
	}

	let size = Number.isFinite((op as any).size) ? Number((op as any).size) : 64;
	const normalizedSize = clamp(size, 24, 160);
	if (normalizedSize !== size) {
		size = normalizedSize;
		recordNotice(state, {
			code: "repaired_value_clamped",
			severity: "warning",
			message: "ADD_TEXT_OVERLAY size was clamped to the allowed range.",
			opIndex,
			repaired: true,
		});
	} else {
		size = normalizedSize;
	}

	let color = typeof (op as any).color === "string" ? (op as any).color : "#FFFFFF";
	if (!isHexColor(color)) {
		color = "#FFFFFF";
		recordNotice(state, {
			code: "repaired_overlay_style_defaulted",
			severity: "warning",
			message: "ADD_TEXT_OVERLAY color defaulted to `#FFFFFF`.",
			opIndex,
			repaired: true,
		});
	}

	return {
		op: {
			type: "ADD_TEXT_OVERLAY",
			text,
			start_ms: startMs,
			end_ms: endMs,
			position: position as OverlayTextPosition,
			style_id: styleId as TextOverlayStyleId,
			font,
			size,
			color,
			outline: typeof (op as any).outline === "boolean" ? (op as any).outline : true,
			background:
				typeof (op as any).background === "boolean" ? (op as any).background : false,
		} satisfies AddTextOverlayOp,
		clarification: null,
	};
}

function normalizeCutRangeOp({
	state,
	op,
	opIndex,
}: {
	state: SemanticPlanSafetyState;
	op: TimelineDiffOp;
	opIndex: number;
}): { op: TimelineDiffOp | null; clarification: ChatClarificationRequest | null } {
	let startMs = Number.isFinite((op as any).start_ms) ? (op as any).start_ms : 0;
	let endMs = Number.isFinite((op as any).end_ms) ? (op as any).end_ms : 0;
	const originalStart = startMs;
	const originalEnd = endMs;
	startMs = clamp(startMs, 0, state.timelineDurationMs);
	endMs = clamp(endMs, 0, state.timelineDurationMs);
	if (startMs !== originalStart || endMs !== originalEnd) {
		recordNotice(state, {
			code: "repaired_time_clamped",
			severity: "warning",
			message: "CUT_RANGE was clamped to timeline bounds.",
			opIndex,
			repaired: true,
		});
	}

	if (endMs <= startMs) {
		recordNotice(state, {
			code: "dropped_invalid_range",
			severity: "error",
			message: "Dropped CUT_RANGE because end_ms must be greater than start_ms.",
			opIndex,
			dropped: true,
		});
		return { op: null, clarification: null };
	}

	return {
		op: {
			type: "CUT_RANGE",
			start_ms: startMs,
			end_ms: endMs,
		},
		clarification: null,
	};
}

function normalizeInsertBrollOp({
	state,
	op,
	opIndex,
}: {
	state: SemanticPlanSafetyState;
	op: TimelineDiffOp;
	opIndex: number;
}): { op: TimelineDiffOp | null; clarification: ChatClarificationRequest | null } {
	const mediaId = typeof (op as any).media_id === "string" ? (op as any).media_id : "";
	const mediaType = state.assetTypeById.get(mediaId);
	if (!mediaId || !mediaType || (mediaType !== "video" && mediaType !== "image")) {
		recordNotice(state, {
			code: "dropped_invalid_media_asset",
			severity: "error",
			message: "Dropped INSERT_BROLL because media_id is missing or not a visual asset.",
			opIndex,
			dropped: true,
		});
		return { op: null, clarification: null };
	}

	let startMs = Number.isFinite((op as any).start_ms) ? (op as any).start_ms : 0;
	let endMs = Number.isFinite((op as any).end_ms) ? (op as any).end_ms : 0;
	const originalStart = startMs;
	const originalEnd = endMs;
	startMs = clamp(startMs, 0, state.timelineDurationMs);
	endMs = clamp(endMs, 0, state.timelineDurationMs);
	if (startMs !== originalStart || endMs !== originalEnd) {
		recordNotice(state, {
			code: "repaired_time_clamped",
			severity: "warning",
			message: "INSERT_BROLL range was clamped to timeline bounds.",
			opIndex,
			repaired: true,
		});
	}
	if (endMs <= startMs) {
		recordNotice(state, {
			code: "dropped_invalid_range",
			severity: "error",
			message: "Dropped INSERT_BROLL because end_ms must be greater than start_ms.",
			opIndex,
			dropped: true,
		});
		return { op: null, clarification: null };
	}

	let lane = typeof (op as any).lane === "string" ? (op as any).lane : "overlay-primary";
	if (!VALID_BROLL_LANES.has(lane as BrollLane)) {
		lane = "overlay-primary";
		recordNotice(state, {
			code: "repaired_value_clamped",
			severity: "warning",
			message: "INSERT_BROLL lane defaulted to overlay-primary.",
			opIndex,
			repaired: true,
		});
	}
	let fitMode = typeof (op as any).fit_mode === "string" ? (op as any).fit_mode : "cover";
	if (!VALID_BROLL_FIT_MODES.has(fitMode as BrollFitMode)) {
		fitMode = "cover";
		recordNotice(state, {
			code: "repaired_value_clamped",
			severity: "warning",
			message: "INSERT_BROLL fit_mode defaulted to cover.",
			opIndex,
			repaired: true,
		});
	}
	const mute = typeof (op as any).mute === "boolean" ? (op as any).mute : true;
	if (typeof (op as any).mute !== "boolean") {
		recordNotice(state, {
			code: "repaired_value_clamped",
			severity: "warning",
			message: "INSERT_BROLL mute defaulted to true.",
			opIndex,
			repaired: true,
		});
	}

	return {
		op: {
			type: "INSERT_BROLL",
			media_id: mediaId,
			start_ms: startMs,
			end_ms: endMs,
			lane: lane as BrollLane,
			fit_mode: fitMode as BrollFitMode,
			mute,
		},
		clarification: null,
	};
}

function normalizeMakeVersionOp({
	state,
	op,
	opIndex,
}: {
	state: SemanticPlanSafetyState;
	op: TimelineDiffOp;
	opIndex: number;
}): { op: TimelineDiffOp | null; clarification: ChatClarificationRequest | null } {
	if (!Number.isFinite((op as any).duration_target_s) || !Number.isFinite((op as any).aggressiveness)) {
		recordNotice(state, {
			code: "dropped_unrecoverable",
			severity: "error",
			message: "Dropped MAKE_VERSION because numeric fields are missing.",
			opIndex,
			dropped: true,
		});
		return { op: null, clarification: null };
	}

	const maxDuration = Math.max(1, state.projectSummary.total_duration_s || 1);
	const durationTarget = clamp(Number((op as any).duration_target_s), 1, maxDuration);
	const aggressiveness = clamp(Number((op as any).aggressiveness), 0, 1);
	if (
		durationTarget !== (op as any).duration_target_s ||
		aggressiveness !== (op as any).aggressiveness
	) {
		recordNotice(state, {
			code: "repaired_value_clamped",
			severity: "warning",
			message: "MAKE_VERSION values were clamped to valid ranges.",
			opIndex,
			repaired: true,
		});
	}

	return {
		op: {
			type: "MAKE_VERSION",
			duration_target_s: durationTarget,
			aggressiveness,
		} satisfies MakeVersionOp,
		clarification: null,
	};
}

function normalizeSetCaptionStyleOp({
	state,
	op,
	opIndex,
}: {
	state: SemanticPlanSafetyState;
	op: TimelineDiffOp;
	opIndex: number;
}): { op: TimelineDiffOp | null; clarification: ChatClarificationRequest | null } {
	const styleId =
		typeof (op as any).style_id === "string" && (op as any).style_id.trim().length > 0
			? (op as any).style_id
			: "clean-bottom";
	const font =
		typeof (op as any).font === "string" && (op as any).font.trim().length > 0
			? (op as any).font
			: "Arial";
	const size = Number.isFinite((op as any).size) ? Math.max(1, Number((op as any).size)) : 56;
	const position =
		typeof (op as any).position === "string" &&
		VALID_CAPTION_POSITIONS.has((op as any).position as CaptionPosition)
			? ((op as any).position as CaptionPosition)
			: "bottom";
	const highlightMode =
		typeof (op as any).highlight_mode === "string" &&
		VALID_HIGHLIGHT_MODES.has((op as any).highlight_mode as CaptionHighlightMode)
			? ((op as any).highlight_mode as CaptionHighlightMode)
			: "none";
	const outline = typeof (op as any).outline === "boolean" ? (op as any).outline : false;

	if (
		styleId !== (op as any).style_id ||
		font !== (op as any).font ||
		size !== (op as any).size ||
		position !== (op as any).position ||
		highlightMode !== (op as any).highlight_mode ||
		outline !== (op as any).outline
	) {
		recordNotice(state, {
			code: "repaired_value_clamped",
			severity: "warning",
			message: "SET_CAPTION_STYLE fields were repaired to supported values.",
			opIndex,
			repaired: true,
		});
	}

	return {
		op: {
			type: "SET_CAPTION_STYLE",
			style_id: styleId,
			font,
			size,
			position,
			outline,
			highlight_mode: highlightMode,
		},
		clarification: null,
	};
}

function normalizeSetAspectRatioOp({
	state,
	op,
	opIndex,
}: {
	state: SemanticPlanSafetyState;
	op: TimelineDiffOp;
	opIndex: number;
}): { op: TimelineDiffOp | null; clarification: ChatClarificationRequest | null } {
	const preset =
		typeof (op as any).preset === "string" &&
		VALID_ASPECT_PRESETS.has((op as any).preset as ClipForgeAspectRatioPreset)
			? ((op as any).preset as ClipForgeAspectRatioPreset)
			: "9:16";
	if (preset !== (op as any).preset) {
		recordNotice(state, {
			code: "repaired_value_clamped",
			severity: "warning",
			message: "SET_ASPECT_RATIO preset defaulted to 9:16.",
			opIndex,
			repaired: true,
		});
	}

	return {
		op: {
			type: "SET_ASPECT_RATIO",
			preset,
		},
		clarification: null,
	};
}

function normalizeRemoveSilenceOp({
	state,
	op,
	opIndex,
}: {
	state: SemanticPlanSafetyState;
	op: TimelineDiffOp;
	opIndex: number;
}): { op: TimelineDiffOp | null; clarification: ChatClarificationRequest | null } {
	const threshold = Number.isFinite((op as any).threshold_ms)
		? Math.max(0.01, Number((op as any).threshold_ms))
		: 0.32;
	const pad = Number.isFinite((op as any).pad_ms) ? Math.max(0, Number((op as any).pad_ms)) : 0.09;
	const minKeep = Number.isFinite((op as any).min_keep_ms)
		? Math.max(0.01, Number((op as any).min_keep_ms))
		: 0.45;
	if (
		threshold !== (op as any).threshold_ms ||
		pad !== (op as any).pad_ms ||
		minKeep !== (op as any).min_keep_ms
	) {
		recordNotice(state, {
			code: "repaired_value_clamped",
			severity: "warning",
			message: "REMOVE_SILENCE values were repaired to valid ranges.",
			opIndex,
			repaired: true,
		});
	}

	return {
		op: {
			type: "REMOVE_SILENCE",
			threshold_ms: threshold,
			pad_ms: pad,
			min_keep_ms: minKeep,
		},
		clarification: null,
	};
}

function repairTargetFromIntentIfNeeded({
	state,
	opIndex,
	operation,
	currentSegmentId,
	allowedKinds,
	explicitIntent,
}: {
	state: SemanticPlanSafetyState;
	opIndex: number;
	operation: TargetIntent["operation"];
	currentSegmentId: string;
	allowedKinds: ProjectSegmentSummary["segment_kind"][];
	explicitIntent?: TargetIntent;
}): RepairTargetResult {
	if (currentSegmentId && state.deletedSegmentIds.has(currentSegmentId)) {
		recordNotice(state, {
			code: "dropped_target_deleted_by_prior_op",
			severity: "error",
			message: `Dropped op at index ${opIndex} because its target was deleted earlier in this plan.`,
			opIndex,
			dropped: true,
		});
		return { segmentId: null, segment: null, clarification: null };
	}

	const existingSegment = currentSegmentId
		? state.segmentById.get(currentSegmentId) ?? null
		: null;
	const hasCompatibleExisting =
		!!existingSegment && allowedKinds.includes(existingSegment.segment_kind);
	if (hasCompatibleExisting && existingSegment) {
		state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, existingSegment);
		return {
			segmentId: existingSegment.segment_id,
			segment: existingSegment,
			clarification: null,
		};
	}

	const intent = explicitIntent ?? takeNextIntent({ state, operation });
	if (!intent) {
		recordNotice(state, {
			code: existingSegment ? "dropped_target_kind_mismatch" : "dropped_target_not_found",
			severity: "error",
			message: existingSegment
				? `Dropped op at index ${opIndex} because target kind is incompatible.`
				: `Dropped op at index ${opIndex} because target segment_id could not be resolved.`,
			opIndex,
			dropped: true,
		});
		return { segmentId: null, segment: null, clarification: null };
	}

	const resolved = resolveIntentTarget({
		state,
		intent,
		allowedKinds,
	});
	if (resolved.clarification) {
		return { segmentId: null, segment: null, clarification: resolved.clarification };
	}
	if (!resolved.segment) {
		recordNotice(state, {
			code: "dropped_target_not_found",
			severity: "error",
			message: `Dropped op at index ${opIndex} because target could not be recovered from prompt intent.`,
			opIndex,
			dropped: true,
		});
		return { segmentId: null, segment: null, clarification: null };
	}

	recordNotice(state, {
		code: "repaired_target_id_from_intent",
		severity: "warning",
		message: `Target segment was repaired from deterministic prompt intent at op index ${opIndex}.`,
		opIndex,
		repaired: true,
	});
	state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, resolved.segment);
	return {
		segmentId: resolved.segment.segment_id,
		segment: resolved.segment,
		clarification: null,
	};
}

function resolveIntentTarget({
	state,
	intent,
	allowedKinds,
}: {
	state: SemanticPlanSafetyState;
	intent: TargetIntent;
	allowedKinds: ProjectSegmentSummary["segment_kind"][];
}): ResolutionResult {
	const forcedSegmentId =
		state.overrides?.forced_segment_ids_by_reference?.[intent.referenceLabel] ?? null;
	if (forcedSegmentId) {
		const forced = state.segmentById.get(forcedSegmentId) ?? null;
		if (forced && allowedKinds.includes(forced.segment_kind)) {
			return { segment: forced, clarification: null };
		}
	}

	let candidates: ProjectSegmentSummary[] = [];
	if (!intent.reference.mode || intent.reference.mode === "explicit") {
		candidates =
			intent.reference.target === "caption"
				? findCaptionReferenceCandidates({
						projectSummary: state.projectSummary,
						reference: intent.reference,
						fromText: intent.fromText,
					})
				: findSegmentReferenceCandidates({
						projectSummary: state.projectSummary,
						reference: intent.reference,
					});
	} else {
		candidates = findImplicitCandidates({
			projectSummary: state.projectSummary,
			context: state.context,
			state: state.resolutionState,
			allowedKinds: allowedKinds as any,
			token: intent.reference.mode,
		});
	}

	candidates = candidates.filter(
		(segment) =>
			allowedKinds.includes(segment.segment_kind) &&
			!state.deletedSegmentIds.has(segment.segment_id),
	);
	if (candidates.length === 0) {
		return { segment: null, clarification: null };
	}
	if (candidates.length === 1) {
		return { segment: candidates[0] ?? null, clarification: null };
	}

	return {
		segment: null,
		clarification: buildClarificationRequest({
			referenceLabel: intent.referenceLabel,
			candidates,
		}),
	};
}

export function collectPromptIntentsByOperation({
	userText,
}: {
	userText: string;
}): Record<TargetIntent["operation"], TargetIntent[]> {
	const byOp: Record<TargetIntent["operation"], TargetIntent[]> = {
		trim: [],
		move: [],
		swap: [],
		delete: [],
		duplicate: [],
		"fix-caption": [],
	};
	const clauses = splitCompoundRequest(userText);
	const resolvedClauses = clauses.length > 0 ? clauses : [userText.trim()];
	for (const [clauseIndex, clause] of resolvedClauses.entries()) {
		for (const intent of collectTargetIntents({ clause, clauseIndex })) {
			byOp[intent.operation].push(intent);
		}
	}
	return byOp;
}

function takeNextIntent({
	state,
	operation,
}: {
	state: SemanticPlanSafetyState;
	operation: TargetIntent["operation"];
}): TargetIntent | undefined {
	const cursor = state.intentCursors[operation];
	const intent = state.intentsByOperation[operation][cursor];
	if (intent) {
		state.intentCursors[operation] = cursor + 1;
	}
	return intent;
}

function buildSafetySummary({
	notices,
	blocked,
}: {
	notices: ChatPlanSafetyNotice[];
	blocked: boolean;
}): ChatPlanSafetySummary {
	return {
		repairedCount: notices.filter((notice) => notice.repaired).length,
		droppedCount: notices.filter((notice) => notice.dropped).length,
		blocked,
		notices,
	};
}

export function projectWarningsFromNotices(notices: ChatPlanSafetyNotice[]): string[] {
	return notices.map((notice) => `[${notice.code}] ${notice.message}`);
}

function recordNotice(
	state: SemanticPlanSafetyState,
	notice: {
		code: ChatPlanSafetyCode;
		severity: "warning" | "error";
		message: string;
		opIndex?: number;
		repaired?: boolean;
		dropped?: boolean;
	},
) {
	state.notices.push({
		source: "semantic",
		...notice,
	});
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.max(min, Math.min(max, value));
}

function isHexColor(value: string): boolean {
	return /^#[0-9a-f]{6}$/i.test(value);
}
