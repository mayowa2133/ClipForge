import type {
	OverlayMotionPresetId,
	ProjectAudioSettings,
	ProjectBrandKit,
	ProjectOverlayDefaults,
	ProjectVersionTarget,
	ProjectVersionPack,
} from "./project";
import type {
	ExportFormat,
	ExportPreflightAction,
	ExportQuality,
	PublishDestination,
} from "./export";
import type {
	AnimationSfxPresetId,
	OverlayStyleVariantId,
	OverlayTextSlot,
	SocialOverlayPresetId,
	TransitionPreset,
	VisualEffectKind,
} from "./timeline";

export type ClipForgeAspectRatioPreset = "9:16" | "1:1" | "16:9";

export type CaptionHighlightMode = "none" | "line" | "word";
export type CaptionPosition = "bottom" | "center";
export type OverlayTextPosition = "top" | "center" | "bottom";
export type BrollLane = "overlay-primary";
export type BrollFitMode = "cover";
export type TextOverlayStyleId =
	| "clean-bottom"
	| "bold-center"
	| "overlay-top"
	| "overlay-center";
export type ClipForgeTranscriptionStatus =
	| "idle"
	| "processing"
	| "ready"
	| "error";
export type ClipForgeTranscriptionProvider =
	| "srt-import"
	| "whisper-cli"
	| "browser-whisper";

export interface TranscriptWord {
	text: string;
	start_ms: number;
	end_ms: number;
}

export interface TranscriptSegment {
	text: string;
	start_ms: number;
	end_ms: number;
}

export interface SilenceRegion {
	start_ms: number;
	end_ms: number;
}

export interface ClipMediaMetadata {
	words: TranscriptWord[];
	segments: TranscriptSegment[];
	silenceRegions: SilenceRegion[];
	transcriptionStatus: ClipForgeTranscriptionStatus;
	transcriptionProvider: ClipForgeTranscriptionProvider | null;
	transcriptionLanguage: string | null;
	transcriptionError: string | null;
	indexedAt: string | null;
}

export interface CaptionStyleTemplate {
	style_id: string;
	font: string;
	size: number;
	position: CaptionPosition;
	outline: boolean;
	highlight_mode: CaptionHighlightMode;
	reveal_preset_id?: CaptionRevealPresetId | null;
	sound_sync_preset_id?: AnimationSfxPresetId | null;
}

export interface CaptionSegmentView {
	elementId: string;
	trackId: string;
	text: string;
	startTime: number;
	duration: number;
	endTime: number;
	words: Array<{ text: string; startTime: number; endTime: number }> | null;
}

export interface FootageMomentScore {
	id: string;
	trackId: string;
	elementId: string;
	startTime: number;
	endTime: number;
	totalScore: number;
	reasons: string[];
}

export interface HookCandidate {
	id: string;
	trackId: string;
	elementId: string;
	startTime: number;
	endTime: number;
	score: number;
	reasons: string[];
}

export interface KeepCutRecommendation {
	id: string;
	trackId: string;
	elementId: string;
	action: "keep" | "trim" | "cut";
	startTime: number;
	endTime: number;
	score: number;
	reasons: string[];
}

export interface FootageIntelligenceReport {
	generatedAt: string;
	hookCandidates: HookCandidate[];
	momentScores: FootageMomentScore[];
	keepCutRecommendations: KeepCutRecommendation[];
	warnings: string[];
}

export type TrendSoundPlatform = "tiktok" | "instagram" | "youtube";

export interface TrendSoundReference {
	id: string;
	label: string;
	platform: TrendSoundPlatform;
	creator?: string | null;
	sourceUrl?: string | null;
	notes?: string | null;
	createdAt: string;
}

export type CreativeBriefGoal =
	| "viral-tiktok"
	| "vlog"
	| "luxury-routine"
	| "talking-head"
	| "product-highlight";

export type CreativeBriefTone =
	| "clean"
	| "bold"
	| "luxury"
	| "energetic"
	| "minimal";

export interface CreativeBrief {
	goal: CreativeBriefGoal;
	tone: CreativeBriefTone;
	durationTargetS: number | null;
	captionStyleId: string | null;
	overlayStyleVariantId: string | null;
	motionPresetId: string | null;
	beatDivision: 1 | 2 | 4 | null;
	versionTargets: ProjectVersionTarget[];
	trendSoundReferenceId?: string | null;
	notes: string | null;
}

