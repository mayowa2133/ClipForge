import type { TimelineTranscriptWord } from "@/lib/clipforge/timeline-transcript";
import type { TimelineOpsValidationError } from "@/lib/clipforge/ops-validator";
import type {
	ClipForgeAppliedCommandSummary,
	ClipForgeEditorCommand,
	ReferenceVideoAnalysisStatus,
	TimelineDiffOp,
} from "@/types/clipforge";
import type { PublishDestination } from "@/types/export";
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
	type: "video" | "image" | "audio";
	duration_ms?: number | null;
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

export interface ProjectAudioLibraryAssetSummary {
	asset_id: string;
	label: string;
	kind: "music" | "sfx";
	mood?: "clean" | "luxury" | "upbeat" | "energetic" | "minimal" | null;
	usage_kind: string;
	bpm?: number | null;
	default_duration_ms?: number | null;
	tags: string[];
	allowed_destinations: PublishDestination[];
	rights_profile: "universal";
}

export interface ProjectTrendReferenceSummary {
	id: string;
	label: string;
	platform: PublishDestination;
	creator: string | null;
	notes: string | null;
}

export interface ProjectExportPreflightSnapshotSummary {
	ready: boolean;
	blocking_count: number;
	warning_count: number;
	actionable_actions: string[];
	issue_codes: string[];
}

export interface ProjectPackagingReadinessSummary {
	ready: boolean;
	status: "ready" | "attention" | "blocked";
	reason: string;
}

export interface ProjectActiveReferenceVideoSummary {
	asset_id: string;
	name: string;
	status: ReferenceVideoAnalysisStatus;
	analyzed_at: string | null;
	intent_summary: string;
	warnings: string[];
}

export interface ProjectReferenceAnalysisSnapshotSummary {
	transition_cadence: "slow" | "medium" | "fast";
	average_shot_ms: number | null;
	caption_tone: "soft" | "clean" | "bold" | "luxury" | null;
	caption_reveal_preset_id: string | null;
	audio_mood:
		| "clean"
		| "luxury"
		| "upbeat"
		| "energetic"
		| "minimal"
		| null;
	recommended_music_asset_id: string | null;
	recommended_sfx_asset_id: string | null;
	overlay_variant_id: string | null;
	polish_profile_id: string | null;
	finishing_look_id: string | null;
	publish_destination: PublishDestination | null;
	target_version_id: ProjectVersionTarget | null;
	hook_pattern: string;
}

export interface ProjectReferenceMatchReadinessSummary {
	ready: boolean;
	status: "ready" | "attention" | "blocked";
	reason: string;
}

export interface ProjectAssemblySourceSummary {
	asset_id: string;
	name: string;
	descriptor_summary: string;
}

export interface ProjectFootageMatchReadinessSummary {
	ready: boolean;
	status: "ready" | "attention" | "blocked";
	reason: string;
}

export interface ProjectReferenceShotPlanSectionSummary {
	match_id: string;
	label: string;
	role: "hook" | "body" | "payoff" | "cta";
	target_duration_ms: number;
	description: string;
}

export interface ProjectReferenceShotPlanSummary {
	hook_pattern: string;
	ending_shape: "payoff" | "cta" | "open-ended";
	sections: ProjectReferenceShotPlanSectionSummary[];
}

export interface ProjectCandidateSourceMatchSummary {
	match_id: string;
	section_label: string;
	section_role: "hook" | "body" | "payoff" | "cta";
	selected_asset_id: string;
	selected_asset_name: string;
	reasons: string[];
	candidate_asset_ids: string[];
	locked: boolean;
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
	available_music_assets: ProjectAudioLibraryAssetSummary[];
	available_sfx_assets: ProjectAudioLibraryAssetSummary[];
	imported_audio_assets?: ProjectMediaAssetSummary[];
	trend_reference_summary: ProjectTrendReferenceSummary[];
	publish_destination: PublishDestination | null;
	export_preflight_snapshot: ProjectExportPreflightSnapshotSummary | null;
	packaging_readiness: ProjectPackagingReadinessSummary;
	active_reference_video: ProjectActiveReferenceVideoSummary | null;
	reference_analysis_snapshot: ProjectReferenceAnalysisSnapshotSummary | null;
	reference_match_readiness: ProjectReferenceMatchReadinessSummary;
	assembly_source_pool: ProjectAssemblySourceSummary[];
	footage_match_readiness: ProjectFootageMatchReadinessSummary;
	reference_shot_plan: ProjectReferenceShotPlanSummary | null;
	candidate_source_matches: ProjectCandidateSourceMatchSummary[];
	recent_ai_actions: ClipForgeAppliedCommandSummary[];
	recent_turn_summaries: string[];
	timeline_words: TimelineTranscriptWord[];
}

export interface ChatPlannerContext {
	playhead_ms: number;
	selected_segment_ids: string[];
	active_scene_id: string | null;
}

export type ChatPlannerKind = "heuristic" | "openai" | "anthropic";
export type ChatPlannerMode = "auto" | "heuristic" | "openai" | "anthropic";
export type ChatPlannerHealthStatus = "ready" | "degraded" | "unavailable";

export interface ChatPlannerHealth {
	modelRouteAvailable: boolean;
	activeProvider: "anthropic" | "openai" | null;
	anthropicConfigured: boolean;
	openaiConfigured: boolean;
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
	| "music-track"
	| "sfx-preset"
	| "polish-profile"
	| "caption-reveal"
	| "project-kit"
	| "version-pack"
	| "auto-reframe"
	| "publish-destination"
	| "export-preflight-fixes"
	| "reference-video"
	| "reference-assembly-pool"
	| "reference-recreation"
	| "reference-draft"
	| "reference-draft-swap"
	| "reference-draft-lock"
	| "reference-finish"
	| "reference-captions"
	| "reference-audio"
	| "reference-packaging"
	| "reference-pacing"
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
