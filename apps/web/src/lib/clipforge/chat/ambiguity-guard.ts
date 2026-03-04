import {
	createEmptyResolutionState,
	findImplicitCandidates,
	updateResolutionStateFromSegment,
} from "@/lib/clipforge/chat/context-resolution";
import { splitCompoundRequest } from "@/lib/clipforge/chat/compound-request";
import {
	parseDeleteSegmentRequest,
	parseDuplicateSegmentRequest,
	parseFixCaptionTextRequest,
	parseMoveSegmentRequest,
	parseSwapSegmentsRequest,
	parseTrimClipRequest,
} from "@/lib/clipforge/chat/prompt-parsers";
import { buildReferenceLabel } from "@/lib/clipforge/chat/reference-label";
import {
	findCaptionReferenceCandidates,
	findSegmentReferenceCandidates,
	type SegmentReference,
	type SegmentReferenceTarget,
} from "@/lib/clipforge/segment-resolution";
import { buildClarificationRequest } from "@/lib/clipforge/chat/chat-clarification";
import type {
	ChatClarificationRequest,
	ChatPlannerContext,
	ChatPlannerOverrides,
	ChatSegmentKind,
	ProjectSegmentSummary,
	ProjectSummary,
} from "@/lib/clipforge/chat/types";

export interface AmbiguityGuardResult {
	clarification: ChatClarificationRequest | null;
	warnings: string[];
}

export interface TargetIntent {
	referenceLabel: string;
	allowedKinds: ChatSegmentKind[];
	reference: SegmentReference;
	clauseIndex: number;
	referenceIndex: number;
	fromText?: string;
}

export interface ResolutionCandidate {
	segment: ProjectSegmentSummary;
	reason: "explicit-match" | "phrase-match" | "selection" | "playhead";
}

interface ResolvedTarget {
	segment: ProjectSegmentSummary | null;
	clarification: ChatClarificationRequest | null;
}

export function evaluateAmbiguityGuard({
	userText,
	projectSummary,
	context,
	overrides,
}: {
	userText: string;
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	overrides?: ChatPlannerOverrides;
}): AmbiguityGuardResult {
	const clauses = splitCompoundRequest(userText);
	const resolvedClauses = clauses.length > 0 ? clauses : [userText.trim()];
	let state = createEmptyResolutionState();

	for (const [clauseIndex, clause] of resolvedClauses.entries()) {
		const intents = collectTargetIntents({
			clause,
			clauseIndex,
		});
		for (const intent of intents) {
			const resolved = resolveTargetIntent({
				projectSummary,
				context,
				overrides,
				state,
				intent,
			});
			if (resolved.clarification) {
				return {
					clarification: resolved.clarification,
					warnings: [],
				};
			}
			if (resolved.segment) {
				state = updateResolutionStateFromSegment(state, resolved.segment);
			}
		}
	}

	return {
		clarification: null,
		warnings: [],
	};
}

