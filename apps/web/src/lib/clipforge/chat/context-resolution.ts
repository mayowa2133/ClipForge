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
	for (const selectedId of context.selected_segment_ids) {
		const match =
			projectSummary.segments.find(
				(segment) =>
					segment.segment_id === selectedId &&
					allowedKinds.includes(segment.segment_kind),
			) ?? null;
		if (match) {
			return match;
		}
	}
	return null;
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
	const candidates = projectSummary.segments
		.filter((segment) => allowedKinds.includes(segment.segment_kind))
		.sort((a, b) => a.start_ms - b.start_ms);
	if (candidates.length === 0) {
		return null;
	}

	const enclosing = candidates.find(
		(segment) =>
			context.playhead_ms >= segment.start_ms && context.playhead_ms < segment.end_ms,
	);
	if (enclosing) {
		return enclosing;
	}

	return (
		candidates
			.slice()
			.sort((a, b) => {
				const aDistance = Math.abs(context.playhead_ms - a.start_ms);
				const bDistance = Math.abs(context.playhead_ms - b.start_ms);
				if (aDistance !== bDistance) {
					return aDistance - bDistance;
				}
				return a.start_ms - b.start_ms;
			})[0] ?? null
	);
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
	if (token === "selection") {
		return (
			resolveSelectionAnchor({
				projectSummary,
				context,
				allowedKinds,
			}) ??
			resolvePlayheadAnchor({
				projectSummary,
				context,
				allowedKinds,
			})
		);
	}

	if (token === "playhead") {
		return resolvePlayheadAnchor({
			projectSummary,
			context,
			allowedKinds,
		});
	}

	if (!state.lastResolvedSegmentId || !state.lastResolvedSegmentKind) {
		return null;
	}
	if (!allowedKinds.includes(state.lastResolvedSegmentKind)) {
		return null;
	}

	return (
		projectSummary.segments.find(
			(segment) => segment.segment_id === state.lastResolvedSegmentId,
		) ?? null
	);
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
