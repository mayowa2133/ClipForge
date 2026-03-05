import {
	ALLOWED_BROLL_FIT_MODES,
	ALLOWED_BROLL_LANES,
	ALLOWED_CAPTION_POSITIONS,
	ALLOWED_HIGHLIGHT_MODES,
	ALLOWED_OVERLAY_TEXT_POSITIONS,
	ALLOWED_TEXT_OVERLAY_STYLE_IDS,
} from "@/lib/clipforge/timeline-ops-schema";
import {
	createEmptyResolutionState,
	findImplicitCandidates,
	updateResolutionStateFromSegment,
	type ChatResolutionState,
} from "@/lib/clipforge/chat/context-resolution";
import { splitCompoundRequest } from "@/lib/clipforge/chat/compound-request";
import { parsePhraseBrollRequest } from "@/lib/clipforge/chat/prompt-parsers";
import { resolveMediaAssetByName } from "@/lib/clipforge/media-resolver";
import {
	findCaptionReferenceCandidates,
	findSegmentReferenceCandidates,
} from "@/lib/clipforge/segment-resolution";
import { buildClarificationRequest } from "./chat-clarification";
import { collectPromptIntentsByOperation } from "./plan-safety";
import type {
	ChatClarificationRequest,
	ChatPlanSafetyNotice,
	ChatPlanSafetySummary,
	ChatPlannerContext,
	ChatPlannerOverrides,
	ChatValidatorReconciliationResult,
	ProjectSegmentSummary,
	ProjectSummary,
} from "./types";
import type { TargetIntent } from "./ambiguity-guard";
import type { TimelineOpsValidationError, TimelineOpsValidationResult } from "@/lib/clipforge/ops-validator";
import type {
	AddTextOverlayOp,
	FixCaptionTextOp,
	InsertBrollOp,
	SetCaptionStyleOp,
	TimelineDiffOp,
} from "@/types/clipforge";

interface ReconciliationState {
	userText: string;
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	overrides?: ChatPlannerOverrides;
	timelineDurationMs: number;
	overlayMaxEndMs: number;
	segmentById: Map<string, ProjectSegmentSummary>;
	assetTypeById: Map<string, ProjectSummary["media_assets"][number]["type"]>;
	intentsByOperation: Record<TargetIntent["operation"], TargetIntent[]>;
	intentCursors: Record<TargetIntent["operation"], number>;
	resolutionState: ChatResolutionState;
	notices: ChatPlanSafetyNotice[];
}

type ReconcileValidationFn = ({ ops }: { ops: unknown[] }) => TimelineOpsValidationResult;

interface ReconcileOutcome {
	op: TimelineDiffOp | null;
	clarification: ChatClarificationRequest | null;
	repairedMessage?: string;
	droppedMessage?: string;
}

interface ResolveTargetResult {
	segment: ProjectSegmentSummary | null;
	clarification: ChatClarificationRequest | null;
}

