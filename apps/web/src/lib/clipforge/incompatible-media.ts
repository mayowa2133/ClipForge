import { hasMediaId } from "@/lib/timeline/element-utils";
import { buildProjectAssemblyTracks } from "@/lib/scenes";
import {
	isMediaCompatibleForReference,
} from "@/lib/media/media-compatibility";
import type { MediaAsset, MediaCompatibilitySnapshot } from "@/types/assets";
import type { TProject } from "@/types/project";
import type { TimelineElement } from "@/types/timeline";

type ReplacementMediaType = "video" | "image" | "audio";

export interface IncompatibleMediaReferenceSegment {
	trackId: string;
	segmentId: string;
	segmentType: TimelineElement["type"];
	startMs: number;
	endMs: number;
	requiresVideoDecode: boolean;
	requiresAudioDecode: boolean;
}

export interface IncompatibleMediaReference {
	mediaId: string;
	referenceCount: number;
	allowedReplacementTypes: ReplacementMediaType[];
	segments: IncompatibleMediaReferenceSegment[];
	compatibilityStatus: "unknown" | "pending" | "compatible" | "incompatible" | "error";
	compatibilityReason: string | null;
	compatibilityCheckedAt: string | null;
	compatibilityVideoDecode:
		| "supported"
		| "unsupported"
		| "not-applicable"
		| "unknown";
	compatibilityAudioDecode:
		| "supported"
		| "unsupported"
		| "not-applicable"
		| "unknown";
	requiresVideoDecode: boolean;
	requiresAudioDecode: boolean;
}

interface ReferenceAccumulator {
	mediaId: string;
	allowed: Set<ReplacementMediaType>;
	segments: IncompatibleMediaReferenceSegment[];
	requiresVideoDecode: boolean;
	requiresAudioDecode: boolean;
	compatibility: MediaCompatibilitySnapshot | null;
}

const REPLACEMENT_TYPE_ORDER: ReplacementMediaType[] = ["video", "image", "audio"];

export function collectUnverifiedMediaReferences({
	project,
	mediaAssets,
	includeAudio,
}: {
	project: TProject | null;
	mediaAssets: MediaAsset[];
	includeAudio: boolean;
}): IncompatibleMediaReference[] {
	return collectCompatibilityReferences({ project, mediaAssets, includeAudio }).filter(
		(reference) =>
			reference.compatibilityStatus === "unknown" ||
			reference.compatibilityStatus === "pending" ||
			reference.compatibilityStatus === "error",
	);
}

export function collectIncompatibleMediaReferences({
	project,
	mediaAssets,
	includeAudio,
}: {
	project: TProject | null;
	mediaAssets: MediaAsset[];
	includeAudio: boolean;
}): IncompatibleMediaReference[] {
	return collectCompatibilityReferences({ project, mediaAssets, includeAudio }).filter(
		(reference) =>
			reference.compatibilityStatus !== "unknown" &&
			reference.compatibilityStatus !== "pending" &&
			reference.compatibilityStatus !== "error" &&
			!isMediaCompatibleForReference({
				snapshot: {
					status: reference.compatibilityStatus,
					videoDecode: reference.compatibilityVideoDecode,
					audioDecode: reference.compatibilityAudioDecode,
					reason: reference.compatibilityReason,
					checkedAt: reference.compatibilityCheckedAt,
					version: 1,
				},
				requiresVideoDecode: reference.requiresVideoDecode,
				requiresAudioDecode: reference.requiresAudioDecode,
			}),
	);
}