export type CaptionRevealPresetId =
	| "none"
	| "fade-line"
	| "pop-line"
	| "type-on-soft"
	| "type-on-bold"
	| "lift-in"
	| "luxury-rise";

export type AudioPolishPresetId =
	| "none"
	| "voice-forward"
	| "luxury-soft"
	| "bold-social"
	| "music-forward";

export type PolishProfileId =
	| "clean-vlog"
	| "luxury-routine"
	| "bold-social"
	| "talking-head"
	| "product-promo";

export type PolishFinishingLookId =
	| "clean"
	| "warm"
	| "cool"
	| "dramatic"
	| "mono"
	| "vintage";

export interface PolishProfile {
	id: PolishProfileId;
	label: string;
	captionStyleId: string;
	captionRevealPresetId: CaptionRevealPresetId;
	overlayStyleVariantId: OverlayStyleVariantId;
	motionPresetId: OverlayMotionPresetId;
	animationSfxPresetId?: AnimationSfxPresetId | null;
	finishingLookId: PolishFinishingLookId;
	audioPolishPresetId: AudioPolishPresetId;
}

export interface DraftSectionPlan {
	kind: "hook" | "body" | "payoff" | "cta";
	label: string;
	targetDurationS: number;
	strategy: "talking" | "montage" | "broll" | "caption-led" | "overlay-led";
}

export interface RetentionBeat {
	kind: "hook" | "setup" | "body" | "payoff" | "cta";
	label: string;
	startTime: number;
	endTime: number;
	strategy: "talking" | "montage" | "broll" | "caption-led" | "overlay-led";
	reasons: string[];
}

export interface RetentionShapeStep {
	kind:
		| "promote-hook"
		| "trim-setup"
		| "compress-body"
		| "delay-context"
		| "insert-payoff"
		| "reserve-cta";
	params: Record<string, unknown>;
	reasons: string[];
}

export interface RetentionShapePlan {
	generatedAt: string;
	beats: RetentionBeat[];
	steps: RetentionShapeStep[];
	warnings: string[];
	hookCandidateId?: string | null;
	payoffMomentIds?: string[];
}

export type DraftBuildStepKind =
	| "auto-edit"
	| "make-version"
	| "generate-captions"
	| "apply-caption-style"
	| "apply-polish-profile"
	| "apply-project-kit"
	| "insert-scene-recipe"
	| "insert-overlay"
	| "auto-montage"
	| "apply-version-pack"
	| "apply-safe-layout";

export interface DraftBuildStep {
	kind: DraftBuildStepKind;
	params: Record<string, unknown>;
}

export interface DraftRecipe {
	brief: CreativeBrief;
	sections: DraftSectionPlan[];
	operations: DraftBuildStep[];
	retentionShape?: RetentionShapePlan | null;
	hookCandidateId?: string | null;
	keepCutRecommendationIds?: string[];
	warnings: string[];
}

export interface DraftImpactSummary {
	totalSteps: number;
	overlayCount: number;
	versionTargets: ProjectVersionTarget[];
	willRebuildAssembly: boolean;
	willGenerateCaptions: boolean;
	usesBeatMontage: boolean;
}

export type ClipForgeCommandScope = "selection" | "scene" | "project";

export type ReferenceVideoAnalysisStatus =
	| "idle"
	| "ready"
	| "stale"
	| "missing"
	| "error";

export type ReferencePacingCadence = "slow" | "medium" | "fast";
export type ReferenceEnergyLevel = "low" | "medium" | "high";
export type ReferenceCaptionTone = "soft" | "clean" | "bold" | "luxury";
export type ReferenceOverlayDensity = "none" | "light" | "heavy";

export interface ReferenceVideoSectionPlanEntry {
	label: string;
	start_ms: number;
	end_ms: number;
	role: "hook" | "body" | "payoff";
}

export interface ReferenceVideoShotPattern {
	average_shot_ms: number | null;
	transition_cadence: ReferencePacingCadence;
	scene_cut_count: number;
	activity_intensity: ReferenceEnergyLevel;
}

