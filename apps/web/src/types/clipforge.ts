export type ClipForgeAspectRatioPreset = "9:16" | "1:1" | "16:9";

export type CaptionHighlightMode = "none" | "line" | "word";
export type CaptionPosition = "bottom" | "center";

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
}

export interface CaptionStyleTemplate {
	style_id: string;
	font: string;
	size: number;
	position: CaptionPosition;
	outline: boolean;
	highlight_mode: CaptionHighlightMode;
}

export interface TimelineDiffBaseOp {
	type:
		| "REMOVE_SILENCE"
		| "TRIM_CLIP"
		| "CUT_RANGE"
		| "MOVE_SEGMENT"
		| "SWAP_SEGMENTS"
		| "DELETE_SEGMENT"
		| "DUPLICATE_SEGMENT"
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
	| MoveSegmentOp
	| SwapSegmentsOp
	| DeleteSegmentOp
	| DuplicateSegmentOp
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
	opsAudit: TimelineDiffAuditEntry[];
}

export interface SerializedClipForgeProjectData
	extends Omit<ClipForgeProjectData, "opsAudit"> {
	opsAudit: SerializedTimelineDiffAuditEntry[];
}