export function reconcileValidatorErrors({
	userText,
	projectSummary,
	context,
	overrides,
	ops,
	validateOps,
}: {
	userText: string;
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	overrides?: ChatPlannerOverrides;
	ops: TimelineDiffOp[];
	validateOps: ReconcileValidationFn;
}): ChatValidatorReconciliationResult {
	const firstPass = validateOps({ ops });
	if (firstPass.valid) {
		return {
			ops: firstPass.ops,
			clarification: null,
			safety: buildSafetySummary({ notices: [], blocked: false }),
			firstPassErrors: [],
			secondPassErrors: [],
			blocked: false,
		};
	}

	const state = createReconciliationState({
		userText,
		projectSummary,
		context,
		overrides,
	});

	const workingOps: Array<TimelineDiffOp | null> = ops.map((op) => ({ ...op }));
	const orderedErrors = [...firstPass.errors].sort((a, b) => {
		if (a.opIndex !== b.opIndex) {
			return a.opIndex - b.opIndex;
		}
		return 0;
	});

	for (const error of orderedErrors) {
		if (error.code === "ops_not_array") {
			recordBlockedNotice({
				state,
				code: "blocked_validator_reconcile_failed",
				message: "Validator rejected the proposal payload shape.",
				error,
			});
			return {
				ops: [],
				clarification: null,
				safety: buildSafetySummary({ notices: state.notices, blocked: true }),
				firstPassErrors: firstPass.errors,
				secondPassErrors: [],
				blocked: true,
			};
		}

		if (error.opIndex < 0 || error.opIndex >= workingOps.length) {
			continue;
		}

		const current = workingOps[error.opIndex];
		if (!current) {
			continue;
		}

		const outcome = reconcileSingleError({
			state,
			error,
			op: current,
			opIndex: error.opIndex,
		});
		if (outcome.clarification) {
			recordBlockedNotice({
				state,
				code: "blocked_validator_reconcile_ambiguous",
				message:
					"Validator reconciliation requires clarification before proposing ops.",
				error,
				opIndex: error.opIndex,
			});
			return {
				ops: [],
				clarification: outcome.clarification,
				safety: buildSafetySummary({ notices: state.notices, blocked: true }),
				firstPassErrors: firstPass.errors,
				secondPassErrors: [],
				blocked: true,
			};
		}

		if (!outcome.op) {
			workingOps[error.opIndex] = null;
			recordDropNotice({
				state,
				error,
				opIndex: error.opIndex,
				message:
					outcome.droppedMessage ??
					`Dropped op at index ${error.opIndex} after validator error ${error.code}.`,
			});
			continue;
		}

		workingOps[error.opIndex] = outcome.op;
		if (outcome.repairedMessage) {
			recordRepairNotice({
				state,
				error,
				opIndex: error.opIndex,
				message: outcome.repairedMessage,
			});
		}
	}

	const reconciledOps = workingOps.filter((op): op is TimelineDiffOp => Boolean(op));
	const secondPass = validateOps({ ops: reconciledOps });

	if (!secondPass.valid || secondPass.ops.length === 0) {
		recordBlockedNotice({
			state,
			code: "blocked_validator_reconcile_failed",
			message:
				secondPass.errors.length > 0
					? "Validator reconciliation could not produce a validator-clean proposal."
					: "Validator reconciliation removed all unsafe ops.",
			error: secondPass.errors[0] ?? null,
		});
		return {
			ops: [],
			clarification: null,
			safety: buildSafetySummary({ notices: state.notices, blocked: true }),
			firstPassErrors: firstPass.errors,
			secondPassErrors: secondPass.errors,
			blocked: true,
		};
	}

	return {
		ops: secondPass.ops,
		clarification: null,
		safety: buildSafetySummary({ notices: state.notices, blocked: false }),
		firstPassErrors: firstPass.errors,
		secondPassErrors: [],
		blocked: false,
	};
}

export function projectValidatorWarnings({
	notices,
}: {
	notices: ChatPlanSafetyNotice[];
}): string[] {
	return notices.map((notice) => {
		const validatorSuffix = notice.validatorCode
			? ` [validator:${notice.validatorCode}]`
			: "";
		return `[${notice.code}] ${notice.message}${validatorSuffix}`;
	});
}

function createReconciliationState({
	userText,
	projectSummary,
	context,
	overrides,
}: {
	userText: string;
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	overrides?: ChatPlannerOverrides;
}): ReconciliationState {
	const timelineDurationMs = Math.max(0, Math.round(projectSummary.total_duration_s * 1000));
	return {
		userText,
		projectSummary,
		context,
		overrides,
		timelineDurationMs,
		overlayMaxEndMs: timelineDurationMs + 1000,
		segmentById: new Map(projectSummary.segments.map((segment) => [segment.segment_id, segment])),
		assetTypeById: new Map(
			projectSummary.media_assets.map((asset) => [asset.asset_id, asset.type]),
		),
		intentsByOperation: collectPromptIntentsByOperation({ userText }),
		intentCursors: {
			trim: 0,
			move: 0,
			swap: 0,
			delete: 0,
			duplicate: 0,
			"fix-caption": 0,
		},
		resolutionState: createEmptyResolutionState(),
		notices: [],
	};
}

