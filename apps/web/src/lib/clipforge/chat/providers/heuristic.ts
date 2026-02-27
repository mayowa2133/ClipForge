import type { TimelineDiffOp } from "@/types/clipforge";
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

		return ops;
	}
}
