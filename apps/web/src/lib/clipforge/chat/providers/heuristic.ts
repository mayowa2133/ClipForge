import {
	findPhraseOccurrences,
	resolvePhraseWindow,
} from "@/lib/clipforge/phrase-resolution";
import { resolveMediaAssetByName } from "@/lib/clipforge/media-resolver";
import {
	resolveCaptionReference,
	resolveSegmentReference,
} from "@/lib/clipforge/segment-resolution";
import { getTextOverlayPresetForPosition } from "@/lib/clipforge/text-overlay-presets";
import type { TimelineDiffOp } from "@/types/clipforge";
import { splitCompoundRequest } from "../compound-request";
import {
	parseDeleteSegmentRequest,
	parseDuplicateSegmentRequest,
	parseFixCaptionTextRequest,
	parseMoveSegmentRequest,
	parsePhraseBrollRequest,
	parsePhraseCutRequest,
	parseSwapSegmentsRequest,
	parseTextOverlayRequest,
	parseTrimClipRequest,
} from "../prompt-parsers";
import type { ChatOpsProvider, ChatProposalResult, ProjectSummary } from "../types";

const MAX_HEURISTIC_OPS = 5;

export class HeuristicChatOpsProvider implements ChatOpsProvider {
	async proposeEdits({
		userText,
		projectSummary,
	}: {
		userText: string;
		projectSummary: Parameters<ChatOpsProvider["proposeEdits"]>[0]["projectSummary"];
	}): Promise<ChatProposalResult> {
		const clauses = splitCompoundRequest(userText);
		const resolvedClauses = clauses.length > 0 ? clauses : [userText.trim()];
		const ops: TimelineDiffOp[] = [];
		const warnings: string[] = [];

		for (const clause of resolvedClauses) {
			const clauseOps = planClause({
				clause,
				projectSummary,
				warnings,
			});
			for (const op of clauseOps) {
				if (ops.length >= MAX_HEURISTIC_OPS) {
					warnings.push("Only the first 5 deterministic ops were kept.");
					break;
				}
				ops.push(op);
			}
			if (ops.length >= MAX_HEURISTIC_OPS) {
				break;
			}
		}

		return {
			ops,
			provider: "heuristic",
			fallbackUsed: false,
			warnings,
			rawText: null,
		};
	}
}

function planClause({
	clause,
	projectSummary,
	warnings,
}: {
	clause: string;
	projectSummary: ProjectSummary;
	warnings: string[];
}): TimelineDiffOp[] {
	const fixCaptionRequest = parseFixCaptionTextRequest({ text: clause });
	if (fixCaptionRequest) {
		const target = resolveCaptionReference({
			projectSummary,
			reference: fixCaptionRequest.reference,
			fromText: fixCaptionRequest.from,
		});
		if (target) {
			return [
				{
					type: "FIX_CAPTION_TEXT",
					segment_id: target.segment_id,
					from: fixCaptionRequest.from,
					to: fixCaptionRequest.to,
				},
			];
		}
		return warnUnsupportedClause({ clause, warnings });
	}

	const swapRequest = parseSwapSegmentsRequest({ text: clause });
	if (swapRequest) {
		const left = resolveSegmentReference({
			projectSummary,
			reference: swapRequest.aReference,
		});
		const right = resolveSegmentReference({
			projectSummary,
			reference: swapRequest.bReference,
		});
		if (left && right && left.segment_id !== right.segment_id) {
			return [
				{
					type: "SWAP_SEGMENTS",
					a_id: left.segment_id,
					b_id: right.segment_id,
				},
			];
		}
		return warnUnsupportedClause({ clause, warnings });
	}

	const moveRequest = parseMoveSegmentRequest({ text: clause });
	if (moveRequest) {
		const target = resolveSegmentReference({
			projectSummary,
			reference: moveRequest.reference,
		});
		if (target) {
			const toMs =
				moveRequest.absolute_to_ms ??
				Math.max(
					0,
					target.start_ms +
						(moveRequest.direction === "earlier"
							? -(moveRequest.relative_delta_ms ?? 0)
							: moveRequest.relative_delta_ms ?? 0),
				);
			return [
				{
					type: "MOVE_SEGMENT",
					segment_id: target.segment_id,
					to_ms: toMs,
				},
			];
		}
		return warnUnsupportedClause({ clause, warnings });
	}

	const trimRequest = parseTrimClipRequest({ text: clause });
	if (trimRequest) {
		const target = resolveSegmentReference({
			projectSummary,
			reference: trimRequest.reference,
		});
		if (target) {
			return [
				{
					type: "TRIM_CLIP",
					clip_id: target.segment_id,
					in_ms: trimRequest.edge === "start" ? trimRequest.amount_ms : 0,
					out_ms: trimRequest.edge === "end" ? trimRequest.amount_ms : 0,
				},
			];
		}
		return warnUnsupportedClause({ clause, warnings });
	}

	const deleteRequest = parseDeleteSegmentRequest({ text: clause });
	if (deleteRequest) {
		const target = resolveSegmentReference({
			projectSummary,
			reference: deleteRequest.reference,
		});
		if (target) {
			return [
				{
					type: "DELETE_SEGMENT",
					segment_id: target.segment_id,
				},
			];
		}
		return warnUnsupportedClause({ clause, warnings });
	}

	const duplicateRequest = parseDuplicateSegmentRequest({ text: clause });
	if (duplicateRequest) {
		const target = resolveSegmentReference({
			projectSummary,
			reference: duplicateRequest.reference,
		});
		if (target) {
			return [
				{
					type: "DUPLICATE_SEGMENT",
					segment_id: target.segment_id,
					to_ms: duplicateRequest.after_itself
						? target.end_ms
						: duplicateRequest.to_ms ?? target.end_ms,
				},
			];
		}
		return warnUnsupportedClause({ clause, warnings });
	}

	const legacyOps = planLegacyClause({ clause, projectSummary });
	if (legacyOps.length > 0) {
		return legacyOps;
	}

	warnings.push(`Skipped unsupported clause: "${clause}"`);
	return [];
}

