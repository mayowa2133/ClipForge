import { calculateTotalDuration } from "@/lib/timeline";
import { buildTranscriptSnippetForElement } from "@/lib/clipforge/timeline-transcript";
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
	const segments = tracks.flatMap((track) =>
		track.elements.map((element) => {
			let transcriptSnippet = "";
			if (element.type === "text") {
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

			return {
				segment_id: element.id,
				track_type: track.type,
				start_ms: Math.round(element.startTime * 1000),
				end_ms: Math.round((element.startTime + element.duration) * 1000),
				transcript_snippet: transcriptSnippet,
			};
		}),
	);

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
		segments: segments
			.sort((a, b) => a.start_ms - b.start_ms)
			.slice(0, 240),
		media_assets: mediaAssetSummaries,
	};
}
