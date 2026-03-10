import type { ProjectVersionTarget } from "./project";

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
	notes: string | null;
}

export interface DraftSectionPlan {
	kind: "hook" | "body" | "payoff" | "cta";
	label: string;
	targetDurationS: number;
	strategy: "talking" | "montage" | "broll" | "caption-led" | "overlay-led";
}

export type DraftBuildStepKind =
	| "auto-edit"
	| "make-version"
	| "generate-captions"
	| "apply-caption-style"
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
	opsAudit: TimelineDiffAuditEntry[];
}

export interface SerializedClipForgeProjectData
	extends Omit<ClipForgeProjectData, "opsAudit"> {
	opsAudit: SerializedTimelineDiffAuditEntry[];
}
