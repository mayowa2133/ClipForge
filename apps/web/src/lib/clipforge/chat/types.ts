import type { TimelineTranscriptWord } from "@/lib/clipforge/timeline-transcript";
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

export interface ChatProposalResult {
	ops: TimelineDiffOp[];
	provider: ChatPlannerKind;
	fallbackUsed: boolean;
	warnings: string[];
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
	}): Promise<ChatProposalResult>;
}