function reconcileSingleError({
	state,
	error,
	op,
	opIndex,
}: {
	state: ReconciliationState;
	error: TimelineOpsValidationError;
	op: TimelineDiffOp;
	opIndex: number;
}): ReconcileOutcome {
	switch (error.code) {
		case "clip_not_found":
		case "segment_not_found":
		case "caption_segment_not_text":
			return reconcileTargetingError({ state, error, op, opIndex });
		case "trim_exceeds_source":
			return reconcileTrimExceedsSource({ state, op, opIndex });
		case "invalid_trim_clip":
			return reconcileTrimClip({ state, op, opIndex });
		case "invalid_move_segment":
			return reconcileMoveSegment({ state, op, opIndex });
		case "invalid_duplicate_segment":
			return reconcileDuplicateSegment({ state, op, opIndex });
		case "invalid_delete_segment":
			return reconcileDeleteSegment({ state, op, opIndex });
		case "invalid_cut_range":
			return reconcileCutRange({ state, op });
		case "add_text_overlay_invalid_range":
		case "invalid_add_text_overlay":
		case "add_text_overlay_invalid_style":
		case "add_text_overlay_invalid_color":
			return reconcileAddTextOverlay({ state, op });
		case "invalid_make_version":
			return reconcileMakeVersion({ state, op });
		case "invalid_caption_style":
		case "invalid_caption_position":
		case "invalid_highlight_mode":
			return reconcileCaptionStyle({ op });
		case "invalid_remove_silence":
			return reconcileRemoveSilence({ op });
		case "insert_broll_invalid_range":
		case "insert_broll_invalid_lane":
		case "insert_broll_invalid_fit_mode":
		case "insert_broll_invalid_mute":
		case "insert_broll_missing_asset":
		case "insert_broll_asset_not_visual":
			return reconcileInsertBroll({ state, op });
		case "invalid_swap_segments":
			return reconcileSwapSegments({ state, op, opIndex });
		case "swap_track_type_mismatch":
			return {
				op: null,
				clarification: null,
				droppedMessage: "Dropped SWAP_SEGMENTS because cross-track swaps are not reconciled.",
			};
		case "invalid_fix_caption_text":
			return reconcileFixCaptionText({ state, op, opIndex });
		case "invalid_aspect_ratio":
			if (op.type !== "SET_ASPECT_RATIO") {
				return {
					op: null,
					clarification: null,
					droppedMessage: "Dropped invalid SET_ASPECT_RATIO payload.",
				};
			}
			return {
				op: {
					type: "SET_ASPECT_RATIO",
					preset: op.preset === "9:16" || op.preset === "1:1" || op.preset === "16:9"
						? op.preset
						: "9:16",
				},
				clarification: null,
				repairedMessage: "SET_ASPECT_RATIO preset defaulted to 9:16.",
			};
		case "unsupported_op":
		case "op_not_object":
			return {
				op: null,
				clarification: null,
				droppedMessage: "Dropped unsupported op payload after validator rejection.",
			};
		default:
			return {
				op: null,
				clarification: null,
				droppedMessage: `Dropped op after unreconciled validator error ${error.code}.`,
			};
	}
}

function reconcileTargetingError({
	state,
	error,
	op,
	opIndex,
}: {
	state: ReconciliationState;
	error: TimelineOpsValidationError;
	op: TimelineDiffOp;
	opIndex: number;
}): ReconcileOutcome {
	switch (op.type) {
		case "TRIM_CLIP": {
			const target = resolveTargetForOperation({
				state,
				operation: "trim",
				allowedKinds: ["video"],
			});
			if (target.clarification) return { op: null, clarification: target.clarification };
			if (!target.segment) {
				return {
					op: null,
					clarification: null,
					droppedMessage: `Dropped TRIM_CLIP because ${error.code} could not be resolved.`,
				};
			}
			state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, target.segment);
			return {
				op: {
					...op,
					clip_id: target.segment.segment_id,
				},
				clarification: null,
				repairedMessage: `Recovered TRIM_CLIP clip_id using deterministic intent (${target.segment.segment_id}).`,
			};
		}
		case "MOVE_SEGMENT":
		case "DELETE_SEGMENT":
		case "DUPLICATE_SEGMENT": {
			const operation =
				op.type === "MOVE_SEGMENT"
					? "move"
					: op.type === "DELETE_SEGMENT"
						? "delete"
						: "duplicate";
			const target = resolveTargetForOperation({
				state,
				operation,
				allowedKinds: ["video"],
			});
			if (target.clarification) return { op: null, clarification: target.clarification };
			if (!target.segment) {
				return {
					op: null,
					clarification: null,
					droppedMessage: `Dropped ${op.type} because ${error.code} could not be resolved.`,
				};
			}
			state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, target.segment);
			return {
				op: {
					...op,
					segment_id: target.segment.segment_id,
				},
				clarification: null,
				repairedMessage: `Recovered ${op.type} target segment from deterministic intent (${target.segment.segment_id}).`,
			};
		}
		case "FIX_CAPTION_TEXT": {
			const target = resolveTargetForOperation({
				state,
				operation: "fix-caption",
				allowedKinds: ["caption"],
			});
			if (target.clarification) return { op: null, clarification: target.clarification };
			if (!target.segment) {
				return {
					op: null,
					clarification: null,
					droppedMessage:
						"Dropped FIX_CAPTION_TEXT because a deterministic caption target could not be recovered.",
				};
			}
			state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, target.segment);
			return {
				op: {
					...op,
					segment_id: target.segment.segment_id,
				},
				clarification: null,
				repairedMessage: `Recovered FIX_CAPTION_TEXT caption target (${target.segment.segment_id}).`,
			};
		}
		case "SWAP_SEGMENTS":
			return reconcileSwapSegments({ state, op, opIndex });
		default:
			return {
				op: null,
				clarification: null,
				droppedMessage: `Dropped ${op.type} because ${error.code} was unrecoverable.`,
			};
	}
}

