import type { MediaAsset, MediaVisualAnalysis } from "@/types/assets";
import type { ClipMediaMetadata, TranscriptSegment } from "@/types/clipforge";

export interface SceneSegment {
	/** Index of this segment in the source clip. */
	index: number;
	/** Start time in seconds (source-relative). */
	startS: number;
	/** End time in seconds (source-relative). */
	endS: number;
	/** Duration in seconds. */
	durationS: number;
	/** Average visual activity score in this segment, if available. */
	visualActivityScore: number;
	/** Whether this segment contains speech. */
	hasSpeech: boolean;
	/** Number of words in this segment's speech. */
	wordCount: number;
	/** Transcript snippet for this segment. */
	transcriptSnippet: string;
}

export interface ImportAnalysisResult {
	/** The analyzed asset ID. */
	assetId: string;
	/** Total detected scene cuts. */
	sceneCutCount: number;
	/** Segments split at scene boundaries. */
	segments: SceneSegment[];
	/** Overall visual activity level. */
	activityLevel: "low" | "medium" | "high";
	/** Whether the clip has usable speech. */
	hasSpeech: boolean;
	/** Dominant content type heuristic. */
	contentType: "talking-head" | "montage" | "mixed" | "unknown";
	/** Warnings from the analysis. */
	warnings: string[];
}

const MIN_SEGMENT_DURATION_S = 0.5;

/**
 * Segment a clip at its scene cut boundaries.
 *
 * If no scene cuts are detected, returns a single segment
 * spanning the entire clip duration.
 */
export function segmentBySceneCuts({
	asset,
	sceneCuts,
}: {
	asset: MediaAsset;
	sceneCuts: number[];
}): Array<{ startS: number; endS: number }> {
	const duration = asset.duration ?? 0;
	if (duration <= 0) {
		return [];
	}

	const sortedCuts = [...sceneCuts]
		.filter((cut) => cut > MIN_SEGMENT_DURATION_S && cut < duration - MIN_SEGMENT_DURATION_S)
		.sort((a, b) => a - b);

	if (sortedCuts.length === 0) {
		return [{ startS: 0, endS: duration }];
	}

	const segments: Array<{ startS: number; endS: number }> = [];
	let prevEnd = 0;

	for (const cut of sortedCuts) {
		if (cut - prevEnd >= MIN_SEGMENT_DURATION_S) {
			segments.push({ startS: prevEnd, endS: cut });
		}
		prevEnd = cut;
	}

	// Final segment from last cut to end
	if (duration - prevEnd >= MIN_SEGMENT_DURATION_S) {
		segments.push({ startS: prevEnd, endS: duration });
	}

	return segments;
}

/**
 * Compute average visual activity for a time window within an asset's analysis.
 */
function computeVisualActivity({
	visualAnalysis,
	startS,
	endS,
}: {
	visualAnalysis: MediaVisualAnalysis | null | undefined;
	startS: number;
	endS: number;
}): number {
	if (!visualAnalysis?.activityWindows?.length) {
		return 0;
	}

	const overlapping = visualAnalysis.activityWindows.filter(
		(w) => w.endTime > startS && w.startTime < endS,
	);

	if (overlapping.length === 0) {
		return 0;
	}

	const totalScore = overlapping.reduce((sum, w) => sum + w.score, 0);
	return Number((totalScore / overlapping.length).toFixed(3));
}

/**
 * Count words from transcript metadata that fall within a time range.
 */
function countWordsInRange({
	metadata,
	startMs,
	endMs,
}: {
	metadata: ClipMediaMetadata | null;
	startMs: number;
	endMs: number;
}): { wordCount: number; snippet: string } {
	if (!metadata?.words?.length) {
		return { wordCount: 0, snippet: "" };
	}

	const words = metadata.words.filter(
		(w) => w.end_ms > startMs && w.start_ms < endMs,
	);

	return {
		wordCount: words.length,
		snippet: words
			.slice(0, 12)
			.map((w) => w.text)
			.join(" "),
	};
}