export interface ReferenceVideoCaptionProfile {
	presence: "none" | "light" | "heavy";
	reveal_preset_id: CaptionRevealPresetId | null;
	tone: ReferenceCaptionTone | null;
	average_words_per_segment: number | null;
}

export interface ReferenceVideoAudioProfile {
	music_mood:
		| "clean"
		| "luxury"
		| "upbeat"
		| "energetic"
		| "minimal"
		| null;
	recommended_music_asset_id: string | null;
	recommended_sfx_asset_id: string | null;
	bpm: number | null;
	energy: ReferenceEnergyLevel;
}

export interface ReferenceVideoOverlayProfile {
	density: ReferenceOverlayDensity;
	variant_id: OverlayStyleVariantId | null;
	motion_preset_id: OverlayMotionPresetId | null;
}

export interface ReferenceVideoFinishingProfile {
	polish_profile_id: PolishProfileId | null;
	finishing_look_id: PolishFinishingLookId | null;
}

export interface ReferenceVideoPublishProfile {
	publish_destination: PublishDestination | null;
	target_version_id: ProjectVersionTarget | null;
	packaging_hint: string;
	hook_pattern: string;
}

export interface ReferenceVideoAnalysis {
	analyzedAt: string;
	status: ReferenceVideoAnalysisStatus;
	sectionPlan: ReferenceVideoSectionPlanEntry[];
	shotPattern: ReferenceVideoShotPattern;
	captionProfile: ReferenceVideoCaptionProfile;
	audioProfile: ReferenceVideoAudioProfile;
	overlayProfile: ReferenceVideoOverlayProfile;
	finishingProfile: ReferenceVideoFinishingProfile;
	publishProfile: ReferenceVideoPublishProfile;
	warnings: string[];
}

export interface FootageDescriptorRange {
	range_id: string;
	label: string;
	start_ms: number;
	end_ms: number;
	hook_score: number;
	activity_score: number;
	transcript_cues: string[];
	semantic_summary: string;
}

export interface FootageDescriptor {
	analyzedAt: string;
	asset_id: string;
	asset_name: string;
	duration_ms: number;
	aspect_ratio: ClipForgeAspectRatioPreset | "unknown";
	scene_cut_count: number;
	activity_intensity: ReferenceEnergyLevel;
	beat_bpm: number | null;
	hook_score: number;
	transcript_cues: string[];
	semantic_summary: string;
	candidate_ranges: FootageDescriptorRange[];
	warnings: string[];
}

export interface ReferenceShotPlanSection {
	match_id: string;
	label: string;
	role: "hook" | "body" | "payoff" | "cta";
	target_start_ms: number;
	target_duration_ms: number;
	shot_cadence: ReferencePacingCadence;
	desired_energy: ReferenceEnergyLevel;
	overlay_moment: boolean;
	caption_moment: boolean;
	description: string;
}

export interface ReferenceShotPlan {
	analyzedAt: string;
	reference_asset_id: string;
	hook_pattern: string;
	ending_shape: "payoff" | "cta" | "open-ended";
	sections: ReferenceShotPlanSection[];
	warnings: string[];
}

export interface ReferenceDraftMatchCandidate {
	asset_id: string;
	asset_name: string;
	range_id: string;
	start_ms: number;
	end_ms: number;
	score: number;
	reasons: string[];
}

export interface ReferenceDraftSectionMatch {
	match_id: string;
	section_label: string;
	section_role: "hook" | "body" | "payoff" | "cta";
	target_start_ms: number;
	target_duration_ms: number;
	selected_asset_id: string;
	selected_asset_name: string;
	selected_range_id: string;
	selected_start_ms: number;
	selected_end_ms: number;
	reasons: string[];
	candidates: ReferenceDraftMatchCandidate[];
	locked: boolean;
}

export interface ReferenceMatchLock {
	match_id: string;
	asset_id: string;
	asset_name: string;
	locked_at: string;
}

export interface ClipForgeRecentReferenceAssemblyChoice {
	matchId: string;
	sectionLabel: string;
	sectionRole: "hook" | "body" | "payoff" | "cta";
	segmentId: string;
	assetId: string;
	assetLabel: string;
	alternativeAssetIds: string[];
	createdAt: string;
}

