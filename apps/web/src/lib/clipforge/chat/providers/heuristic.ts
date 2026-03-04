import {
	findPhraseOccurrences,
	resolvePhraseWindow,
} from "@/lib/clipforge/phrase-resolution";
import { resolveMediaAssetByName } from "@/lib/clipforge/media-resolver";
import {
	createEmptyResolutionState,
	findImplicitCandidates,
	updateResolutionStateFromSegment,
	type ChatResolutionState,
} from "@/lib/clipforge/chat/context-resolution";
import {
	findCaptionReferenceCandidates,
	findSegmentReferenceCandidates,
	type SegmentReference,
	type SegmentReferenceTarget,
} from "@/lib/clipforge/segment-resolution";
import { buildClarificationRequest } from "@/lib/clipforge/chat/chat-clarification";
import { getTextOverlayPresetForPosition } from "@/lib/clipforge/text-overlay-presets";
import type { TimelineDiffOp } from "@/types/clipforge";
import { splitCompoundRequest } from "../compound-request";
import { buildReferenceLabel } from "../reference-label";
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
import type {
	ChatOpsProvider,
	ChatPlannerOverrides,
	ChatPlannerContext,
	ChatClarificationRequest,
	ChatProposalResult,
	ChatSegmentKind,
	ProjectSegmentSummary,
	ProjectSummary,
} from "../types";

const MAX_HEURISTIC_OPS = 5;

