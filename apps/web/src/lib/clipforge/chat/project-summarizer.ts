import { calculateTotalDuration } from "@/lib/timeline";
import type { TProject } from "@/types/project";
import type { ProjectSummary } from "./types";

export function buildProjectSummary({
	project,
}: {
	project: TProject;
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
	};
}
