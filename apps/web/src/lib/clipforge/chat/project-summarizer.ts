import { calculateTotalDuration } from "@/lib/timeline";
import {
	buildTimelineTranscriptWords,
	buildTranscriptSnippetForElement,
} from "@/lib/clipforge/timeline-transcript";
import type { ChatSegmentKind } from "@/lib/clipforge/chat/types";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type { ProjectSummary } from "./types";

export function buildProjectSummary({
	project,
	mediaAssets = [],
}: {
	project: TProject;
	mediaAssets?: MediaAsset[];
}): ProjectSummary {
	const activeScene =
		project.scenes.find((scene) => scene.id === project.currentSceneId) ??
		project.scenes[0];
	const tracks = activeScene?.tracks ?? [];
	const rawSegments = tracks.flatMap((track) =>
		track.elements.map((element) => {
			let transcriptSnippet = "";
			let textContent = "";
			if (element.type === "text") {
				textContent = element.content;
				transcriptSnippet = element.content.slice(0, 80);
			} else if ("mediaId" in element && typeof element.mediaId === "string") {
				const metadata = project.clipforge?.mediaMetadataById[element.mediaId];
				if (
					(element.type === "video") ||
					(element.type === "audio" && element.sourceType === "upload")
				) {
					transcriptSnippet = buildTranscriptSnippetForElement({
						element,
						metadata,
					});
				}
			}

			const segmentKind = classifySegmentKind({
				trackType: track.type,
				trackName: track.name,
				elementType: element.type,
				elementName: element.name,
				textContent,
				durationMs: Math.round(element.duration * 1000),
			});

			return {
				segment_id: element.id,
				track_type: track.type,
				segment_kind: segmentKind,
				start_ms: Math.round(element.startTime * 1000),
				end_ms: Math.round((element.startTime + element.duration) * 1000),
				ordinal: 0,
				asset_id:
					"mediaId" in element && typeof element.mediaId === "string"
						? element.mediaId
						: null,
				text_content: textContent,
				transcript_snippet: transcriptSnippet,
			};
		}),
	);
	const segments = rawSegments
		.sort((a, b) => a.start_ms - b.start_ms)
		.map((segment) => ({ ...segment }));
	const ordinalByKind: Partial<Record<ChatSegmentKind, number>> = {};

	for (const segment of segments) {
		const nextOrdinal = (ordinalByKind[segment.segment_kind] ?? 0) + 1;
		ordinalByKind[segment.segment_kind] = nextOrdinal;
		segment.ordinal = nextOrdinal;
	}

	const silenceRegions = Object.values(
		project.clipforge?.mediaMetadataById ?? {},
	).flatMap((item) => item.silenceRegions);
	const totalPauseMs = silenceRegions.reduce(
		(sum, region) => sum + Math.max(0, region.end_ms - region.start_ms),
		0,
	);
	const mediaAssetSummaries = mediaAssets
		.filter(
			(asset): asset is MediaAsset & { type: "video" | "image" } =>
				(asset.type === "video" || asset.type === "image") && !asset.ephemeral,
		)
		.map((asset) => ({
			asset_id: asset.id,
			name: asset.name,
			type: asset.type,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));

	return {
		total_duration_s: calculateTotalDuration({ tracks }),
		caption_style_id: project.clipforge?.activeCaptionStyleId ?? null,
		pause_stats: {
			region_count: silenceRegions.length,
			total_pause_ms: Math.round(totalPauseMs),
		},
		segments: segments.slice(0, 240),
		media_assets: mediaAssetSummaries,
		timeline_words: buildTimelineTranscriptWords({ project }).slice(0, 1500),
	};
}

function classifySegmentKind({
	trackType,
	trackName,
	elementType,
	elementName,
	textContent,
	durationMs,
}: {
	trackType: string;
	trackName: string;
	elementType: string;
	elementName: string;
	textContent: string;
	durationMs: number;
}): ChatSegmentKind {
	if (elementType === "video" || elementType === "image") {
		return "video";
	}
	if (trackType === "audio") {
		return "audio";
	}
	if (trackType === "sticker" || elementType === "sticker") {
		return "sticker";
	}
	if (elementType !== "text") {
		return "unknown";
	}

	const normalizedTrackName = trackName.toLowerCase();
	const normalizedElementName = elementName.toLowerCase();
	const normalizedText = textContent.trim().toLowerCase();
	const isExplicitOverlay =
		normalizedElementName.includes("overlay") ||
		normalizedTrackName.includes("overlay");
	if (isExplicitOverlay) {
		return "text-overlay";
	}

	const isCaptionLike =
		normalizedTrackName.includes("caption") ||
		normalizedTrackName.includes("subtitle") ||
		normalizedElementName.includes("caption") ||
		normalizedElementName.includes("subtitle") ||
		(durationMs <= 6000 &&
			normalizedText.length > 0 &&
			normalizedText.length <= 160);

	return isCaptionLike ? "caption" : "text-overlay";
}
