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
import {
	buildChoiceClarificationRequest,
	buildClarificationRequest,
} from "@/lib/clipforge/chat/chat-clarification";
import { BUILT_IN_CAPTION_STYLE_MAP } from "@/lib/clipforge/caption-style-library";
import { getTextOverlayPresetForPosition } from "@/lib/clipforge/text-overlay-presets";
import type { ClipForgeEditorCommand, TimelineDiffOp } from "@/types/clipforge";
import { wrapTimelineOpsAsCommands } from "../command-plan";
import { splitCompoundRequest } from "../compound-request";
import { buildReferenceLabel } from "../reference-label";
import {
	parseDeleteSegmentRequest,
	parseDuplicateSegmentRequest,
	parseFixCaptionTextRequest,
	parseMoveSegmentRequest,
	parsePhraseBrollRequest,
	parsePhraseCutRequest,
	parseSegmentReferenceText,
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

const MAX_HEURISTIC_COMMANDS = 8;

interface DirectPlanResult {
	ops: TimelineDiffOp[];
	commands: ClipForgeEditorCommand[];
	state: ChatResolutionState;
	clarification: ChatClarificationRequest | null;
}

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
		const commands: ClipForgeEditorCommand[] = [];
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
					commands: [],
					ops: [],
					provider: "heuristic",
					fallbackUsed: false,
					warnings,
					clarification: clausePlan.clarification,
					rawText: null,
				};
			}
			resolutionState = clausePlan.state;
			const clauseCommands = [
				...(clausePlan.commands ?? []),
				...wrapTimelineOpsAsCommands(clausePlan.ops),
			];
			for (const command of clauseCommands) {
				if (commands.length >= MAX_HEURISTIC_COMMANDS) {
					warnings.push("Only the first 8 deterministic commands were kept.");
					break;
				}
				commands.push(command);
				if (command.kind === "timeline-op") {
					ops.push(command.op);
				}
			}
			if (commands.length >= MAX_HEURISTIC_COMMANDS) {
				break;
			}
		}

		return {
			commands,
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
	commands?: ClipForgeEditorCommand[];
	state: ChatResolutionState;
	clarification: ChatClarificationRequest | null;
} {
	const directPlan = planDirectCommandClause({
		clause,
		projectSummary,
		context,
		overrides,
		state,
		deletedSegmentIds,
	});
	if (directPlan.clarification || directPlan.commands.length > 0 || directPlan.ops.length > 0) {
		return directPlan;
	}

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
				commands: [],
				state: updateResolutionStateFromSegment(state, target.segment),
				clarification: null,
			};
		}
		if (target.clarification) {
			return { ops: [], commands: [], state, clarification: target.clarification };
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
			return { ops: [], commands: [], state, clarification: left.clarification };
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
			return { ops: [], commands: [], state, clarification: right.clarification };
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
				commands: [],
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
				commands: [],
				state: updateResolutionStateFromSegment(state, target.segment),
				clarification: null,
			};
		}
		if (target.clarification) {
			return { ops: [], commands: [], state, clarification: target.clarification };
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
				commands: [],
				state: updateResolutionStateFromSegment(state, target.segment),
				clarification: null,
			};
		}
		if (target.clarification) {
			return { ops: [], commands: [], state, clarification: target.clarification };
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
				commands: [],
				state: updateResolutionStateFromSegment(state, target.segment),
				clarification: null,
			};
		}
		if (target.clarification) {
			return { ops: [], commands: [], state, clarification: target.clarification };
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
				commands: [],
				state: updateResolutionStateFromSegment(state, target.segment),
				clarification: null,
			};
		}
		if (target.clarification) {
			return { ops: [], commands: [], state, clarification: target.clarification };
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
	commands?: ClipForgeEditorCommand[];
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

function planDirectCommandClause({
	clause,
	projectSummary,
	context,
	overrides,
	state,
	deletedSegmentIds,
}: {
	clause: string;
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	overrides?: ChatPlannerOverrides;
	state: ChatResolutionState;
	deletedSegmentIds: Set<string>;
}): DirectPlanResult {
	const planners = [
		planRepeatCommandClause,
		planClipSpeedClause,
		planTransitionClause,
		planAudioMixClause,
		planCaptionToneClause,
		planSeparateAudioClause,
		planFreezeFrameClause,
		planFinishingLookClause,
		planEffectClause,
		planOverlayPresetClause,
		planOverlayStyleClause,
		planMotionPresetClause,
		planSoundSyncClause,
		planProjectKitClause,
		planVersionPackClause,
		planAutoReframeClause,
	] as const;

	for (const planner of planners) {
		const result = planner({
			clause,
			projectSummary,
			context,
			overrides,
			state,
			deletedSegmentIds,
		});
		if (result.clarification || result.commands.length > 0 || result.ops.length > 0) {
			return result;
		}
	}

	return {
		ops: [],
		commands: [],
		state,
		clarification: null,
	};
}

function planRepeatCommandClause(args: DirectPlannerArgs): DirectPlanResult {
	const normalized = args.clause.toLowerCase();
	if (!/\b(?:do that|do the same|same thing)\b/.test(normalized)) {
		return emptyDirectPlan({ state: args.state });
	}

	const lastTurn = args.projectSummary.recent_turn_summaries?.[0] ?? "";
	const lastAction = args.projectSummary.recent_ai_actions?.[0] ?? null;
	const nextCount = parseRelativeCount({ text: normalized });
	const nextTargets = resolveNextVideoTargets({
		projectSummary: args.projectSummary,
		context: args.context,
		state: args.state,
		count: nextCount,
			recentAction: lastAction,
		});
	if (nextTargets.length === 0) {
		return emptyDirectPlan({ state: args.state });
	}

	if (lastAction?.kind === "set-transition-in" || /\btransition\b/.test(lastTurn)) {
		return {
			ops: [],
			commands: [
				{
					kind: "set-transition-in",
					target_segment_ids: nextTargets.map((segment) => segment.segment_id),
					preset: inferTransitionPreset({ text: lastTurn }) ?? "cross-dissolve",
					duration_ms: inferTransitionDurationMs({ text: lastTurn }),
					scope: "scene",
				},
			],
			state: updateResolutionStateFromSegment(
				args.state,
				nextTargets.at(-1) ?? nextTargets[0],
			),
			clarification: null,
		};
	}

	if (lastAction?.kind === "set-clip-speed" || /\b(speed up|slow down|faster|slower)\b/.test(lastTurn)) {
		const playbackRate = inferPlaybackRateFromText({ text: lastTurn }) ?? 1.15;
		return {
			ops: [],
			commands: [
				{
					kind: "set-clip-speed",
					target_segment_ids: nextTargets.map((segment) => segment.segment_id),
					playback_rate: playbackRate,
					ripple: true,
					scope: "scene",
				},
			],
			state: updateResolutionStateFromSegment(
				args.state,
				nextTargets.at(-1) ?? nextTargets[0],
			),
			clarification: null,
		};
	}

	return emptyDirectPlan({ state: args.state });
}

function planClipSpeedClause(args: DirectPlannerArgs): DirectPlanResult {
	const match =
		args.clause.match(
			/^(?:speed up|make faster)\s+(.+?)\s+(?:by\s+)?(\d+(?:\.\d+)?)%$/i,
		) ??
		args.clause.match(
			/^(?:slow down|make slower)\s+(.+?)\s+(?:by\s+)?(\d+(?:\.\d+)?)%$/i,
		);
	if (!match) {
		return emptyDirectPlan({ state: args.state });
	}

	const target = resolveVideoReferenceFromText({
		rawReference: match[1],
		projectSummary: args.projectSummary,
		context: args.context,
		overrides: args.overrides,
		state: args.state,
		deletedSegmentIds: args.deletedSegmentIds,
	});
	if (target.clarification) {
		return { ...emptyDirectPlan({ state: args.state }), clarification: target.clarification };
	}
	if (!target.segment) {
		return emptyDirectPlan({ state: args.state });
	}

	const amount = Number(match[2]);
	const isSlow = /^slow down|^make slower/i.test(args.clause);
	return {
		ops: [],
		commands: [
			{
				kind: "set-clip-speed",
				target_segment_ids: [target.segment.segment_id],
				playback_rate: Number(
					Math.max(0.25, isSlow ? 1 - amount / 100 : 1 + amount / 100).toFixed(3),
				),
				ripple: true,
				scope: "selection",
			},
		],
		state: updateResolutionStateFromSegment(args.state, target.segment),
		clarification: null,
	};
}

function planTransitionClause(args: DirectPlannerArgs): DirectPlanResult {
	const normalized = args.clause.toLowerCase();
	if (!normalized.includes("transition")) {
		return emptyDirectPlan({ state: args.state });
	}

	const referenceLabel = "preset:transition";
	const forcedPreset = args.overrides?.forced_choice_values_by_reference?.[referenceLabel] ?? null;
	const inferredPreset = inferTransitionPreset({ text: normalized }) ?? forcedPreset;
	if (!inferredPreset) {
		return {
			ops: [],
			commands: [],
			state: args.state,
			clarification: buildChoiceClarificationRequest({
				kind: "preset",
				prompt: "Choose a transition style to continue.",
				referenceLabel,
				options: [
					{
						value: "cross-dissolve",
						label: "Subtle Cross Dissolve",
						text_preview: "Smooth and understated.",
					},
					{
						value: "fade-black",
						label: "Fade To Black",
						text_preview: "Harder tonal reset.",
					},
					{
						value: "fade-white",
						label: "Fade To White",
						text_preview: "Brighter flash-style reset.",
					},
					{
						value: "slide",
						label: "Slide",
						text_preview: "More energetic movement.",
					},
				],
			}),
		};
	}

	let targets: ProjectSegmentSummary[] = [];
	if (/\bnext (?:shot|clip|cut)\b/.test(normalized)) {
		targets = resolveNextVideoTargets({
			projectSummary: args.projectSummary,
			context: args.context,
			state: args.state,
			count: parseRelativeCount({ text: normalized }),
			recentAction: args.projectSummary.recent_ai_actions?.[0] ?? null,
		});
	} else {
		const explicitTargetMatch = args.clause.match(
			/\b(?:into|on|to)\s+(.+)$/i,
		);
		const target = resolveVideoReferenceFromText({
			rawReference: explicitTargetMatch?.[1] ?? "this clip",
			projectSummary: args.projectSummary,
			context: args.context,
			overrides: args.overrides,
			state: args.state,
			deletedSegmentIds: args.deletedSegmentIds,
		});
		if (target.clarification) {
			return { ...emptyDirectPlan({ state: args.state }), clarification: target.clarification };
		}
		targets = target.segment ? [target.segment] : [];
	}

	if (targets.length === 0) {
		return emptyDirectPlan({ state: args.state });
	}

	return {
		ops: [],
		commands: [
				{
					kind: "set-transition-in",
					target_segment_ids: targets.map((segment) => segment.segment_id),
					preset: inferredPreset as "cross-dissolve" | "fade-black" | "fade-white" | "slide",
					duration_ms: inferTransitionDurationMs({ text: normalized }),
					scope: "scene",
				},
		],
		state: updateResolutionStateFromSegment(args.state, targets.at(-1) ?? targets[0]),
		clarification: null,
	};
}

function planAudioMixClause(args: DirectPlannerArgs): DirectPlanResult {
	const normalized = args.clause.toLowerCase();
	if (!/\bduck\b.*\bmusic\b|\bmusic\b.*\bduck\b/.test(normalized)) {
		return emptyDirectPlan({ state: args.state });
	}

	const currentAmount = args.projectSummary.audio_mix?.duckingAmount ?? 0.45;
	const amountMatch = normalized.match(/(\d+(?:\.\d+)?)%/);
	const nextAmount = amountMatch
		? Math.max(0, Math.min(1, Number(amountMatch[1]) / 100))
		: normalized.includes("more")
			? Math.min(1, currentAmount + 0.1)
			: Math.max(currentAmount, 0.55);

	return {
		ops: [],
		commands: [
			{
				kind: "set-audio-mix",
				settings: {
					duckingEnabled: true,
					duckingAmount: Number(nextAmount.toFixed(2)),
				},
				scope: "project",
			},
		],
		state: args.state,
		clarification: null,
	};
}

function planCaptionToneClause(args: DirectPlannerArgs): DirectPlanResult {
	const normalized = args.clause.toLowerCase();
	if (!/\bcaptions?\b/.test(normalized)) {
		return emptyDirectPlan({ state: args.state });
	}

	const styleId = normalized.includes("soft") ||
			normalized.includes("clean") ||
			normalized.includes("minimal")
		? "clean-bottom"
		: normalized.includes("bold") || normalized.includes("punch") || normalized.includes("loud")
			? "bold-center"
			: null;
	if (!styleId) {
		return emptyDirectPlan({ state: args.state });
	}

	const template = BUILT_IN_CAPTION_STYLE_MAP[styleId];
	if (!template) {
		return emptyDirectPlan({ state: args.state });
	}

	return {
		ops: [
			{
				type: "SET_CAPTION_STYLE",
				style_id: template.style_id,
				font: template.font,
				size: template.size,
				position: template.position,
				outline: template.outline,
				highlight_mode: template.highlight_mode,
			},
		],
		commands: [],
		state: args.state,
		clarification: null,
	};
}

function planSeparateAudioClause(args: DirectPlannerArgs): DirectPlanResult {
	const match = args.clause.match(
		/^(?:separate|detach|split)\s+(?:the\s+)?audio(?:\s+from)?(?:\s+(.+))?$/i,
	);
	if (!match) {
		return emptyDirectPlan({ state: args.state });
	}

	const target = resolveVideoReferenceFromText({
		rawReference: match[1] ?? "this clip",
		projectSummary: args.projectSummary,
		context: args.context,
		overrides: args.overrides,
		state: args.state,
		deletedSegmentIds: args.deletedSegmentIds,
	});
	if (target.clarification) {
		return { ...emptyDirectPlan({ state: args.state }), clarification: target.clarification };
	}
	if (!target.segment) {
		return emptyDirectPlan({ state: args.state });
	}

	return {
		ops: [],
		commands: [
			{
				kind: "separate-audio",
				target_segment_ids: [target.segment.segment_id],
				scope: "selection",
			},
		],
		state: updateResolutionStateFromSegment(args.state, target.segment),
		clarification: null,
	};
}

function planFreezeFrameClause(args: DirectPlannerArgs): DirectPlanResult {
	const match = args.clause.match(
		/^(?:freeze|add(?:\s+a)?\s+freeze frame(?:\s+on)?)\s+(.+?)(?:\s+for\s+(\d+(?:\.\d+)?)s?)?$/i,
	);
	if (!match) {
		return emptyDirectPlan({ state: args.state });
	}

	const target = resolveVideoReferenceFromText({
		rawReference: match[1],
		projectSummary: args.projectSummary,
		context: args.context,
		overrides: args.overrides,
		state: args.state,
		deletedSegmentIds: args.deletedSegmentIds,
	});
	if (target.clarification) {
		return { ...emptyDirectPlan({ state: args.state }), clarification: target.clarification };
	}
	if (!target.segment) {
		return emptyDirectPlan({ state: args.state });
	}

	const atMs =
		args.context.playhead_ms >= target.segment.start_ms &&
		args.context.playhead_ms <= target.segment.end_ms
			? args.context.playhead_ms
			: Math.round((target.segment.start_ms + target.segment.end_ms) / 2);

	return {
		ops: [],
		commands: [
			{
				kind: "insert-freeze-frame",
				target_segment_id: target.segment.segment_id,
				at_ms: atMs,
				duration_ms: Math.round(Number(match[2] ?? "0.6") * 1000),
				ripple: true,
				scope: "selection",
			},
		],
		state: updateResolutionStateFromSegment(args.state, target.segment),
		clarification: null,
	};
}

function planFinishingLookClause(args: DirectPlannerArgs): DirectPlanResult {
	const look = inferFinishingLook({ text: args.clause });
	if (!look) {
		return emptyDirectPlan({ state: args.state });
	}

	const target = resolveVideoReferenceFromText({
		rawReference: extractReferenceSuffix({ clause: args.clause }) ?? "this clip",
		projectSummary: args.projectSummary,
		context: args.context,
		overrides: args.overrides,
		state: args.state,
		deletedSegmentIds: args.deletedSegmentIds,
	});
	if (target.clarification) {
		return { ...emptyDirectPlan({ state: args.state }), clarification: target.clarification };
	}
	if (!target.segment) {
		return emptyDirectPlan({ state: args.state });
	}

	return {
		ops: [],
		commands: [
			{
				kind: "apply-finishing-look",
				target_segment_ids: [target.segment.segment_id],
				preset_id: look,
				scope: "selection",
			},
		],
		state: updateResolutionStateFromSegment(args.state, target.segment),
		clarification: null,
	};
}

function planEffectClause(args: DirectPlannerArgs): DirectPlanResult {
	const effectKind = inferEffectKind({ text: args.clause });
	if (!effectKind) {
		return emptyDirectPlan({ state: args.state });
	}

	const target = resolveVideoReferenceFromText({
		rawReference: extractReferenceSuffix({ clause: args.clause }) ?? "this clip",
		projectSummary: args.projectSummary,
		context: args.context,
		overrides: args.overrides,
		state: args.state,
		deletedSegmentIds: args.deletedSegmentIds,
	});
	if (target.clarification) {
		return { ...emptyDirectPlan({ state: args.state }), clarification: target.clarification };
	}
	if (!target.segment) {
		return emptyDirectPlan({ state: args.state });
	}

	return {
		ops: [],
		commands: [
			{
				kind: "apply-effect-preset",
				target_segment_ids: [target.segment.segment_id],
				effect_kind: effectKind,
				scope: "selection",
			},
		],
		state: updateResolutionStateFromSegment(args.state, target.segment),
		clarification: null,
	};
}

function planOverlayPresetClause(args: DirectPlannerArgs): DirectPlanResult {
	const presetId = inferOverlayPresetId({ text: args.clause });
	if (!presetId) {
		return emptyDirectPlan({ state: args.state });
	}

	const durationMatch = args.clause.match(/\bfor\s+(\d+(?:\.\d+)?)s?\b/i);
	return {
		ops: [],
		commands: [
			{
				kind: "insert-overlay-preset",
				preset_id: presetId,
				variant_id: inferOverlayStyleVariant({ text: args.clause }) ?? null,
				motion_preset_id: inferMotionPreset({ text: args.clause }) ?? null,
				start_ms: args.context.playhead_ms,
				duration_ms: Math.round(Number(durationMatch?.[1] ?? "2.5") * 1000),
				scope: "scene",
			},
		],
		state: args.state,
		clarification: null,
	};
}

function planOverlayStyleClause(args: DirectPlannerArgs): DirectPlanResult {
	const variantId = inferOverlayStyleVariant({ text: args.clause });
	if (!variantId || !/\boverlays?\b|\bgraphics?\b/.test(args.clause.toLowerCase())) {
		return emptyDirectPlan({ state: args.state });
	}

	const selectedOverlayIds = (args.projectSummary.selection?.selected_segments ?? [])
		.filter((segment) => segment.segment_kind === "text-overlay")
		.map((segment) => segment.segment_id);
	const sceneOverlayIds = (args.projectSummary.current_scene_segments ?? args.projectSummary.segments)
		.filter((segment) => segment.segment_kind === "text-overlay")
		.map((segment) => segment.segment_id);
	const scope = resolveRequestedScope({
		clause: args.clause,
		referenceLabel: "scope:overlay-style",
		overrides: args.overrides,
		selectedIds: selectedOverlayIds,
		sceneIds: sceneOverlayIds,
	});
	if (scope.clarification) {
		return { ...emptyDirectPlan({ state: args.state }), clarification: scope.clarification };
	}

	const targetIds =
		scope.value === "selection" && selectedOverlayIds.length > 0
			? selectedOverlayIds
			: sceneOverlayIds;
	if (targetIds.length === 0) {
		return emptyDirectPlan({ state: args.state });
	}

	return {
		ops: [],
		commands: [
				{
					kind: "apply-overlay-style",
					target_element_ids: targetIds,
					variant_id: variantId,
					scope: (scope.value ?? "scene") as "selection" | "scene" | "project",
				},
			],
		state: args.state,
		clarification: null,
	};
}

function planMotionPresetClause(args: DirectPlannerArgs): DirectPlanResult {
	const motionPreset = inferMotionPreset({ text: args.clause });
	if (!motionPreset || !/\boverlays?\b|\bgraphics?\b/.test(args.clause.toLowerCase())) {
		return emptyDirectPlan({ state: args.state });
	}

	const selectedOverlayIds = (args.projectSummary.selection?.selected_segments ?? [])
		.filter((segment) => segment.segment_kind === "text-overlay")
		.map((segment) => segment.segment_id);
	const sceneOverlayIds = (args.projectSummary.current_scene_segments ?? args.projectSummary.segments)
		.filter((segment) => segment.segment_kind === "text-overlay")
		.map((segment) => segment.segment_id);
	const targetIds = selectedOverlayIds.length > 0 ? selectedOverlayIds : sceneOverlayIds;
	if (targetIds.length === 0) {
		return emptyDirectPlan({ state: args.state });
	}

	return {
		ops: [],
		commands: [
			{
				kind: "apply-motion-preset",
				target_element_ids: targetIds,
				motion_preset_id: motionPreset,
				scope: selectedOverlayIds.length > 0 ? "selection" : "scene",
			},
		],
		state: args.state,
		clarification: null,
	};
}

function planSoundSyncClause(args: DirectPlannerArgs): DirectPlanResult {
	const pairingId = inferSoundSyncPreset({ text: args.clause });
	if (!pairingId) {
		return emptyDirectPlan({ state: args.state });
	}

	const targetKind = /\bcaptions?\b/.test(args.clause.toLowerCase()) ? "caption" : "text-overlay";
	const targetIds = (args.projectSummary.current_scene_segments ?? args.projectSummary.segments)
		.filter((segment) => segment.segment_kind === targetKind)
		.map((segment) => segment.segment_id);
	if (targetIds.length === 0) {
		return emptyDirectPlan({ state: args.state });
	}

	return {
		ops: [],
		commands: [
			{
				kind: "apply-sound-sync",
				target_element_ids: targetIds,
				pairing_id: pairingId,
				scope: "scene",
			},
		],
		state: args.state,
		clarification: null,
	};
}

function planProjectKitClause(args: DirectPlannerArgs): DirectPlanResult {
	const match = args.clause.match(/^(?:apply|use)\s+(.+?)\s+(?:project\s+)?kit$/i);
	if (!match) {
		return emptyDirectPlan({ state: args.state });
	}

	const query = match[1].trim().toLowerCase();
	const overrideLabel = `preset:project-kit:${query}`;
	const forcedKitId =
		args.overrides?.forced_choice_values_by_reference?.[overrideLabel] ?? null;
	if (forcedKitId) {
		return {
			ops: [],
			commands: [
				{
					kind: "apply-project-kit",
					kit_id: forcedKitId,
					scope: "project",
				},
			],
			state: args.state,
			clarification: null,
		};
	}

	const candidates = (args.projectSummary.available_project_kits ?? []).filter((template) =>
		template.name.toLowerCase().includes(query),
	);
	if (candidates.length === 0) {
		return emptyDirectPlan({ state: args.state });
	}
	if (candidates.length > 1) {
		return {
			ops: [],
			commands: [],
			state: args.state,
			clarification: buildChoiceClarificationRequest({
				kind: "preset",
				prompt: "Multiple project kits match. Choose one to continue.",
				referenceLabel: overrideLabel,
				options: candidates.map((candidate) => ({
					value: candidate.id,
					label: candidate.name,
					text_preview: "Apply project styling, defaults, and packaging.",
				})),
			}),
		};
	}

	const chosenId = candidates[0]?.id;
	if (!chosenId) {
		return emptyDirectPlan({ state: args.state });
	}

	return {
		ops: [],
		commands: [
			{
				kind: "apply-project-kit",
				kit_id: chosenId,
				scope: "project",
			},
		],
		state: args.state,
		clarification: null,
	};
}

function planVersionPackClause(args: DirectPlannerArgs): DirectPlanResult {
	const targets = extractVersionTargets({ text: args.clause });
	if (
		targets.length === 0 ||
		!/\bversion\b|\bversions\b|\btargets?\b|\bformats?\b/.test(args.clause.toLowerCase())
	) {
		return emptyDirectPlan({ state: args.state });
	}

	return {
		ops: [],
		commands: [
			{
				kind: "set-version-pack",
				target_ids: targets,
				active_target_id: targets[0] ?? null,
				scope: "project",
			},
		],
		state: args.state,
		clarification: null,
	};
}

function planAutoReframeClause(args: DirectPlannerArgs): DirectPlanResult {
	const normalized = args.clause.toLowerCase();
	if (!/\breframe\b/.test(normalized)) {
		return emptyDirectPlan({ state: args.state });
	}

	const targets = extractVersionTargets({ text: normalized });
	const chosenTarget =
		targets[0] ??
		args.overrides?.forced_choice_values_by_reference?.["version-target:auto-reframe"] ??
		null;
	if (!chosenTarget) {
		const versionTargets =
			args.projectSummary.version_pack?.targets
				.filter((target) => target.enabled)
				.map((target) => target.id) ?? ["9:16", "1:1", "16:9"];
		return {
			ops: [],
			commands: [],
			state: args.state,
			clarification: buildChoiceClarificationRequest({
				kind: "version-target",
				prompt: "Choose a version target for auto reframe.",
				referenceLabel: "version-target:auto-reframe",
				options: versionTargets.map((targetId) => ({
					value: targetId,
					label: targetId,
					text_preview: `Auto reframe the selection for ${targetId}.`,
				})),
			}),
		};
	}

	return {
		ops: [],
		commands: [
			{
				kind: "auto-reframe-selection",
				target_version_id: chosenTarget as "9:16" | "1:1" | "16:9",
				scope: "selection",
			},
		],
		state: args.state,
		clarification: null,
	};
}

interface DirectPlannerArgs {
	clause: string;
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	overrides?: ChatPlannerOverrides;
	state: ChatResolutionState;
	deletedSegmentIds: Set<string>;
}

function emptyDirectPlan({
	state,
}: {
	state: ChatResolutionState;
}): DirectPlanResult {
	return {
		ops: [],
		commands: [],
		state,
		clarification: null,
	};
}

function resolveVideoReferenceFromText({
	rawReference,
	projectSummary,
	context,
	overrides,
	state,
	deletedSegmentIds,
}: {
	rawReference: string;
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	overrides?: ChatPlannerOverrides;
	state: ChatResolutionState;
	deletedSegmentIds: Set<string>;
}) {
	const normalized = rawReference.trim().toLowerCase();
	if (
		normalized === "opener" ||
		normalized === "the opener" ||
		normalized === "opening shot" ||
		normalized === "the opening shot" ||
		normalized === "hook"
	) {
		const opener = getCurrentSceneVideos({ projectSummary })[0] ?? null;
		return { segment: opener, clarification: null };
	}

	const reference = parseSegmentReferenceText({ text: rawReference });
	if (!reference) {
		return { segment: null, clarification: null };
	}

	return resolveReference({
		projectSummary,
		context,
		overrides,
		state,
		reference,
		allowedKinds: ["video"],
		deletedSegmentIds,
	});
}

function getCurrentSceneVideos({
	projectSummary,
}: {
	projectSummary: ProjectSummary;
}) {
	return (projectSummary.current_scene_segments ?? projectSummary.segments)
		.filter((segment) => segment.segment_kind === "video")
		.sort((left, right) => left.start_ms - right.start_ms);
}

function resolveNextVideoTargets({
	projectSummary,
	context,
	state,
	count,
	recentAction,
}: {
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	state: ChatResolutionState;
	count: number;
	recentAction:
		| ProjectSummary["recent_ai_actions"][number]
		| null;
}) {
	const videos = getCurrentSceneVideos({ projectSummary });
	if (videos.length === 0) {
		return [];
	}
	const anchorId =
		recentAction?.targetSegmentIds[0] ??
		state.lastResolvedSegmentId ??
		context.selected_segment_ids[0] ??
		(projectSummary.playhead_neighborhood?.nearby_segments ?? []).find(
			(segment) => segment.segment_kind === "video",
		)?.segment_id ??
		null;
	const anchorIndex = anchorId
		? videos.findIndex((segment) => segment.segment_id === anchorId)
		: -1;
	const startIndex = anchorIndex >= 0 ? anchorIndex + 1 : 0;
	return videos.slice(startIndex, startIndex + Math.max(1, count));
}

function parseRelativeCount({ text }: { text: string }) {
	if (/\bnext three\b|\bnext 3\b/.test(text)) return 3;
	if (/\bnext two\b|\bnext 2\b/.test(text)) return 2;
	return 1;
}

function inferPlaybackRateFromText({ text }: { text: string }) {
	const normalized = text.toLowerCase();
	const appliedMatch = normalized.match(/set clip speed to\s+(\d+(?:\.\d+)?)%/);
	if (appliedMatch) {
		return Number((Number(appliedMatch[1]) / 100).toFixed(3));
	}
	const promptMatch = normalized.match(/(\d+(?:\.\d+)?)%/);
	if (!promptMatch) {
		return null;
	}
	const amount = Number(promptMatch[1]);
	if (!Number.isFinite(amount) || amount <= 0) {
		return null;
	}
	const isSlow = /\bslow down\b|\bmake slower\b/.test(normalized);
	return Number((isSlow ? 1 - amount / 100 : 1 + amount / 100).toFixed(3));
}

function inferTransitionPreset({
	text,
}: {
	text: string;
}) {
	const normalized = text.toLowerCase();
	if (normalized.includes("fade black") || normalized.includes("to black")) {
		return "fade-black" as const;
	}
	if (normalized.includes("fade white") || normalized.includes("to white")) {
		return "fade-white" as const;
	}
	if (normalized.includes("slide")) {
		return "slide" as const;
	}
	if (normalized.includes("subtle") || normalized.includes("smooth") || normalized.includes("soft")) {
		return "cross-dissolve" as const;
	}
	return null;
}

function inferTransitionDurationMs({ text }: { text: string }) {
	const normalized = text.toLowerCase();
	const explicit = normalized.match(/(\d+(?:\.\d+)?)s/);
	if (explicit) {
		return Math.round(Number(explicit[1]) * 1000);
	}
	if (normalized.includes("subtle") || normalized.includes("soft")) {
		return 300;
	}
	if (normalized.includes("bold") || normalized.includes("dramatic")) {
		return 550;
	}
	return 400;
}

function inferFinishingLook({ text }: { text: string }) {
	const normalized = text.toLowerCase();
	if (!/\blook\b|\bgrade\b|\bcolor\b|\bfinishing\b/.test(normalized)) {
		return null;
	}
	if (normalized.includes("warm")) return "warm" as const;
	if (normalized.includes("cool")) return "cool" as const;
	if (normalized.includes("dramatic")) return "dramatic" as const;
	if (normalized.includes("mono") || normalized.includes("black and white")) return "mono" as const;
	if (normalized.includes("vintage")) return "vintage" as const;
	if (normalized.includes("clean")) return "clean" as const;
	return null;
}

function inferEffectKind({ text }: { text: string }) {
	const normalized = text.toLowerCase();
	if (!/\beffect\b|\bblur\b|\bvignette\b|\bsharpen\b/.test(normalized)) {
		return null;
	}
	if (normalized.includes("blur")) return "blur" as const;
	if (normalized.includes("vignette")) return "vignette" as const;
	if (normalized.includes("sharpen")) return "sharpen" as const;
	return null;
}

function inferOverlayPresetId({ text }: { text: string }) {
	const normalized = text.toLowerCase();
	if (normalized.includes("timestamp")) return "timestamp-card" as const;
	if (normalized.includes("routine label")) return "routine-label" as const;
	if (normalized.includes("location tag")) return "location-tag" as const;
	if (normalized.includes("chapter card")) return "chapter-card" as const;
	if (normalized.includes("stat card")) return "stat-card" as const;
	if (normalized.includes("quote card")) return "quote-card-social" as const;
	return null;
}

function inferOverlayStyleVariant({ text }: { text: string }) {
	const normalized = text.toLowerCase();
	if (normalized.includes("clean vlog") || normalized.includes("clean")) return "clean-vlog" as const;
	if (normalized.includes("bold social") || normalized.includes("bold")) return "bold-social" as const;
	if (normalized.includes("luxury")) return "luxury" as const;
	if (normalized.includes("minimal")) return "minimal" as const;
	return null;
}

function inferMotionPreset({ text }: { text: string }) {
	const normalized = text.toLowerCase();
	if (normalized.includes("fade up")) return "fade-up" as const;
	if (normalized.includes("slide up")) return "slide-up" as const;
	if (normalized.includes("pop in")) return "pop-in" as const;
	if (normalized.includes("drift in")) return "drift-in" as const;
	if (normalized.includes("no motion")) return "none" as const;
	return null;
}

function inferSoundSyncPreset({ text }: { text: string }) {
	const normalized = text.toLowerCase();
	if (normalized.includes("typing clean")) return "typing-clean" as const;
	if (normalized.includes("typing soft")) return "typing-soft" as const;
	if (normalized.includes("cursor blink")) return "cursor-blink" as const;
	if (normalized.includes("caption pop clean")) return "caption-pop-clean" as const;
	if (normalized.includes("caption pop bright")) return "caption-pop-bright" as const;
	if (normalized.includes("air fahhh soft")) return "air-fahhh-soft" as const;
	if (normalized.includes("air fahhh bold")) return "air-fahhh-bold" as const;
	if (normalized.includes("whoosh pop")) return "whoosh-pop" as const;
	return null;
}

function extractVersionTargets({ text }: { text: string }) {
	const targets: Array<"9:16" | "1:1" | "16:9"> = [];
	if (text.includes("9:16")) targets.push("9:16");
	if (text.includes("1:1")) targets.push("1:1");
	if (text.includes("16:9")) targets.push("16:9");
	return [...new Set(targets)];
}

function extractReferenceSuffix({ clause }: { clause: string }) {
	const match = clause.match(/\b(?:on|to|for)\s+(.+)$/i);
	return match?.[1] ?? null;
}

function resolveRequestedScope({
	clause,
	referenceLabel,
	overrides,
	selectedIds,
	sceneIds,
}: {
	clause: string;
	referenceLabel: string;
	overrides?: ChatPlannerOverrides;
	selectedIds: string[];
	sceneIds: string[];
}) {
	const normalized = clause.toLowerCase();
	const forced = overrides?.forced_choice_values_by_reference?.[referenceLabel] ?? null;
	const explicitScope =
		forced ??
		(normalized.includes("selected") || normalized.includes("selection")
			? "selection"
			: normalized.includes("scene")
				? "scene"
				: normalized.includes("project") || normalized.includes("all")
					? "project"
					: null);
	if (explicitScope) {
		return { value: explicitScope as "selection" | "scene" | "project", clarification: null };
	}
	if (selectedIds.length > 0 && sceneIds.length > selectedIds.length) {
		return {
			value: null,
			clarification: buildChoiceClarificationRequest({
				kind: "scope",
				prompt: "Apply this change to the current selection or all matching elements in the scene?",
				referenceLabel,
				options: [
					{
						value: "selection",
						label: "Selection",
						text_preview: "Only the currently selected elements.",
					},
					{
						value: "scene",
						label: "Scene",
						text_preview: "All matching elements in the active scene.",
					},
				],
			}),
		};
	}
	return { value: selectedIds.length > 0 ? "selection" : "scene", clarification: null };
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
	commands?: ClipForgeEditorCommand[];
	state: ChatResolutionState;
	clarification: ChatClarificationRequest | null;
} {
	warnings.push(`Skipped unsupported clause: "${clause}"`);
	return {
		ops: [],
		commands: [],
		state,
		clarification: null,
	};
}