export class HeuristicChatOpsProvider implements ChatOpsProvider {
	async proposeEdits({
		userText,
		projectSummary,
		context,
		overrides,
	}: {
		userText: string;
		projectSummary: Parameters<ChatOpsProvider["proposeEdits"]>[0]["projectSummary"];
		context: Parameters<ChatOpsProvider["proposeEdits"]>[0]["context"];
		overrides?: Parameters<ChatOpsProvider["proposeEdits"]>[0]["overrides"];
	}): Promise<ChatProposalResult> {
		const clauses = splitCompoundRequest(userText);
		const resolvedClauses = clauses.length > 0 ? clauses : [userText.trim()];
		const ops: TimelineDiffOp[] = [];
		const warnings: string[] = [];
		let resolutionState = createEmptyResolutionState();
		const deletedSegmentIds = new Set<string>();

		for (const clause of resolvedClauses) {
			const clausePlan = planClause({
				clause,
				projectSummary,
				context,
				overrides,
				warnings,
				state: resolutionState,
				deletedSegmentIds,
			});
			if (clausePlan.clarification) {
				return {
					ops: [],
					provider: "heuristic",
					fallbackUsed: false,
					warnings,
					clarification: clausePlan.clarification,
					rawText: null,
				};
			}
			resolutionState = clausePlan.state;
			for (const op of clausePlan.ops) {
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
			clarification: null,
			rawText: null,
		};
	}
}

function planClause({
	clause,
	projectSummary,
	context,
	overrides,
	warnings,
	state,
	deletedSegmentIds,
}: {
	clause: string;
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	overrides?: ChatPlannerOverrides;
	warnings: string[];
	state: ChatResolutionState;
	deletedSegmentIds: Set<string>;
}): {
	ops: TimelineDiffOp[];
	state: ChatResolutionState;
	clarification: ChatClarificationRequest | null;
} {
	const fixCaptionRequest = parseFixCaptionTextRequest({ text: clause });
	if (fixCaptionRequest) {
		const target = resolveReference({
			projectSummary,
			context,
			overrides,
			state,
			reference: fixCaptionRequest.reference,
			allowedKinds: ["caption"],
			deletedSegmentIds,
			fromText:
				fixCaptionRequest.from.trim().length > 0 ? fixCaptionRequest.from : undefined,
		});
		if (target.segment) {
			return {
				ops: [
					{
						type: "FIX_CAPTION_TEXT",
						segment_id: target.segment.segment_id,
						from:
							fixCaptionRequest.from.trim().length > 0
								? fixCaptionRequest.from
								: target.segment.text_content,
						to: fixCaptionRequest.to,
					},
				],
				state: updateResolutionStateFromSegment(state, target.segment),
				clarification: null,
			};
		}
		if (target.clarification) {
			return { ops: [], state, clarification: target.clarification };
		}
		return warnUnsupportedClause({ clause, warnings, state });
	}

	const swapRequest = parseSwapSegmentsRequest({ text: clause });
	if (swapRequest) {
		const left = resolveReference({
			projectSummary,
			context,
			overrides,
			state,
			reference: swapRequest.aReference,
			allowedKinds: ["video"],
			deletedSegmentIds,
		});
		if (left.clarification) {
			return { ops: [], state, clarification: left.clarification };
		}
		const right = resolveReference({
			projectSummary,
			context,
			overrides,
			state: left.segment ? updateResolutionStateFromSegment(state, left.segment) : state,
			reference: swapRequest.bReference,
			allowedKinds: ["video"],
			deletedSegmentIds,
		});
		if (right.clarification) {
			return { ops: [], state, clarification: right.clarification };
		}
		if (
			left.segment &&
			right.segment &&
			left.segment.segment_id !== right.segment.segment_id
		) {
			return {
				ops: [
					{
						type: "SWAP_SEGMENTS",
						a_id: left.segment.segment_id,
						b_id: right.segment.segment_id,
					},
				],
				state: updateResolutionStateFromSegment(state, right.segment),
				clarification: null,
			};
		}
		return warnUnsupportedClause({ clause, warnings, state });
	}

	const moveRequest = parseMoveSegmentRequest({ text: clause });
	if (moveRequest) {
		const target = resolveReference({
			projectSummary,
			context,
			overrides,
			state,
			reference: moveRequest.reference,
			allowedKinds: ["video"],
			deletedSegmentIds,
		});
		if (target.segment) {
			const toMs =
				moveRequest.absolute_to_ms ??
				Math.max(
					0,
					target.segment.start_ms +
						(moveRequest.direction === "earlier"
							? -(moveRequest.relative_delta_ms ?? 0)
							: moveRequest.relative_delta_ms ?? 0),
				);
			return {
				ops: [
					{
						type: "MOVE_SEGMENT",
						segment_id: target.segment.segment_id,
						to_ms: toMs,
					},
				],
				state: updateResolutionStateFromSegment(state, target.segment),
				clarification: null,
			};
		}
		if (target.clarification) {
			return { ops: [], state, clarification: target.clarification };
		}
		return warnUnsupportedClause({ clause, warnings, state });
	}

	const trimRequest = parseTrimClipRequest({ text: clause });
	if (trimRequest) {
		const target = resolveReference({
			projectSummary,
			context,
			overrides,
			state,
			reference: trimRequest.reference,
			allowedKinds: ["video"],
			deletedSegmentIds,
		});
		if (target.segment) {
			return {
				ops: [
					{
						type: "TRIM_CLIP",
						clip_id: target.segment.segment_id,
						in_ms: trimRequest.edge === "start" ? trimRequest.amount_ms : 0,
						out_ms: trimRequest.edge === "end" ? trimRequest.amount_ms : 0,
					},
				],
				state: updateResolutionStateFromSegment(state, target.segment),
				clarification: null,
			};
		}
		if (target.clarification) {
			return { ops: [], state, clarification: target.clarification };
		}
		return warnUnsupportedClause({ clause, warnings, state });
	}

	const deleteRequest = parseDeleteSegmentRequest({ text: clause });
	if (deleteRequest) {
		const target = resolveReference({
			projectSummary,
			context,
			overrides,
			state,
			reference: deleteRequest.reference,
			allowedKinds: ["video"],
			deletedSegmentIds,
		});
		if (target.segment) {
			deletedSegmentIds.add(target.segment.segment_id);
			return {
				ops: [
					{
						type: "DELETE_SEGMENT",
						segment_id: target.segment.segment_id,
					},
				],
				state: updateResolutionStateFromSegment(state, target.segment),
				clarification: null,
			};
		}
		if (target.clarification) {
			return { ops: [], state, clarification: target.clarification };
		}
		return warnUnsupportedClause({ clause, warnings, state });
	}

	const duplicateRequest = parseDuplicateSegmentRequest({ text: clause });
	if (duplicateRequest) {
		const target = resolveReference({
			projectSummary,
			context,
			overrides,
			state,
			reference: duplicateRequest.reference,
			allowedKinds: ["video"],
			deletedSegmentIds,
		});
		if (target.segment) {
			return {
				ops: [
					{
						type: "DUPLICATE_SEGMENT",
						segment_id: target.segment.segment_id,
						to_ms: duplicateRequest.after_itself
							? target.segment.end_ms
							: duplicateRequest.to_ms ?? target.segment.end_ms,
					},
				],
				state: updateResolutionStateFromSegment(state, target.segment),
				clarification: null,
			};
		}
		if (target.clarification) {
			return { ops: [], state, clarification: target.clarification };
		}
		return warnUnsupportedClause({ clause, warnings, state });
	}

	const legacyPlan = planLegacyClause({
		clause,
		projectSummary,
		context,
		state,
	});
	if (legacyPlan.ops.length > 0) {
		return legacyPlan;
	}

	return warnUnsupportedClause({ clause, warnings, state });
}

function planLegacyClause({
	clause,
	projectSummary,
	context,
	state,
}: {
	clause: string;
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	state: ChatResolutionState;
}): {
	ops: TimelineDiffOp[];
	state: ChatResolutionState;
	clarification: ChatClarificationRequest | null;
} {
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
		const startMs =
			textOverlayRequest.anchor_mode === "playhead"
				? context.playhead_ms
				: textOverlayRequest.start_ms;
		ops.push({
			type: "ADD_TEXT_OVERLAY",
			text: textOverlayRequest.text,
			start_ms: startMs,
			end_ms: startMs + Math.max(250, textOverlayRequest.end_ms - textOverlayRequest.start_ms),
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

	return { ops, state, clarification: null };
}

function resolveReference({
	projectSummary,
	context,
	overrides,
	state,
	reference,
	allowedKinds,
	deletedSegmentIds,
	fromText,
}: {
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	overrides?: ChatPlannerOverrides;
	state: ChatResolutionState;
	reference: SegmentReference;
	allowedKinds: ChatSegmentKind[];
	deletedSegmentIds: Set<string>;
	fromText?: string;
}): {
	segment: ProjectSegmentSummary | null;
	clarification: ChatClarificationRequest | null;
} {
	if (!isReferenceCompatibleWithKinds(reference.target, allowedKinds)) {
		return { segment: null, clarification: null };
	}

	const referenceLabel = buildReferenceLabel({ reference, fromText });
	const forcedSegmentId =
		overrides?.forced_segment_ids_by_reference?.[referenceLabel] ?? null;
	if (forcedSegmentId) {
		const forced =
			projectSummary.segments.find(
				(segment) =>
					segment.segment_id === forcedSegmentId &&
					allowedKinds.includes(segment.segment_kind) &&
					!deletedSegmentIds.has(segment.segment_id),
			) ?? null;
		return {
			segment: forced,
			clarification: null,
		};
	}

	let candidates: ProjectSegmentSummary[] = [];

	if (!reference.mode || reference.mode === "explicit") {
		candidates =
			allowedKinds.includes("caption") && reference.target === "caption"
				? findCaptionReferenceCandidates({
						projectSummary,
						reference,
						fromText,
					})
				: findSegmentReferenceCandidates({
						projectSummary,
						reference,
					});
	} else {
		candidates = findImplicitCandidates({
			projectSummary,
			context,
			state,
			allowedKinds,
			token: reference.mode,
		});
	}

	candidates = candidates.filter(
		(segment) =>
			allowedKinds.includes(segment.segment_kind) &&
			!deletedSegmentIds.has(segment.segment_id),
	);
	if (candidates.length === 0) {
		return { segment: null, clarification: null };
	}
	if (candidates.length === 1) {
		return {
			segment: candidates[0],
			clarification: null,
		};
	}
	return {
		segment: null,
		clarification: buildClarificationRequest({
			referenceLabel,
			candidates,
		}),
	};
}

function isReferenceCompatibleWithKinds(
	target: SegmentReferenceTarget,
	allowedKinds: ChatSegmentKind[],
): boolean {
	if (target === "clip" || target === "segment") {
		return allowedKinds.includes("video");
	}
	if (target === "caption") {
		return allowedKinds.includes("caption");
	}
	if (target === "text" || target === "overlay") {
		return allowedKinds.includes("text-overlay");
	}
	return false;
}

function warnUnsupportedClause({
	clause,
	warnings,
	state,
}: {
	clause: string;
	warnings: string[];
	state: ChatResolutionState;
}): {
	ops: TimelineDiffOp[];
	state: ChatResolutionState;
	clarification: ChatClarificationRequest | null;
} {
	warnings.push(`Skipped unsupported clause: "${clause}"`);
	return {
		ops: [],
		state,
		clarification: null,
	};
}