function collectCompatibilityReferences({
	project,
	mediaAssets,
	includeAudio,
}: {
	project: TProject | null;
	mediaAssets: MediaAsset[];
	includeAudio: boolean;
}): IncompatibleMediaReference[] {
	if (!project) return [];
	if (project.scenes.length === 0) return [];

	const assetsById = new Map(mediaAssets.map((asset) => [asset.id, asset]));
	const byMediaId = new Map<string, ReferenceAccumulator>();
	const assembledTracks = buildProjectAssemblyTracks({ scenes: project.scenes });

	for (const track of assembledTracks) {
		const trackMuted = "muted" in track ? !!track.muted : false;
		for (const element of track.elements) {
			if (!hasMediaId(element)) continue;
			const mediaAsset = assetsById.get(element.mediaId);
			if (!mediaAsset) continue;

			const allowedTypes = getAllowedReplacementTypesForElement({
				elementType: element.type,
			});
			if (allowedTypes.length === 0) continue;

			const requiresVideoDecode = element.type === "video";
			const elementMuted = "muted" in element ? !!element.muted : false;
			const requiresAudioDecode =
				includeAudio &&
				(element.type === "audio" || element.type === "video") &&
				!trackMuted &&
				!elementMuted;
			if (!requiresVideoDecode && !requiresAudioDecode) {
				continue;
			}

			const segment: IncompatibleMediaReferenceSegment = {
				trackId: track.id,
				segmentId: element.id,
				segmentType: element.type,
				startMs: Math.max(0, Math.round(element.startTime * 1000)),
				endMs: Math.max(
					0,
					Math.round((element.startTime + element.duration) * 1000),
				),
				requiresVideoDecode,
				requiresAudioDecode,
			};

			const existing = byMediaId.get(element.mediaId);
			if (!existing) {
				byMediaId.set(element.mediaId, {
					mediaId: element.mediaId,
					allowed: new Set(allowedTypes),
					segments: [segment],
					requiresVideoDecode,
					requiresAudioDecode,
					compatibility: mediaAsset.compatibility ?? null,
				});
				continue;
			}

			existing.allowed = intersectAllowedTypes({
				a: existing.allowed,
				b: new Set(allowedTypes),
			});
			existing.segments.push(segment);
			existing.requiresVideoDecode =
				existing.requiresVideoDecode || requiresVideoDecode;
			existing.requiresAudioDecode =
				existing.requiresAudioDecode || requiresAudioDecode;
		}
	}

	return [...byMediaId.values()]
		.map((entry): IncompatibleMediaReference => {
			const segments = [...entry.segments].sort((a, b) => {
				if (a.startMs !== b.startMs) return a.startMs - b.startMs;
				if (a.endMs !== b.endMs) return a.endMs - b.endMs;
				return a.segmentId.localeCompare(b.segmentId);
			});
			return {
				mediaId: entry.mediaId,
				referenceCount: segments.length,
				allowedReplacementTypes: REPLACEMENT_TYPE_ORDER.filter((type) =>
					entry.allowed.has(type),
				),
				segments,
				compatibilityStatus: entry.compatibility?.status ?? "unknown",
				compatibilityReason: entry.compatibility?.reason ?? null,
				compatibilityCheckedAt: entry.compatibility?.checkedAt ?? null,
				compatibilityVideoDecode: entry.compatibility?.videoDecode ?? "unknown",
				compatibilityAudioDecode: entry.compatibility?.audioDecode ?? "unknown",
				requiresVideoDecode: entry.requiresVideoDecode,
				requiresAudioDecode: entry.requiresAudioDecode,
			};
		})
		.sort((a, b) => {
			const aStart = a.segments[0]?.startMs ?? Number.POSITIVE_INFINITY;
			const bStart = b.segments[0]?.startMs ?? Number.POSITIVE_INFINITY;
			if (aStart !== bStart) return aStart - bStart;
			return a.mediaId.localeCompare(b.mediaId);
		});
}

function getAllowedReplacementTypesForElement({
	elementType,
}: {
	elementType: TimelineElement["type"];
}): ReplacementMediaType[] {
	if (elementType === "video") {
		return ["video"];
	}
	if (elementType === "image") {
		return ["image"];
	}
	if (elementType === "audio") {
		return ["audio", "video"];
	}
	return [];
}

function intersectAllowedTypes({
	a,
	b,
}: {
	a: Set<ReplacementMediaType>;
	b: Set<ReplacementMediaType>;
}): Set<ReplacementMediaType> {
	return new Set([...a].filter((type) => b.has(type)));
}
