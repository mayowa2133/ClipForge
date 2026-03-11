import type { MediaAssetData } from "@/services/storage/types";

export type MediaType = "image" | "video" | "audio";

export interface MediaCompatibilitySnapshot {
	status: "unknown" | "pending" | "compatible" | "incompatible" | "error";
	videoDecode: "supported" | "unsupported" | "not-applicable" | "unknown";
	audioDecode: "supported" | "unsupported" | "not-applicable" | "unknown";
	reason?: string | null;
	checkedAt?: string | null;
	version: 1;
}

export interface MediaBeatAnalysis {
	bpm: number | null;
	downbeats: number[];
	beats: number[];
	analyzedAt: string | null;
	version: 1;
}

export interface MediaVisualActivityWindow {
	startTime: number;
	endTime: number;
	score: number;
}

export interface MediaVisualAnalysis {
	sceneCuts: number[];
	activityWindows: MediaVisualActivityWindow[];
	analyzedAt: string | null;
	version: 1;
}

export type MusicSourceType =
	| "bundled"
	| "user-imported"
	| "royalty-free-external"
	| "trend-reference";

export type MusicRightsProfile = "universal" | "platform-limited" | "unknown";

export interface DerivedMediaOrigin {
	kind: "freeze-frame";
	sourceMediaId: string;
	sourceTime: number;
}

export interface MediaAsset
	extends Omit<MediaAssetData, "size" | "lastModified"> {
	file: File;
	url?: string;
	derived?: DerivedMediaOrigin;
	libraryItemId?: string;
	musicSourceType?: MusicSourceType;
	rightsProfile?: MusicRightsProfile;
	allowedDestinations?:
		| Array<"tiktok" | "instagram" | "youtube" | "generic-export">
		| null;
	attributionRequired?: boolean;
	attributionText?: string | null;
	sourceLabel?: string | null;
	sourceUrl?: string | null;
}