function reconcileTrimClip({
	state,
	op,
	opIndex,
}: {
	state: ReconciliationState;
	op: TimelineDiffOp;
	opIndex: number;
}): ReconcileOutcome {
	if (op.type !== "TRIM_CLIP") {
		return { op: null, clarification: null };
	}

	let clipId = typeof op.clip_id === "string" ? op.clip_id : "";
	let inMs = Number.isFinite(op.in_ms) ? Math.max(0, op.in_ms) : 0;
	let outMs = Number.isFinite(op.out_ms) ? Math.max(0, op.out_ms) : 0;

	if (!clipId || !state.segmentById.has(clipId)) {
		const target = resolveTargetForOperation({
			state,
			operation: "trim",
			allowedKinds: ["video"],
		});
		if (target.clarification) return { op: null, clarification: target.clarification };
		if (!target.segment) {
			return {
				op: null,
				clarification: null,
				droppedMessage: "Dropped TRIM_CLIP because target could not be recovered.",
			};
		}
		clipId = target.segment.segment_id;
		state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, target.segment);
	}

	const targetSegment = state.segmentById.get(clipId) ?? null;
	if (!targetSegment || targetSegment.segment_kind !== "video") {
		return {
			op: null,
			clarification: null,
			droppedMessage: "Dropped TRIM_CLIP because target segment is invalid.",
		};
	}

	const sourceDuration = Math.max(0, targetSegment.end_ms - targetSegment.start_ms);
	if (sourceDuration <= 1) {
		return {
			op: null,
			clarification: null,
			droppedMessage: "Dropped TRIM_CLIP because source duration is too short.",
		};
	}
	const maxTrim = Math.max(0, sourceDuration - 1);
	if (inMs + outMs >= sourceDuration) {
		if (inMs >= maxTrim) {
			inMs = maxTrim;
			outMs = 0;
		} else {
			outMs = Math.max(0, maxTrim - inMs);
		}
	}
	if (inMs === 0 && outMs === 0) {
		return {
			op: null,
			clarification: null,
			droppedMessage: "Dropped TRIM_CLIP because reconciliation produced a no-op trim.",
		};
	}

	return {
		op: {
			type: "TRIM_CLIP",
			clip_id: clipId,
			in_ms: inMs,
			out_ms: outMs,
		},
		clarification: null,
		repairedMessage: `Reconciled TRIM_CLIP at index ${opIndex}.`,
	};
}

function reconcileTrimExceedsSource({
	state,
	op,
	opIndex,
}: {
	state: ReconciliationState;
	op: TimelineDiffOp;
	opIndex: number;
}): ReconcileOutcome {
	if (op.type !== "TRIM_CLIP") {
		return { op: null, clarification: null };
	}
	return reconcileTrimClip({ state, op, opIndex });
}

function reconcileMoveSegment({
	state,
	op,
	opIndex,
}: {
	state: ReconciliationState;
	op: TimelineDiffOp;
	opIndex: number;
}): ReconcileOutcome {
	if (op.type !== "MOVE_SEGMENT") {
		return { op: null, clarification: null };
	}
	let segmentId = typeof op.segment_id === "string" ? op.segment_id : "";
	let toMs = Number.isFinite(op.to_ms) ? Math.max(0, op.to_ms) : 0;
	if (toMs > state.timelineDurationMs) {
		toMs = state.timelineDurationMs;
	}
	if (!segmentId || !state.segmentById.has(segmentId)) {
		const target = resolveTargetForOperation({
			state,
			operation: "move",
			allowedKinds: ["video"],
		});
		if (target.clarification) return { op: null, clarification: target.clarification };
		if (!target.segment) {
			return {
				op: null,
				clarification: null,
				droppedMessage: "Dropped MOVE_SEGMENT because target could not be resolved.",
			};
		}
		segmentId = target.segment.segment_id;
		state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, target.segment);
	}

	return {
		op: {
			type: "MOVE_SEGMENT",
			segment_id: segmentId,
			to_ms: toMs,
		},
		clarification: null,
		repairedMessage: `Reconciled MOVE_SEGMENT at index ${opIndex}.`,
	};
}