export interface TimelineDiffBaseOp {
	type:
		| "REMOVE_SILENCE"
		| "TRIM_CLIP"
		| "CUT_RANGE"
		| "ADD_TEXT_OVERLAY"
		| "MOVE_SEGMENT"
		| "SWAP_SEGMENTS"
		| "DELETE_SEGMENT"
		| "DUPLICATE_SEGMENT"
		| "INSERT_BROLL"
		| "SET_ASPECT_RATIO"
		| "SET_CAPTION_STYLE"
		| "FIX_CAPTION_TEXT"
		| "MAKE_VERSION";
}

export interface RemoveSilenceOp extends TimelineDiffBaseOp {
	type: "REMOVE_SILENCE";
	threshold_ms: number;
	pad_ms: number;
	min_keep_ms: number;
}

export interface TrimClipOp extends TimelineDiffBaseOp {
	type: "TRIM_CLIP";
	clip_id: string;
	in_ms: number;
	out_ms: number;
}

export interface CutRangeOp extends TimelineDiffBaseOp {
	type: "CUT_RANGE";
	start_ms: number;
	end_ms: number;
}

export interface AddTextOverlayOp extends TimelineDiffBaseOp {
	type: "ADD_TEXT_OVERLAY";
	text: string;
	start_ms: number;
	end_ms: number;
	position: OverlayTextPosition;
	style_id: TextOverlayStyleId;
	font: string;
	size: number;
	color: string;
	outline: boolean;
	background: boolean;
}

export interface MoveSegmentOp extends TimelineDiffBaseOp {
	type: "MOVE_SEGMENT";
	segment_id: string;
	to_ms: number;
}

export interface SwapSegmentsOp extends TimelineDiffBaseOp {
	type: "SWAP_SEGMENTS";
	a_id: string;
	b_id: string;
}

export interface DeleteSegmentOp extends TimelineDiffBaseOp {
	type: "DELETE_SEGMENT";
	segment_id: string;
}

export interface DuplicateSegmentOp extends TimelineDiffBaseOp {
	type: "DUPLICATE_SEGMENT";
	segment_id: string;
	to_ms: number;
}

export interface InsertBrollOp extends TimelineDiffBaseOp {
	type: "INSERT_BROLL";
	media_id: string;
	start_ms: number;
	end_ms: number;
	lane: BrollLane;
	fit_mode: BrollFitMode;
	mute: boolean;
}

export interface SetAspectRatioOp extends TimelineDiffBaseOp {
	type: "SET_ASPECT_RATIO";
	preset: ClipForgeAspectRatioPreset;
}

export interface SetCaptionStyleOp extends TimelineDiffBaseOp {
	type: "SET_CAPTION_STYLE";
	style_id: string;
	font: string;
	size: number;
	position: CaptionPosition;
	outline: boolean;
	highlight_mode: CaptionHighlightMode;
}

export interface FixCaptionTextOp extends TimelineDiffBaseOp {
	type: "FIX_CAPTION_TEXT";
	segment_id: string;
	from: string;
	to: string;
}

export interface MakeVersionOp extends TimelineDiffBaseOp {
	type: "MAKE_VERSION";
	duration_target_s: number;
	aggressiveness: number;
}

export type TimelineDiffOp =
	| RemoveSilenceOp
	| TrimClipOp
	| CutRangeOp
	| AddTextOverlayOp
	| MoveSegmentOp
	| SwapSegmentsOp
	| DeleteSegmentOp
	| DuplicateSegmentOp
	| InsertBrollOp
	| SetAspectRatioOp
	| SetCaptionStyleOp
	| FixCaptionTextOp
	| MakeVersionOp;

export interface TimelineOpEditorCommand {
	kind: "timeline-op";
	op: TimelineDiffOp;
}

export interface SetClipSpeedEditorCommand {
	kind: "set-clip-speed";
	target_segment_ids: string[];
	playback_rate: number;
	ripple: boolean;
	scope?: ClipForgeCommandScope;
}

export interface SeparateAudioEditorCommand {
	kind: "separate-audio";
	target_segment_ids: string[];
	scope?: ClipForgeCommandScope;
}

export interface InsertFreezeFrameEditorCommand {
	kind: "insert-freeze-frame";
	target_segment_id: string;
	at_ms: number;
	duration_ms: number;
	ripple: boolean;
	scope?: ClipForgeCommandScope;
}