/**
 * Infer the dominant content type from analysis signals.
 *
 * - talking-head: few scene cuts, high speech density
 * - montage: many scene cuts, varied visual activity
 * - mixed: moderate cuts with speech
 * - unknown: insufficient data
 */
function inferContentType({
	sceneCutCount,
	hasSpeech,
	durationS,
	activityLevel,
}: {
	sceneCutCount: number;
	hasSpeech: boolean;
	durationS: number;
	activityLevel: "low" | "medium" | "high";
}): ImportAnalysisResult["contentType"] {
	if (durationS <= 0) return "unknown";

	const cutsPerSecond = sceneCutCount / Math.max(1, durationS);

	if (cutsPerSecond >= 0.3) {
		return "montage";
	}

	if (hasSpeech && cutsPerSecond < 0.1) {
		return "talking-head";
	}

	if (hasSpeech && cutsPerSecond >= 0.1) {
		return "mixed";
	}

	if (activityLevel === "high" && cutsPerSecond >= 0.15) {
		return "montage";
	}

	return "unknown";
}

/**
 * Analyze an imported clip to produce scene-level segments and metadata.
 *
 * This is meant to run during or shortly after import, giving the
 * autonomous pipeline a head start on understanding the footage before
 * the user even opens the editor timeline.
 */
export function analyzeImportedClip({
	asset,
	metadata,
}: {
	asset: MediaAsset;
	metadata: ClipMediaMetadata | null;
}): ImportAnalysisResult {
	const warnings: string[] = [];
	const duration = asset.duration ?? 0;

	if (duration <= 0) {
		return {
			assetId: asset.id,
			sceneCutCount: 0,
			segments: [],
			activityLevel: "low",
			hasSpeech: false,
			contentType: "unknown",
			warnings: ["Asset has no duration; scene analysis is not possible."],
		};
	}

	const visualAnalysis = asset.visualAnalysis ?? null;
	const sceneCuts = visualAnalysis?.sceneCuts ?? [];

	if (!visualAnalysis) {
		warnings.push(
			"No visual analysis data; scene segmentation uses the full clip as one segment.",
		);
	}

	const rawSegments = segmentBySceneCuts({ asset, sceneCuts });

	// Build enriched segments
	const segments: SceneSegment[] = rawSegments.map((seg, index) => {
		const activity = computeVisualActivity({
			visualAnalysis,
			startS: seg.startS,
			endS: seg.endS,
		});
		const { wordCount, snippet } = countWordsInRange({
			metadata,
			startMs: Math.round(seg.startS * 1000),
			endMs: Math.round(seg.endS * 1000),
		});

		return {
			index,
			startS: Number(seg.startS.toFixed(3)),
			endS: Number(seg.endS.toFixed(3)),
			durationS: Number((seg.endS - seg.startS).toFixed(3)),
			visualActivityScore: activity,
			hasSpeech: wordCount > 0,
			wordCount,
			transcriptSnippet: snippet,
		};
	});

	// Overall activity level
	const avgActivity =
		segments.length > 0
			? segments.reduce((sum, s) => sum + s.visualActivityScore, 0) / segments.length
			: 0;
	const activityLevel: ImportAnalysisResult["activityLevel"] =
		avgActivity >= 0.8 ? "high" : avgActivity >= 0.35 ? "medium" : "low";

	const hasSpeech = segments.some((s) => s.hasSpeech);

	const contentType = inferContentType({
		sceneCutCount: sceneCuts.length,
		hasSpeech,
		durationS: duration,
		activityLevel,
	});

	return {
		assetId: asset.id,
		sceneCutCount: sceneCuts.length,
		segments,
		activityLevel,
		hasSpeech,
		contentType,
		warnings,
	};
}

/**
 * Batch-analyze multiple imported clips.
 */
export function analyzeImportedClips({
	assets,
	metadataById,
}: {
	assets: MediaAsset[];
	metadataById: Record<string, ClipMediaMetadata>;
}): ImportAnalysisResult[] {
	return assets
		.filter((asset) => asset.type === "video" && !asset.ephemeral)
		.map((asset) =>
			analyzeImportedClip({
				asset,
				metadata: metadataById[asset.id] ?? null,
			}),
		);
}