function reconcileDeleteSegment({
	state,
	op,
	opIndex,
}: {
	state: ReconciliationState;
	op: TimelineDiffOp;
	opIndex: number;
}): ReconcileOutcome {
	if (op.type !== "DELETE_SEGMENT") {
		return { op: null, clarification: null };
	}
	let segmentId = typeof op.segment_id === "string" ? op.segment_id : "";
	if (!segmentId || !state.segmentById.has(segmentId)) {
		const target = resolveTargetForOperation({
			state,
			operation: "delete",
			allowedKinds: ["video"],
		});
		if (target.clarification) return { op: null, clarification: target.clarification };
		if (!target.segment) {
			return {
				op: null,
				clarification: null,
				droppedMessage: "Dropped DELETE_SEGMENT because target could not be resolved.",
			};
		}
		segmentId = target.segment.segment_id;
		state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, target.segment);
	}

	return {
		op: {
			type: "DELETE_SEGMENT",
			segment_id: segmentId,
		},
		clarification: null,
		repairedMessage: `Reconciled DELETE_SEGMENT at index ${opIndex}.`,
	};
}

function reconcileDuplicateSegment({
	state,
	op,
	opIndex,
}: {
	state: ReconciliationState;
	op: TimelineDiffOp;
	opIndex: number;
}): ReconcileOutcome {
	if (op.type !== "DUPLICATE_SEGMENT") {
		return { op: null, clarification: null };
	}
	let segmentId = typeof op.segment_id === "string" ? op.segment_id : "";
	let toMs = Number.isFinite(op.to_ms) ? Math.max(0, op.to_ms) : 0;
	if (toMs > state.timelineDurationMs) {
		toMs = state.timelineDurationMs;
	}
	if (!segmentId || !state.segmentById.has(segmentId)) {
		const target = resolveTargetForOperation({
			state,
			operation: "duplicate",
			allowedKinds: ["video"],
		});
		if (target.clarification) return { op: null, clarification: target.clarification };
		if (!target.segment) {
			return {
				op: null,
				clarification: null,
				droppedMessage: "Dropped DUPLICATE_SEGMENT because target could not be resolved.",
			};
		}
		segmentId = target.segment.segment_id;
		if (!Number.isFinite(op.to_ms)) {
			toMs = target.segment.end_ms;
		}
		state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, target.segment);
	}

	return {
		op: {
			type: "DUPLICATE_SEGMENT",
			segment_id: segmentId,
			to_ms: toMs,
		},
		clarification: null,
		repairedMessage: `Reconciled DUPLICATE_SEGMENT at index ${opIndex}.`,
	};
}

function reconcileSwapSegments({
	state,
	op,
	opIndex,
}: {
	state: ReconciliationState;
	op: TimelineDiffOp;
	opIndex: number;
}): ReconcileOutcome {
	if (op.type !== "SWAP_SEGMENTS") {
		return { op: null, clarification: null };
	}

	let leftId = typeof op.a_id === "string" ? op.a_id : "";
	let rightId = typeof op.b_id === "string" ? op.b_id : "";

	const hasValidLeft = isVideoSegment({ state, segmentId: leftId });
	const hasValidRight = isVideoSegment({ state, segmentId: rightId });
	if (!hasValidLeft || !hasValidRight || leftId === rightId) {
		const left = resolveTargetForOperation({
			state,
			operation: "swap",
			allowedKinds: ["video"],
		});
		if (left.clarification) return { op: null, clarification: left.clarification };
		const right = resolveTargetForOperation({
			state,
			operation: "swap",
			allowedKinds: ["video"],
		});
		if (right.clarification) return { op: null, clarification: right.clarification };
		if (!left.segment || !right.segment || left.segment.segment_id === right.segment.segment_id) {
			return {
				op: null,
				clarification: null,
				droppedMessage: "Dropped SWAP_SEGMENTS because two distinct video targets were not deterministically recoverable.",
			};
		}
		leftId = left.segment.segment_id;
		rightId = right.segment.segment_id;
		state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, right.segment);
	}

	return {
		op: {
			type: "SWAP_SEGMENTS",
			a_id: leftId,
			b_id: rightId,
		},
		clarification: null,
		repairedMessage: `Reconciled SWAP_SEGMENTS at index ${opIndex}.`,
	};
}