export interface SetTransitionInEditorCommand {
	kind: "set-transition-in";
	target_segment_ids: string[];
	preset: TransitionPreset;
	duration_ms: number;
	scope?: ClipForgeCommandScope;
}

export interface ApplyFinishingLookEditorCommand {
	kind: "apply-finishing-look";
	target_segment_ids: string[];
	preset_id: PolishFinishingLookId;
	scope?: ClipForgeCommandScope;
}

export interface ApplyEffectPresetEditorCommand {
	kind: "apply-effect-preset";
	target_segment_ids: string[];
	effect_kind: VisualEffectKind;
	scope?: ClipForgeCommandScope;
}

export interface InsertOverlayPresetEditorCommand {
	kind: "insert-overlay-preset";
	preset_id: SocialOverlayPresetId;
	variant_id?: OverlayStyleVariantId | null;
	motion_preset_id?: OverlayMotionPresetId | null;
	start_ms: number;
	duration_ms: number;
	values?: Partial<Record<OverlayTextSlot, string>> | null;
	scope?: ClipForgeCommandScope;
}

export interface ApplyOverlayStyleEditorCommand {
	kind: "apply-overlay-style";
	target_element_ids: string[];
	variant_id: OverlayStyleVariantId;
	scope?: ClipForgeCommandScope;
}

export interface ApplyMotionPresetEditorCommand {
	kind: "apply-motion-preset";
	target_element_ids: string[];
	motion_preset_id: OverlayMotionPresetId;
	scope?: ClipForgeCommandScope;
}

export interface ApplySoundSyncEditorCommand {
	kind: "apply-sound-sync";
	target_element_ids: string[];
	pairing_id: AnimationSfxPresetId;
	scope?: ClipForgeCommandScope;
}

export interface SetAudioMixEditorCommand {
	kind: "set-audio-mix";
	settings: Partial<ProjectAudioSettings>;
	scope?: ClipForgeCommandScope;
}

export interface ApplyMusicTrackEditorCommand {
	kind: "apply-music-track";
	music_asset_id: string;
	start_ms?: number;
	volume?: number | null;
	loop_to_project_end?: boolean;
	scope?: ClipForgeCommandScope;
}

export interface ReplaceMusicTrackEditorCommand {
	kind: "replace-music-track";
	music_asset_id: string;
	start_ms?: number;
	volume?: number | null;
	loop_to_project_end?: boolean;
	scope?: ClipForgeCommandScope;
}

export interface InsertSfxPresetEditorCommand {
	kind: "insert-sfx-preset";
	sfx_asset_id: string;
	start_ms: number;
	duration_ms?: number | null;
	volume?: number | null;
	scope?: ClipForgeCommandScope;
}

export interface ApplyPolishProfileEditorCommand {
	kind: "apply-polish-profile";
	profile_id: PolishProfileId;
	scope?: ClipForgeCommandScope;
}

export interface ApplyCaptionRevealEditorCommand {
	kind: "apply-caption-reveal";
	preset_id: CaptionRevealPresetId;
	scope?: ClipForgeCommandScope;
}

export interface ApplyProjectKitEditorCommand {
	kind: "apply-project-kit";
	kit_id: string;
	scope?: ClipForgeCommandScope;
}

export interface SetVersionPackEditorCommand {
	kind: "set-version-pack";
	target_ids: ProjectVersionTarget[];
	active_target_id?: ProjectVersionTarget | null;
	scope?: ClipForgeCommandScope;
}

export interface AutoReframeSelectionEditorCommand {
	kind: "auto-reframe-selection";
	target_version_id: ProjectVersionTarget;
	scope?: ClipForgeCommandScope;
}

export interface SetPublishDestinationEditorCommand {
	kind: "set-publish-destination";
	publish_destination: PublishDestination;
	scope?: ClipForgeCommandScope;
}

export interface RunExportPreflightFixesEditorCommand {
	kind: "run-export-preflight-fixes";
	format: ExportFormat;
	quality: ExportQuality;
	include_audio: boolean;
	target_version_id?: ProjectVersionTarget | null;
	publish_destination?: PublishDestination | null;
	actions?: ExportPreflightAction[];
	scope?: ClipForgeCommandScope;
}

export interface SetActiveReferenceVideoEditorCommand {
	kind: "set-active-reference-video";
	asset_id: string;
	scope?: ClipForgeCommandScope;
}

