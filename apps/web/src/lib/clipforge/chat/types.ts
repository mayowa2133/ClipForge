import type { TimelineTranscriptWord } from "@/lib/clipforge/timeline-transcript";
import type { TimelineOpsValidationError } from "@/lib/clipforge/ops-validator";
import type {
	ClipForgeAppliedCommandSummary,
	ClipForgeEditorCommand,
	TimelineDiffOp,
} from "@/types/clipforge";
import type {
	ProjectAudioSettings,
	ProjectBrandKit,
	ProjectOverlayDefaults,
	ProjectVersionPack,
	ProjectVersionTarget,
} from "@/types/project";

export type ChatSegmentKind =
	| "video"
	| "caption"
	| "text-overlay"
	| "audio"
	| "sticker"
	| "unknown";

export interface ProjectSegmentSummary {
	segment_id: string;
	track_id: string;
	scene_id: string;
	track_type: string;
	segment_kind: ChatSegmentKind;
	start_ms: number;
	end_ms: number;
	ordinal: number;
	asset_id: string | null;
	element_name: string;
	text_content: string;
	transcript_snippet: string;
}

export interface ProjectMediaAssetSummary {
	asset_id: string;
	name: string;
	type: "video" | "image";
}

export interface ProjectSceneSummary {
	scene_id: string;
	name: string;
	duration_s: number;
	segment_count: number;
	transcript_snippet: string;
}

export interface ProjectTemplateSummary {
	id: string;
	name: string;
	kind: "project-kit" | "scene-recipe";
}

export interface ProjectMediaAnalysisMarkerSummary {
	asset_id: string;
	name: string;
	beat_marker_count: number;
	scene_cut_count: number;
	activity_window_count: number;
}

export interface ProjectSelectionSummary {
	selected_segment_ids: string[];
	selected_segments: ProjectSegmentSummary[];
}

export interface ProjectPlayheadNeighborhoodSummary {
	playhead_ms: number;
	nearby_segments: ProjectSegmentSummary[];
}

export interface ProjectSummary {
	total_duration_s: number;
	current_scene_id: string | null;
	caption_style_id: string | null;
	pause_stats: {
		region_count: number;
		total_pause_ms: number;
	};
	segments: ProjectSegmentSummary[];
	current_scene_segments: ProjectSegmentSummary[];
	other_scene_summaries: ProjectSceneSummary[];
	media_assets: ProjectMediaAssetSummary[];
	selection: ProjectSelectionSummary;
	playhead_neighborhood: ProjectPlayheadNeighborhoodSummary;
	version_pack: ProjectVersionPack | null;
	audio_mix: ProjectAudioSettings | null;
	overlay_defaults: ProjectOverlayDefaults | null;
	brand_kit: ProjectBrandKit | null;
	available_project_kits: ProjectTemplateSummary[];
	available_scene_recipes: ProjectTemplateSummary[];
	media_analysis_markers: ProjectMediaAnalysisMarkerSummary[];
	recent_ai_actions: ClipForgeAppliedCommandSummary[];
	recent_turn_summaries: string[];
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

export type ChatClarificationKind =
	| "target"
	| "asset"
	| "preset"
	| "scope"
	| "version-target";

export interface ChatClarificationOption {
	id: string;
	value: string;
	label: string;
	segment_id?: string | null;
	segment_kind?: ChatSegmentKind | null;
	start_ms?: number | null;
	end_ms?: number | null;
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
	forced_choice_values_by_reference?: Record<string, string>;
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

export type ChatPlanImpactKind =
	| "trim"
	| "move"
	| "swap"
	| "delete"
	| "duplicate"
	| "fix-caption"
	| "add-text"
	| "cut-range"
	| "insert-broll"
	| "caption-style"
	| "aspect-ratio"
	| "make-version"
	| "remove-silence"
	| "set-clip-speed"
	| "separate-audio"
	| "freeze-frame"
	| "transition"
	| "finishing-look"
	| "effect"
	| "overlay-preset"
	| "overlay-style"
	| "motion-preset"
	| "sound-sync"
	| "audio-mix"
	| "project-kit"
	| "version-pack"
	| "auto-reframe"
	| "unknown";

export interface ChatPlanImpactJumpTarget {
	time_ms: number;
	track_id: string | null;
	segment_id: string | null;
}

export interface ChatPlanImpactCard {
	opIndex: number;
	opType: string;
	kind: ChatPlanImpactKind;
	title: string;
	detail: string;
	beforeText?: string | null;
	afterText?: string | null;
	beforeRangeMs?: { start: number; end: number } | null;
	afterRangeMs?: { start: number; end: number } | null;
	jump?: ChatPlanImpactJumpTarget | null;
}

export interface ChatPlanPreviewSummary {
	totalCommands: number;
	totalOps: number;
	impactCount: number;
	simulatedDurationDeltaMs: number;
}

export interface ChatPlanPreviewResult {
	cards: ChatPlanImpactCard[];
	summary: ChatPlanPreviewSummary;
}

export interface ChatValidatorReconciliationResult {
	ops: TimelineDiffOp[];
	clarification: ChatClarificationRequest | null;
	safety: ChatPlanSafetySummary;
	firstPassErrors: TimelineOpsValidationError[];
	secondPassErrors: TimelineOpsValidationError[];
	blocked: boolean;
}

export interface ChatPlanResult {
	commands?: ClipForgeEditorCommand[];
	ops?: TimelineDiffOp[];
	provider: ChatPlannerKind;
	fallbackUsed: boolean;
	warnings: string[];
	clarification?: ChatClarificationRequest | null;
	safety?: ChatPlanSafetySummary | null;
	rawText?: string | null;
}

export type ChatProposalResult = ChatPlanResult;

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
	}): Promise<ChatPlanResult>;
}