function reconcileFixCaptionText({
	state,
	op,
	opIndex,
}: {
	state: ReconciliationState;
	op: TimelineDiffOp;
	opIndex: number;
}): ReconcileOutcome {
	if (op.type !== "FIX_CAPTION_TEXT") {
		return { op: null, clarification: null };
	}

	let segmentId = typeof op.segment_id === "string" ? op.segment_id : "";
	if (!segmentId || !isCaptionSegment({ state, segmentId })) {
		const target = resolveTargetForOperation({
			state,
			operation: "fix-caption",
			allowedKinds: ["caption"],
		});
		if (target.clarification) return { op: null, clarification: target.clarification };
		if (!target.segment) {
			return {
				op: null,
				clarification: null,
				droppedMessage: "Dropped FIX_CAPTION_TEXT because caption target could not be recovered.",
			};
		}
		segmentId = target.segment.segment_id;
		state.resolutionState = updateResolutionStateFromSegment(state.resolutionState, target.segment);
	}

	const caption = state.segmentById.get(segmentId) ?? null;
	if (!caption) {
		return {
			op: null,
			clarification: null,
			droppedMessage: "Dropped FIX_CAPTION_TEXT because caption segment is missing.",
		};
	}
	let from = typeof op.from === "string" ? op.from : "";
	const to = typeof op.to === "string" ? op.to : "";
	if (from.trim().length === 0) {
		from = caption.text_content;
	}
	if (to.trim().length === 0 || to === from) {
		return {
			op: null,
			clarification: null,
			droppedMessage: "Dropped FIX_CAPTION_TEXT because it remained empty or no-op after reconciliation.",
		};
	}

	return {
		op: {
			type: "FIX_CAPTION_TEXT",
			segment_id: segmentId,
			from,
			to,
		} satisfies FixCaptionTextOp,
		clarification: null,
		repairedMessage: `Reconciled FIX_CAPTION_TEXT at index ${opIndex}.`,
	};
}

function reconcileCutRange({
	state,
	op,
}: {
	state: ReconciliationState;
	op: TimelineDiffOp;
}): ReconcileOutcome {
	if (op.type !== "CUT_RANGE") {
		return { op: null, clarification: null };
	}
	const startMs = clamp(
		Number.isFinite(op.start_ms) ? op.start_ms : 0,
		0,
		state.timelineDurationMs,
	);
	const endMs = clamp(
		Number.isFinite(op.end_ms) ? op.end_ms : 0,
		0,
		state.timelineDurationMs,
	);
	if (endMs <= startMs) {
		return {
			op: null,
			clarification: null,
			droppedMessage: "Dropped CUT_RANGE because the range is invalid after clamping.",
		};
	}
	return {
		op: {
			type: "CUT_RANGE",
			start_ms: startMs,
			end_ms: endMs,
		},
		clarification: null,
		repairedMessage: "Reconciled CUT_RANGE bounds to timeline limits.",
	};
}

function reconcileAddTextOverlay({
	state,
	op,
}: {
	state: ReconciliationState;
	op: TimelineDiffOp;
}): ReconcileOutcome {
	if (op.type !== "ADD_TEXT_OVERLAY") {
		return { op: null, clarification: null };
	}
	let text = typeof op.text === "string" ? op.text.trim() : "";
	if (text.length === 0) {
		return {
			op: null,
			clarification: null,
			droppedMessage: "Dropped ADD_TEXT_OVERLAY because text is empty.",
		};
	}
	if (text.length > 140) {
		text = text.slice(0, 140);
	}
	let startMs = clamp(
		Number.isFinite(op.start_ms) ? op.start_ms : 0,
		0,
		state.overlayMaxEndMs,
	);
	let endMs = clamp(
		Number.isFinite(op.end_ms) ? op.end_ms : startMs + 2500,
		0,
		state.overlayMaxEndMs,
	);
	if (endMs <= startMs) {
		endMs = Math.min(state.overlayMaxEndMs, startMs + 2500);
	}
	if (endMs <= startMs) {
		return {
			op: null,
			clarification: null,
			droppedMessage: "Dropped ADD_TEXT_OVERLAY because range remained invalid.",
		};
	}
	const position = ALLOWED_OVERLAY_TEXT_POSITIONS.has(op.position)
		? op.position
		: "top";
	const styleId = ALLOWED_TEXT_OVERLAY_STYLE_IDS.has(op.style_id)
		? op.style_id
		: "overlay-top";
	const font = typeof op.font === "string" && op.font.trim().length > 0 ? op.font.trim() : "Arial";
	const size = clamp(Number.isFinite(op.size) ? Number(op.size) : 64, 24, 160);
	const color = isHexColor(op.color) ? op.color : "#FFFFFF";

	return {
		op: {
			type: "ADD_TEXT_OVERLAY",
			text,
			start_ms: startMs,
			end_ms: endMs,
			position,
			style_id: styleId,
			font,
			size,
			color,
			outline: typeof op.outline === "boolean" ? op.outline : true,
			background: typeof op.background === "boolean" ? op.background : false,
		} satisfies AddTextOverlayOp,
		clarification: null,
		repairedMessage: "Reconciled ADD_TEXT_OVERLAY style and timing to supported values.",
	};
}

