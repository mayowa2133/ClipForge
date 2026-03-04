import type { TimelineTranscriptWord } from "@/lib/clipforge/timeline-transcript";
import type { TimelineDiffOp } from "@/types/clipforge";

export interface ProjectSegmentSummary {
	segment_id: string;
	track_type: string;
	start_ms: number;
	end_ms: number;
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
	}: {
		userText: string;
		projectSummary: ProjectSummary;
	}): Promise<ChatProposalResult>;
}
