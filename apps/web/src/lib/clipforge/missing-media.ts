import { hasMediaId } from "@/lib/timeline/element-utils";
import { buildProjectAssemblyTracks } from "@/lib/scenes";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type { TimelineElement } from "@/types/timeline";

type ReplacementMediaType = "video" | "image" | "audio";

export interface MissingMediaReferenceSegment {
	trackId: string;
	segmentId: string;
	segmentType: TimelineElement["type"];
	startMs: number;
	endMs: number;
}

export interface MissingMediaReference {
	mediaId: string;
	referenceCount: number;
	allowedReplacementTypes: ReplacementMediaType[];
	segments: MissingMediaReferenceSegment[];
}

interface MissingMediaAccumulator {
	mediaId: string;
	allowed: Set<ReplacementMediaType>;
	segments: MissingMediaReferenceSegment[];
}

const REPLACEMENT_TYPE_ORDER: ReplacementMediaType[] = ["video", "image", "audio"];

export function collectMissingMediaReferences({
	project,
	mediaAssets,
}: {
	project: TProject | null;
	mediaAssets: MediaAsset[];
}): MissingMediaReference[] {
	if (!project) return [];
	if (project.scenes.length === 0) return [];

	const availableMediaIds = new Set(mediaAssets.map((asset) => asset.id));
	const byMediaId = new Map<string, MissingMediaAccumulator>();
	const assembledTracks = buildProjectAssemblyTracks({ scenes: project.scenes });

	for (const track of assembledTracks) {
		for (const element of track.elements) {
			if (!hasMediaId(element)) continue;
			if (availableMediaIds.has(element.mediaId)) continue;
			const allowedTypes = getAllowedReplacementTypesForElement({
				elementType: element.type,
			});
			if (allowedTypes.length === 0) continue;

			const segment: MissingMediaReferenceSegment = {
				trackId: track.id,
				segmentId: element.id,
				segmentType: element.type,
				startMs: Math.max(0, Math.round(element.startTime * 1000)),
				endMs: Math.max(
					0,
					Math.round((element.startTime + element.duration) * 1000),
				),
			};

			const existing = byMediaId.get(element.mediaId);
			if (!existing) {
				byMediaId.set(element.mediaId, {
					mediaId: element.mediaId,
					allowed: new Set(allowedTypes),
					segments: [segment],
				});
				continue;
			}

			existing.allowed = intersectAllowedTypes({
				a: existing.allowed,
				b: new Set(allowedTypes),
			});
			existing.segments.push(segment);
		}
	}

	return [...byMediaId.values()]
		.map((entry): MissingMediaReference => {
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
			};
		})
		.sort((a, b) => {
			const aStart = a.segments[0]?.startMs ?? Number.POSITIVE_INFINITY;
			const bStart = b.segments[0]?.startMs ?? Number.POSITIVE_INFINITY;
			if (aStart !== bStart) return aStart - bStart;
			return a.mediaId.localeCompare(b.mediaId);
		});
}

export function isReplacementTypeAllowed({
	allowedReplacementTypes,
	replacementType,
}: {
	allowedReplacementTypes: ReplacementMediaType[];
	replacementType: ReplacementMediaType;
}): boolean {
	return allowedReplacementTypes.includes(replacementType);
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