function reconcileMakeVersion({
	state,
	op,
}: {
	state: ReconciliationState;
	op: TimelineDiffOp;
}): ReconcileOutcome {
	if (op.type !== "MAKE_VERSION") {
		return { op: null, clarification: null };
	}
	const maxDuration = Math.max(1, state.projectSummary.total_duration_s || 1);
	const durationTarget = clamp(
		Number.isFinite(op.duration_target_s) ? Number(op.duration_target_s) : maxDuration,
		1,
		maxDuration,
	);
	const aggressiveness = clamp(
		Number.isFinite(op.aggressiveness) ? Number(op.aggressiveness) : 0.6,
		0,
		1,
	);
	return {
		op: {
			type: "MAKE_VERSION",
			duration_target_s: durationTarget,
			aggressiveness,
		},
		clarification: null,
		repairedMessage: "Reconciled MAKE_VERSION numeric ranges.",
	};
}

function reconcileCaptionStyle({
	op,
}: {
	op: TimelineDiffOp;
}): ReconcileOutcome {
	if (op.type !== "SET_CAPTION_STYLE") {
		return { op: null, clarification: null };
	}
	const styleId =
		typeof op.style_id === "string" && op.style_id.trim().length > 0
			? op.style_id
			: "clean-bottom";
	const font =
		typeof op.font === "string" && op.font.trim().length > 0 ? op.font.trim() : "Arial";
	const size = Math.max(1, Number.isFinite(op.size) ? Number(op.size) : 56);
	const position = ALLOWED_CAPTION_POSITIONS.has(op.position) ? op.position : "bottom";
	const highlightMode = ALLOWED_HIGHLIGHT_MODES.has(op.highlight_mode)
		? op.highlight_mode
		: "none";

	return {
		op: {
			type: "SET_CAPTION_STYLE",
			style_id: styleId,
			font,
			size,
			position,
			outline: typeof op.outline === "boolean" ? op.outline : false,
			highlight_mode: highlightMode,
		} satisfies SetCaptionStyleOp,
		clarification: null,
		repairedMessage: "Reconciled SET_CAPTION_STYLE values to supported defaults.",
	};
}

function reconcileRemoveSilence({
	op,
}: {
	op: TimelineDiffOp;
}): ReconcileOutcome {
	if (op.type !== "REMOVE_SILENCE") {
		return { op: null, clarification: null };
	}
	return {
		op: {
			type: "REMOVE_SILENCE",
			threshold_ms:
				Number.isFinite(op.threshold_ms) && op.threshold_ms > 0
					? op.threshold_ms
					: 0.32,
			pad_ms: Number.isFinite(op.pad_ms) && op.pad_ms >= 0 ? op.pad_ms : 0.09,
			min_keep_ms:
				Number.isFinite(op.min_keep_ms) && op.min_keep_ms > 0
					? op.min_keep_ms
					: 0.45,
		},
		clarification: null,
		repairedMessage: "Reconciled REMOVE_SILENCE values to deterministic safe defaults.",
	};
}

function reconcileInsertBroll({
	state,
	op,
}: {
	state: ReconciliationState;
	op: TimelineDiffOp;
}): ReconcileOutcome {
	if (op.type !== "INSERT_BROLL") {
		return { op: null, clarification: null };
	}

	let mediaId = typeof op.media_id === "string" ? op.media_id : "";
	const mediaType = state.assetTypeById.get(mediaId);
	if (!mediaId || !mediaType || (mediaType !== "video" && mediaType !== "image")) {
		const resolvedMediaId = resolveBrollAssetFromPrompt({ state });
		if (!resolvedMediaId) {
			return {
				op: null,
				clarification: null,
				droppedMessage: "Dropped INSERT_BROLL because media asset is missing or not visual.",
			};
		}
		mediaId = resolvedMediaId;
	}

	const startMs = clamp(
		Number.isFinite(op.start_ms) ? op.start_ms : 0,
		0,
		state.timelineDurationMs,
	);
	const endMs = clamp(
		Number.isFinite(op.end_ms) ? op.end_ms : 0,
		0,
		state.timelineDurationMs,
	);
	if (endMs <= startMs) {
		return {
			op: null,
			clarification: null,
			droppedMessage: "Dropped INSERT_BROLL because range remained invalid.",
		};
	}

	const lane = ALLOWED_BROLL_LANES.has(op.lane) ? op.lane : "overlay-primary";
	const fitMode = ALLOWED_BROLL_FIT_MODES.has(op.fit_mode) ? op.fit_mode : "cover";
	const mute = typeof op.mute === "boolean" ? op.mute : true;

	return {
		op: {
			type: "INSERT_BROLL",
			media_id: mediaId,
			start_ms: startMs,
			end_ms: endMs,
			lane,
			fit_mode: fitMode,
			mute,
		} satisfies InsertBrollOp,
		clarification: null,
		repairedMessage: "Reconciled INSERT_BROLL fields to supported values.",
	};
}

