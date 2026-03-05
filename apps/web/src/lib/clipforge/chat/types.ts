import type { TimelineTranscriptWord } from "@/lib/clipforge/timeline-transcript";
import type { TimelineOpsValidationError } from "@/lib/clipforge/ops-validator";
import type { TimelineDiffOp } from "@/types/clipforge";

export type ChatSegmentKind =
	| "video"
	| "caption"
	| "text-overlay"
	| "audio"
	| "sticker"
	| "unknown";

export interface ProjectSegmentSummary {
	segment_id: string;
	track_type: string;
	segment_kind: ChatSegmentKind;
	start_ms: number;
	end_ms: number;
	ordinal: number;
	asset_id: string | null;
	text_content: string;
	transcript_snippet: string;
}

export interface ProjectMediaAssetSummary {
	asset_id: string;
	name: string;
	type: "video" | "image";
}

export interface ProjectSummary {
	total_duration_s: number;
	caption_style_id: string | null;
	pause_stats: {
		region_count: number;
		total_pause_ms: number;
	};
	segments: ProjectSegmentSummary[];
	media_assets: ProjectMediaAssetSummary[];
	timeline_words: TimelineTranscriptWord[];
}

export interface ChatPlannerContext {
	playhead_ms: number;
	selected_segment_ids: string[];
	active_scene_id: string | null;
}

export type ChatPlannerKind = "heuristic" | "openai";
export type ChatPlannerMode = "auto" | "heuristic" | "openai";
export type ChatPlannerHealthStatus = "ready" | "degraded" | "unavailable";

export interface ChatPlannerHealth {
	modelRouteAvailable: boolean;
	openaiConfigured: boolean;
	endpointConfigured: boolean;
	defaultModel: string | null;
	status: ChatPlannerHealthStatus;
	message: string;
	checkedAt: string;
}

export type ChatClarificationKind = "segment-target";

export interface ChatClarificationOption {
	id: string;
	label: string;
	segment_id: string;
	segment_kind: ChatSegmentKind;
	start_ms: number;
	end_ms: number;
	text_preview: string;
}

export interface ChatClarificationRequest {
	kind: ChatClarificationKind;
	prompt: string;
	referenceLabel: string;
	options: ChatClarificationOption[];
}

export interface ChatPlannerOverrides {
	forced_segment_ids_by_reference: Record<string, string>;
}

export type ChatPlanSafetySeverity = "warning" | "error";
export type ChatPlanSafetySource = "semantic" | "validator";

export type ChatPlanSafetyCode =
	| "repaired_target_id_from_intent"
	| "repaired_time_clamped"
	| "repaired_value_clamped"
	| "repaired_overlay_style_defaulted"
	| "repaired_overlay_text_truncated"
	| "dropped_target_not_found"
	| "dropped_target_kind_mismatch"
	| "dropped_target_deleted_by_prior_op"
	| "dropped_invalid_range"
	| "dropped_invalid_media_asset"
	| "dropped_noop"
	| "dropped_cross_op_conflict"
	| "dropped_unrecoverable"
	| "blocked_ambiguous_repair_target"
	| "blocked_no_safe_ops"
	| "reconciled_validator_error"
	| "dropped_after_validator_error"
	| "blocked_validator_reconcile_failed"
	| "blocked_validator_reconcile_ambiguous";

export interface ChatPlanSafetyNotice {
	code: ChatPlanSafetyCode;
	severity: ChatPlanSafetySeverity;
	source: ChatPlanSafetySource;
	message: string;
	opIndex?: number;
	validatorCode?: string;
	repaired?: boolean;
	dropped?: boolean;
}

export interface ChatPlanSafetySummary {
	repairedCount: number;
	droppedCount: number;
	blocked: boolean;
	notices: ChatPlanSafetyNotice[];
}

export interface ChatValidatorReconciliationResult {
	ops: TimelineDiffOp[];
	clarification: ChatClarificationRequest | null;
	safety: ChatPlanSafetySummary;
	firstPassErrors: TimelineOpsValidationError[];
	secondPassErrors: TimelineOpsValidationError[];
	blocked: boolean;
}

export interface ChatProposalResult {
	ops: TimelineDiffOp[];
	provider: ChatPlannerKind;
	fallbackUsed: boolean;
	warnings: string[];
	clarification?: ChatClarificationRequest | null;
	safety?: ChatPlanSafetySummary | null;
	rawText?: string | null;
}

export interface ChatOpsProvider {
	proposeEdits({
		userText,
		projectSummary,
		context,
	}: {
		userText: string;
		projectSummary: ProjectSummary;
		context: ChatPlannerContext;
		overrides?: ChatPlannerOverrides;
	}): Promise<ChatProposalResult>;
}
