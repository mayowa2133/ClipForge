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
}