function resolveBrollAssetFromPrompt({ state }: { state: ReconciliationState }): string | null {
	const clauses = splitCompoundRequest(state.userText);
	const sourceTexts = clauses.length > 0 ? clauses : [state.userText.trim()];
	for (const clause of sourceTexts) {
		const parsed = parsePhraseBrollRequest({ text: clause });
		if (!parsed) {
			continue;
		}

		const match = resolveMediaAssetByName({
			query: parsed.assetName,
			mediaAssets: state.projectSummary.media_assets.map((asset) => ({
				id: asset.asset_id,
				name: asset.name,
			})),
		});
		if (!match) {
			continue;
		}

		const assetType = state.assetTypeById.get(match.assetId);
		if (assetType === "video" || assetType === "image") {
			return match.assetId;
		}
	}
	return null;
}

function resolveTargetForOperation({
	state,
	operation,
	allowedKinds,
}: {
	state: ReconciliationState;
	operation: TargetIntent["operation"];
	allowedKinds: ProjectSegmentSummary["segment_kind"][];
}): ResolveTargetResult {
	const intent = takeNextIntent({ state, operation });
	if (!intent) {
		return { segment: null, clarification: null };
	}

	const forcedSegmentId =
		state.overrides?.forced_segment_ids_by_reference?.[intent.referenceLabel] ?? null;
	if (forcedSegmentId) {
		const forcedSegment =
			state.projectSummary.segments.find(
				(segment) =>
					segment.segment_id === forcedSegmentId &&
					allowedKinds.includes(segment.segment_kind),
			) ?? null;
		if (forcedSegment) {
			return { segment: forcedSegment, clarification: null };
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

	candidates = candidates.filter((candidate) =>
		allowedKinds.includes(candidate.segment_kind),
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

function takeNextIntent({
	state,
	operation,
}: {
	state: ReconciliationState;
	operation: TargetIntent["operation"];
}): TargetIntent | undefined {
	const cursor = state.intentCursors[operation];
	const intent = state.intentsByOperation[operation][cursor];
	if (intent) {
		state.intentCursors[operation] = cursor + 1;
	}
	return intent;
}

function recordRepairNotice({
	state,
	error,
	opIndex,
	message,
}: {
	state: ReconciliationState;
	error: TimelineOpsValidationError;
	opIndex: number;
	message: string;
}) {
	state.notices.push({
		code: "reconciled_validator_error",
		severity: "warning",
		source: "validator",
		message,
		opIndex,
		validatorCode: error.code,
		repaired: true,
	});
}

function recordDropNotice({
	state,
	error,
	opIndex,
	message,
}: {
	state: ReconciliationState;
	error: TimelineOpsValidationError;
	opIndex: number;
	message: string;
}) {
	state.notices.push({
		code: "dropped_after_validator_error",
		severity: "error",
		source: "validator",
		message,
		opIndex,
		validatorCode: error.code,
		dropped: true,
	});
}

function recordBlockedNotice({
	state,
	code,
	message,
	error,
	opIndex,
}: {
	state: ReconciliationState;
	code: "blocked_validator_reconcile_failed" | "blocked_validator_reconcile_ambiguous";
	message: string;
	error: TimelineOpsValidationError | null;
	opIndex?: number;
}) {
	state.notices.push({
		code,
		severity: "error",
		source: "validator",
		message,
		opIndex,
		validatorCode: error?.code,
	});
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

function isVideoSegment({
	state,
	segmentId,
}: {
	state: ReconciliationState;
	segmentId: string;
}): boolean {
	const segment = state.segmentById.get(segmentId) ?? null;
	return Boolean(segment && segment.segment_kind === "video");
}

function isCaptionSegment({
	state,
	segmentId,
}: {
	state: ReconciliationState;
	segmentId: string;
}): boolean {
	const segment = state.segmentById.get(segmentId) ?? null;
	return Boolean(segment && segment.segment_kind === "caption");
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.max(min, Math.min(max, value));
}

function isHexColor(value: string): boolean {
	return /^#[0-9a-f]{6}$/i.test(value);
}