function planLegacyClause({
	clause,
	projectSummary,
}: {
	clause: string;
	projectSummary: ProjectSummary;
}): TimelineDiffOp[] {
	const text = clause.toLowerCase();
	const ops: TimelineDiffOp[] = [];
	const timedBrollMatch =
		text.match(
			/(?:add|insert)\s+(?:a\s+)?b-?roll\s+using\s+(.+?)\s+from\s+(\d+(?:\.\d+)?)s?\s+to\s+(\d+(?:\.\d+)?)s?\b/,
		) ??
		text.match(
			/use\s+(.+?)\s+as\s+b-?roll\s+from\s+(\d+(?:\.\d+)?)s?\s+to\s+(\d+(?:\.\d+)?)s?\b/,
		);
	const phraseBrollRequest = parsePhraseBrollRequest({ text: clause });
	const textOverlayRequest = parseTextOverlayRequest({ text: clause });
	const phraseCutRequest = parsePhraseCutRequest({ text: clause });

	if (text.includes("remove more pause") || text.includes("remove pauses")) {
		ops.push({
			type: "REMOVE_SILENCE",
			threshold_ms: 0.32,
			pad_ms: 0.09,
			min_keep_ms: 0.45,
		});
	}

	const durationMatch =
		timedBrollMatch || phraseBrollRequest
			? null
			: text.match(/\b(\d+)\s?s(?:ec|econd)?s?\s+version\b/) ??
				text.match(/\bmake\s+(?:it\s+)?(\d+)\s?s(?:ec|econd)?s?\b/);
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
			duration_target_s: Math.max(
				5,
				Math.round(projectSummary.total_duration_s * 0.82),
			),
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

	if (textOverlayRequest) {
		const preset = getTextOverlayPresetForPosition({
			position: textOverlayRequest.position,
		});
		ops.push({
			type: "ADD_TEXT_OVERLAY",
			text: textOverlayRequest.text,
			start_ms: textOverlayRequest.start_ms,
			end_ms: textOverlayRequest.end_ms,
			position: textOverlayRequest.position,
			style_id: preset.style_id,
			font: preset.font,
			size: preset.size,
			color: preset.color,
			outline: preset.outline,
			background: preset.background,
		});
	}

	if (phraseCutRequest) {
		const window = resolvePhraseWindow({
			projectSummary,
			phrase: phraseCutRequest.phrase,
			occurrence: phraseCutRequest.occurrence,
		});
		if (window) {
			ops.push({
				type: "CUT_RANGE",
				start_ms: window.start_ms,
				end_ms: window.end_ms,
			});
		}
	}

	if (timedBrollMatch) {
		const [, rawAssetName, rawStartSeconds, rawEndSeconds] = timedBrollMatch;
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

	if (phraseBrollRequest) {
		const matchedAsset = resolveMediaAssetByName({
			query: phraseBrollRequest.assetName,
			mediaAssets: projectSummary.media_assets.map((asset) => ({
				id: asset.asset_id,
				name: asset.name,
			})),
		});
		const matches = findPhraseOccurrences({
			projectSummary,
			phrase: phraseBrollRequest.phrase,
		});
		const phraseMatch = matches.find(
			(match) => match.occurrence === phraseBrollRequest.occurrence,
		);
		const totalDurationMs = Math.round(projectSummary.total_duration_s * 1000);

		if (matchedAsset && phraseMatch) {
			const derivedDurationMs = Math.min(
				4000,
				Math.max(2000, phraseMatch.end_ms - phraseMatch.start_ms),
			);
			const durationMs = phraseBrollRequest.duration_ms ?? derivedDurationMs;
			const startMs = phraseMatch.start_ms;
			const endMs =
				totalDurationMs > 0
					? Math.min(totalDurationMs, startMs + durationMs)
					: startMs + durationMs;
			if (endMs > startMs) {
				ops.push({
					type: "INSERT_BROLL",
					media_id: matchedAsset.assetId,
					start_ms: startMs,
					end_ms: endMs,
					lane: "overlay-primary",
					fit_mode: "cover",
					mute: true,
				});
			}
		}
	}

	return ops;
}

function warnUnsupportedClause({
	clause,
	warnings,
}: {
	clause: string;
	warnings: string[];
}): TimelineDiffOp[] {
	warnings.push(`Skipped unsupported clause: "${clause}"`);
	return [];
}