export interface SetAssemblySourcePoolEditorCommand {
	kind: "set-assembly-source-pool";
	asset_ids: string[];
	scope?: ClipForgeCommandScope;
}

export interface ClearActiveReferenceVideoEditorCommand {
	kind: "clear-active-reference-video";
	scope?: ClipForgeCommandScope;
}

export interface ApplyReferenceFinishPassEditorCommand {
	kind: "apply-reference-finish-pass";
	reference_asset_id?: string | null;
	scope?: ClipForgeCommandScope;
}

export interface MatchReferenceCaptionsEditorCommand {
	kind: "match-reference-captions";
	reference_asset_id?: string | null;
	scope?: ClipForgeCommandScope;
}

export interface MatchReferenceAudioProfileEditorCommand {
	kind: "match-reference-audio-profile";
	reference_asset_id?: string | null;
	scope?: ClipForgeCommandScope;
}

export interface MatchReferencePackagingEditorCommand {
	kind: "match-reference-packaging";
	reference_asset_id?: string | null;
	scope?: ClipForgeCommandScope;
}

export interface MatchReferencePacingEditorCommand {
	kind: "match-reference-pacing";
	reference_asset_id?: string | null;
	scope?: ClipForgeCommandScope;
}

export interface BuildReferenceDraftEditorCommand {
	kind: "build-reference-draft";
	reference_asset_id?: string | null;
	source_asset_ids?: string[];
	matches: ReferenceDraftSectionMatch[];
	focus_match_ids?: string[] | null;
	include_finish_pass?: boolean;
	scope?: ClipForgeCommandScope;
}

export interface ReplaceWithSourceMatchEditorCommand {
	kind: "replace-with-source-match";
	match_id: string;
	asset_id: string;
	scope?: ClipForgeCommandScope;
}

export interface LockReferenceMatchEditorCommand {
	kind: "lock-reference-match";
	match_id: string;
	asset_id?: string | null;
	scope?: ClipForgeCommandScope;
}

export interface ClearReferenceMatchLocksEditorCommand {
	kind: "clear-reference-match-locks";
	scope?: ClipForgeCommandScope;
}

export type ClipForgeEditorCommand =
	| TimelineOpEditorCommand
	| SetClipSpeedEditorCommand
	| SeparateAudioEditorCommand
	| InsertFreezeFrameEditorCommand
	| SetTransitionInEditorCommand
	| ApplyFinishingLookEditorCommand
	| ApplyEffectPresetEditorCommand
	| InsertOverlayPresetEditorCommand
	| ApplyOverlayStyleEditorCommand
	| ApplyMotionPresetEditorCommand
	| ApplySoundSyncEditorCommand
	| SetAudioMixEditorCommand
	| ApplyMusicTrackEditorCommand
	| ReplaceMusicTrackEditorCommand
	| InsertSfxPresetEditorCommand
	| ApplyPolishProfileEditorCommand
	| ApplyCaptionRevealEditorCommand
	| ApplyProjectKitEditorCommand
	| SetVersionPackEditorCommand
	| AutoReframeSelectionEditorCommand
	| SetPublishDestinationEditorCommand
	| RunExportPreflightFixesEditorCommand
	| SetActiveReferenceVideoEditorCommand
	| SetAssemblySourcePoolEditorCommand
	| ClearActiveReferenceVideoEditorCommand
	| ApplyReferenceFinishPassEditorCommand
	| MatchReferenceCaptionsEditorCommand
	| MatchReferenceAudioProfileEditorCommand
	| MatchReferencePackagingEditorCommand
	| MatchReferencePacingEditorCommand
	| BuildReferenceDraftEditorCommand
	| ReplaceWithSourceMatchEditorCommand
	| LockReferenceMatchEditorCommand
	| ClearReferenceMatchLocksEditorCommand;

export interface ClipForgeChatMemoryStyleIntent {
	captionStyleId?: string | null;
	overlayStyleVariantId?: OverlayStyleVariantId | null;
	motionPresetId?: OverlayMotionPresetId | null;
	finishingLookId?: PolishFinishingLookId | null;
	audioPolishPresetId?: AudioPolishPresetId | null;
}

