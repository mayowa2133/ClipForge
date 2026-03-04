import type {
	ChatPlannerContext,
	ChatSegmentKind,
	ProjectSegmentSummary,
	ProjectSummary,
} from "./types";

export interface ChatResolutionState {
	lastResolvedSegmentId: string | null;
	lastResolvedSegmentKind: ChatSegmentKind | null;
	lastResolvedAnchorMs: number | null;
}

export function createEmptyResolutionState(): ChatResolutionState {
	return {
		lastResolvedSegmentId: null,
		lastResolvedSegmentKind: null,
		lastResolvedAnchorMs: null,
	};
}

export function resolveSelectionAnchor({
	projectSummary,
	context,
	allowedKinds,
}: {
	projectSummary: Pick<ProjectSummary, "segments">;
	context: ChatPlannerContext;
	allowedKinds: ChatSegmentKind[];
}): ProjectSegmentSummary | null {
	const candidates = findSelectionCandidates({
		projectSummary,
		context,
		allowedKinds,
	});
	return candidates.length === 1 ? candidates[0] : null;
}

export function resolvePlayheadAnchor({
	projectSummary,
	context,
	allowedKinds,
}: {
	projectSummary: Pick<ProjectSummary, "segments">;
	context: ChatPlannerContext;
	allowedKinds: ChatSegmentKind[];
}): ProjectSegmentSummary | null {
	const candidates = findPlayheadCandidates({
		projectSummary,
		context,
		allowedKinds,
	});
	return candidates.length === 1 ? candidates[0] : null;
}

export function findSelectionCandidates({
	projectSummary,
	context,
	allowedKinds,
}: {
	projectSummary: Pick<ProjectSummary, "segments">;
	context: ChatPlannerContext;
	allowedKinds: ChatSegmentKind[];
}): ProjectSegmentSummary[] {
	const matches: ProjectSegmentSummary[] = [];
	for (const selectedId of context.selected_segment_ids) {
		const match =
			projectSummary.segments.find(
				(segment) =>
					segment.segment_id === selectedId &&
					allowedKinds.includes(segment.segment_kind),
			) ?? null;
		if (match) {
			matches.push(match);
		}
	}
	return matches;
}

export function findPlayheadCandidates({
	projectSummary,
	context,
	allowedKinds,
}: {
	projectSummary: Pick<ProjectSummary, "segments">;
	context: ChatPlannerContext;
	allowedKinds: ChatSegmentKind[];
}): ProjectSegmentSummary[] {
	const candidates = projectSummary.segments
		.filter((segment) => allowedKinds.includes(segment.segment_kind))
		.sort((a, b) => a.start_ms - b.start_ms);
	if (candidates.length === 0) {
		return [];
	}

	const enclosing = candidates.filter(
		(segment) =>
			context.playhead_ms >= segment.start_ms && context.playhead_ms < segment.end_ms,
	);
	if (enclosing.length > 0) {
		return enclosing;
	}

	let nearestDistance = Number.POSITIVE_INFINITY;
	const nearest: ProjectSegmentSummary[] = [];
	for (const segment of candidates) {
		const distance = Math.abs(context.playhead_ms - segment.start_ms);
		if (distance < nearestDistance) {
			nearestDistance = distance;
			nearest.length = 0;
			nearest.push(segment);
			continue;
		}
		if (distance === nearestDistance) {
			nearest.push(segment);
		}
	}

	return nearest.sort((a, b) => a.start_ms - b.start_ms);
}

export function findImplicitCandidates({
	projectSummary,
	context,
	state,
	allowedKinds,
	token,
}: {
	projectSummary: Pick<ProjectSummary, "segments">;
	context: ChatPlannerContext;
	state: ChatResolutionState;
	allowedKinds: ChatSegmentKind[];
	token: "selection" | "playhead" | "carry-over";
}): ProjectSegmentSummary[] {
	if (token === "selection") {
		const selected = findSelectionCandidates({
			projectSummary,
			context,
			allowedKinds,
		});
		if (selected.length > 0) {
			return selected;
		}
		return findPlayheadCandidates({
			projectSummary,
			context,
			allowedKinds,
		});
	}

	if (token === "playhead") {
		return findPlayheadCandidates({
			projectSummary,
			context,
			allowedKinds,
		});
	}

	if (!state.lastResolvedSegmentId || !state.lastResolvedSegmentKind) {
		return [];
	}
	if (!allowedKinds.includes(state.lastResolvedSegmentKind)) {
		return [];
	}

	const match =
		projectSummary.segments.find(
			(segment) => segment.segment_id === state.lastResolvedSegmentId,
		) ?? null;
	return match ? [match] : [];
}

export function resolveImplicitReference({
	projectSummary,
	context,
	state,
	allowedKinds,
	token,
}: {
	projectSummary: Pick<ProjectSummary, "segments">;
	context: ChatPlannerContext;
	state: ChatResolutionState;
	allowedKinds: ChatSegmentKind[];
	token: "selection" | "playhead" | "carry-over";
}): ProjectSegmentSummary | null {
	const candidates = findImplicitCandidates({
		projectSummary,
		context,
		state,
		allowedKinds,
		token,
	});
	return candidates.length === 1 ? candidates[0] : null;
}

export function updateResolutionStateFromSegment(
	state: ChatResolutionState,
	segment: ProjectSegmentSummary,
): ChatResolutionState {
	return {
		lastResolvedSegmentId: segment.segment_id,
		lastResolvedSegmentKind: segment.segment_kind,
		lastResolvedAnchorMs: segment.start_ms,
	};
}
