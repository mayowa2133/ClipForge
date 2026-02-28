import type { TimelineDiffOp } from "@/types/clipforge";
import { resolveMediaAssetByName } from "@/lib/clipforge/media-resolver";
import type { ChatOpsProvider } from "../types";

export class HeuristicChatOpsProvider implements ChatOpsProvider {
	async proposeEdits({
		userText,
		projectSummary,
	}: {
		userText: string;
		projectSummary: Parameters<ChatOpsProvider["proposeEdits"]>[0]["projectSummary"];
	}): Promise<TimelineDiffOp[]> {
		const text = userText.toLowerCase();
		const ops: TimelineDiffOp[] = [];

		if (text.includes("remove more pause") || text.includes("remove pauses")) {
			ops.push({
				type: "REMOVE_SILENCE",
				threshold_ms: 0.32,
				pad_ms: 0.09,
				min_keep_ms: 0.45,
			});
		}

		const durationMatch = text.match(/(\d+)\s?s(?:ec|econd)?s?\b/);
		if (durationMatch) {
			const targetDuration = Number(durationMatch[1]);
			if (targetDuration > 0) {
				ops.push({
					type: "MAKE_VERSION",
					duration_target_s: targetDuration,
					aggressiveness: 0.75,
				});
			}
		} else if (text.includes("faster")) {
			ops.push({
				type: "MAKE_VERSION",
				duration_target_s: Math.max(5, Math.round(projectSummary.total_duration_s * 0.82)),
				aggressiveness: 0.65,
			});
		}

		if (text.includes("bold center")) {
			ops.push({
				type: "SET_CAPTION_STYLE",
				style_id: "bold-center",
				font: "Arial",
				size: 74,
				position: "center",
				outline: true,
				highlight_mode: "line",
			});
		}

		if (
			text.includes("clean bottom") ||
			text.includes("subtitle style") ||
			text.includes("subtitles")
		) {
			ops.push({
				type: "SET_CAPTION_STYLE",
				style_id: "clean-bottom",
				font: "Arial",
				size: 56,
				position: "bottom",
				outline: false,
				highlight_mode: "none",
			});
		}

		const cutWordMatch =
			text.match(/cut where i say ['"]([^'"]+)['"]/) ??
			text.match(/cut when i say ['"]([^'"]+)['"]/);
		if (cutWordMatch) {
			const term = cutWordMatch[1].trim().toLowerCase();
			const matchedSegment = projectSummary.segments.find((segment) =>
				segment.transcript_snippet.toLowerCase().includes(term),
			);
			if (matchedSegment) {
				ops.push({
					type: "CUT_RANGE",
					start_ms: Math.max(0, matchedSegment.start_ms - 180),
					end_ms: matchedSegment.end_ms + 120,
				});
			}
		}

		const brollMatch =
			text.match(
				/(?:add|insert)\s+(?:a\s+)?b-?roll\s+using\s+(.+?)\s+from\s+(\d+(?:\.\d+)?)s?\s+to\s+(\d+(?:\.\d+)?)s?\b/,
			) ??
			text.match(
				/use\s+(.+?)\s+as\s+b-?roll\s+from\s+(\d+(?:\.\d+)?)s?\s+to\s+(\d+(?:\.\d+)?)s?\b/,
			);
		if (brollMatch) {
			const [, rawAssetName, rawStartSeconds, rawEndSeconds] = brollMatch;
			const matchedAsset = resolveMediaAssetByName({
				query: rawAssetName,
				mediaAssets: projectSummary.media_assets.map((asset) => ({
					id: asset.asset_id,
					name: asset.name,
				})),
			});
			const startSeconds = Number(rawStartSeconds);
			const endSeconds = Number(rawEndSeconds);

			if (
				matchedAsset &&
				Number.isFinite(startSeconds) &&
				Number.isFinite(endSeconds) &&
				endSeconds > startSeconds
			) {
				ops.push({
					type: "INSERT_BROLL",
					media_id: matchedAsset.assetId,
					start_ms: Math.round(startSeconds * 1000),
					end_ms: Math.round(endSeconds * 1000),
					lane: "overlay-primary",
					fit_mode: "cover",
					mute: true,
				});
			}
		}

		return ops;
	}
}