export interface ClipForgeChatMemoryPublishIntent {
	versionTargets: ProjectVersionTarget[];
	activeTargetId: ProjectVersionTarget | null;
}

export interface ClipForgeChatMemoryFinishIntent {
	polishProfileId?: PolishProfileId | null;
	captionRevealPresetId?: CaptionRevealPresetId | null;
	includeMusic?: boolean | null;
	includeSfx?: boolean | null;
	mood?: "clean" | "luxury" | "upbeat" | "energetic" | "minimal" | null;
}

export interface ClipForgeChatMemoryDestinationIntent {
	publishDestination: PublishDestination | null;
}

export interface ClipForgeChatMemoryReferenceIntent {
	referenceAssetId: string | null;
	referenceMode: "exact-recreation" | null;
}

export interface ClipForgeChatMemoryAssemblyIntent {
	referenceAssetId: string | null;
	sourceAssetIds: string[];
	focusMatchIds: string[];
}

export interface ClipForgeRecentAssetChoice {
	assetId: string;
	assetKind: "music" | "sfx" | "trend-reference" | "source-video";
	label: string;
	commandKind:
		| "apply-music-track"
		| "replace-music-track"
		| "insert-sfx-preset"
		| "apply-project-kit"
		| "build-reference-draft"
		| "replace-with-source-match";
	createdAt: string;
}

export interface ClipForgeChatTurnSummary {
	prompt: string;
	summary: string;
	commandKinds: ClipForgeEditorCommand["kind"][];
	createdAt: string;
}

export interface ClipForgeAppliedCommandSummary {
	kind: ClipForgeEditorCommand["kind"];
	summary: string;
	targetSegmentIds: string[];
	targetElementIds: string[];
	sceneId: string | null;
	scope: ClipForgeCommandScope;
	createdAt: string;
}

export interface ClipForgeChatMemory {
	activeTargets: string[];
	styleIntent: ClipForgeChatMemoryStyleIntent | null;
	publishIntent: ClipForgeChatMemoryPublishIntent | null;
	finishIntent: ClipForgeChatMemoryFinishIntent | null;
	destinationIntent: ClipForgeChatMemoryDestinationIntent | null;
	referenceIntent: ClipForgeChatMemoryReferenceIntent | null;
	assemblyIntent: ClipForgeChatMemoryAssemblyIntent | null;
	lockedMatchIds: string[];
	recentTurnSummaries: ClipForgeChatTurnSummary[];
	recentAppliedCommandSummaries: ClipForgeAppliedCommandSummary[];
	recentAssetChoices: ClipForgeRecentAssetChoice[];
	recentReferenceComparisons: string[];
	recentReferenceAssemblyChoices: ClipForgeRecentReferenceAssemblyChoice[];
}

export type TimelineDiffOpSource = "chat" | "auto-edit" | "manual";

export interface TimelineDiffAuditEntry {
	id: string;
	source: TimelineDiffOpSource;
	createdAt: Date;
	ops: TimelineDiffOp[];
}

export interface SerializedTimelineDiffAuditEntry
	extends Omit<TimelineDiffAuditEntry, "createdAt"> {
	createdAt: string;
}

export interface ClipForgeProjectData {
	schemaVersion: number;
	mediaMetadataById: Record<string, ClipMediaMetadata>;
	captionStylesById: Record<string, CaptionStyleTemplate>;
	activeCaptionStyleId: string | null;
	captionTrackIdsBySceneId: Record<string, string | null>;
	sceneFootageIntelligenceBySceneId: Record<string, FootageIntelligenceReport | null>;
	trendSoundReferences: TrendSoundReference[];
	activeReferenceVideoAssetId: string | null;
	referenceAnalysisByAssetId: Record<string, ReferenceVideoAnalysis>;
	assemblySourceAssetIds: string[];
	footageDescriptorsByAssetId: Record<string, FootageDescriptor>;
	referenceShotPlanByAssetId: Record<string, ReferenceShotPlan>;
	referenceMatchLocks: Record<string, ReferenceMatchLock>;
	chatMemory: ClipForgeChatMemory;
	opsAudit: TimelineDiffAuditEntry[];
}

export interface SerializedClipForgeProjectData
	extends Omit<ClipForgeProjectData, "opsAudit"> {
	opsAudit: SerializedTimelineDiffAuditEntry[];
}