function collectTargetIntents({
	clause,
	clauseIndex,
}: {
	clause: string;
	clauseIndex: number;
}): TargetIntent[] {
	const intents: TargetIntent[] = [];

	const fixCaptionRequest = parseFixCaptionTextRequest({ text: clause });
	if (fixCaptionRequest) {
		intents.push({
			reference: fixCaptionRequest.reference,
			allowedKinds: ["caption"],
			referenceLabel: buildReferenceLabel({
				reference: fixCaptionRequest.reference,
				fromText:
					fixCaptionRequest.from.trim().length > 0
						? fixCaptionRequest.from
						: undefined,
			}),
			clauseIndex,
			referenceIndex: 0,
			fromText:
				fixCaptionRequest.from.trim().length > 0
					? fixCaptionRequest.from
					: undefined,
		});
		return intents;
	}

	const swapRequest = parseSwapSegmentsRequest({ text: clause });
	if (swapRequest) {
		intents.push({
			reference: swapRequest.aReference,
			allowedKinds: ["video"],
			referenceLabel: buildReferenceLabel({ reference: swapRequest.aReference }),
			clauseIndex,
			referenceIndex: 0,
		});
		intents.push({
			reference: swapRequest.bReference,
			allowedKinds: ["video"],
			referenceLabel: buildReferenceLabel({ reference: swapRequest.bReference }),
			clauseIndex,
			referenceIndex: 1,
		});
		return intents;
	}

	const moveRequest = parseMoveSegmentRequest({ text: clause });
	if (moveRequest) {
		intents.push({
			reference: moveRequest.reference,
			allowedKinds: ["video"],
			referenceLabel: buildReferenceLabel({ reference: moveRequest.reference }),
			clauseIndex,
			referenceIndex: 0,
		});
		return intents;
	}

	const trimRequest = parseTrimClipRequest({ text: clause });
	if (trimRequest) {
		intents.push({
			reference: trimRequest.reference,
			allowedKinds: ["video"],
			referenceLabel: buildReferenceLabel({ reference: trimRequest.reference }),
			clauseIndex,
			referenceIndex: 0,
		});
		return intents;
	}

	const deleteRequest = parseDeleteSegmentRequest({ text: clause });
	if (deleteRequest) {
		intents.push({
			reference: deleteRequest.reference,
			allowedKinds: ["video"],
			referenceLabel: buildReferenceLabel({ reference: deleteRequest.reference }),
			clauseIndex,
			referenceIndex: 0,
		});
		return intents;
	}

	const duplicateRequest = parseDuplicateSegmentRequest({ text: clause });
	if (duplicateRequest) {
		intents.push({
			reference: duplicateRequest.reference,
			allowedKinds: ["video"],
			referenceLabel: buildReferenceLabel({ reference: duplicateRequest.reference }),
			clauseIndex,
			referenceIndex: 0,
		});
		return intents;
	}

	return intents;
}

function resolveTargetIntent({
	projectSummary,
	context,
	overrides,
	state,
	intent,
}: {
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	overrides?: ChatPlannerOverrides;
	state: ReturnType<typeof createEmptyResolutionState>;
	intent: TargetIntent;
}): ResolvedTarget {
	if (!isReferenceCompatibleWithKinds(intent.reference.target, intent.allowedKinds)) {
		return {
			segment: null,
			clarification: null,
		};
	}

	const forcedSegmentId =
		overrides?.forced_segment_ids_by_reference?.[intent.referenceLabel] ?? null;
	if (forcedSegmentId) {
		const forcedSegment =
			projectSummary.segments.find(
				(segment) =>
					segment.segment_id === forcedSegmentId &&
					intent.allowedKinds.includes(segment.segment_kind),
			) ?? null;
		return {
			segment: forcedSegment,
			clarification: null,
		};
	}

	const candidates = collectCandidates({
		projectSummary,
		context,
		state,
		intent,
	}).filter((candidate) =>
		intent.allowedKinds.includes(candidate.segment.segment_kind),
	);

	if (candidates.length === 0) {
		return {
			segment: null,
			clarification: null,
		};
	}
	if (candidates.length === 1) {
		return {
			segment: candidates[0]?.segment ?? null,
			clarification: null,
		};
	}

	return {
		segment: null,
		clarification: buildClarificationRequest({
			referenceLabel: intent.referenceLabel,
			candidates: candidates.map((candidate) => candidate.segment),
		}),
	};
}

function collectCandidates({
	projectSummary,
	context,
	state,
	intent,
}: {
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
	state: ReturnType<typeof createEmptyResolutionState>;
	intent: TargetIntent;
}): ResolutionCandidate[] {
	if (!intent.reference.mode || intent.reference.mode === "explicit") {
		if (intent.reference.target === "caption") {
			const candidates = findCaptionReferenceCandidates({
				projectSummary,
				reference: intent.reference,
				fromText: intent.fromText,
			});
			return candidates.map((segment) => ({
				segment,
				reason: "explicit-match" as const,
			}));
		}
		const candidates = findSegmentReferenceCandidates({
			projectSummary,
			reference: intent.reference,
		});
		return candidates.map((segment) => ({
			segment,
			reason: intent.reference.phrase ? ("phrase-match" as const) : ("explicit-match" as const),
		}));
	}

	const reason =
		intent.reference.mode === "selection"
			? ("selection" as const)
			: ("playhead" as const);
	return findImplicitCandidates({
		projectSummary,
		context,
		state,
		allowedKinds: intent.allowedKinds,
		token: intent.reference.mode,
	}).map((segment) => ({
		segment,
		reason,
	}));
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
