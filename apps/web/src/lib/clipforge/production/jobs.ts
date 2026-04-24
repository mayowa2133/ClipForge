import type { ClipForgeJobStatus } from "@/types/production";

const JOB_TRANSITIONS: Record<ClipForgeJobStatus, ClipForgeJobStatus[]> = {
	queued: ["processing", "cancelled", "failed"],
	processing: ["completed", "failed", "cancelled"],
	completed: [],
	failed: ["queued"],
	cancelled: ["queued"],
};

export function canTransitionClipForgeJob({
	from,
	to,
}: {
	from: ClipForgeJobStatus;
	to: ClipForgeJobStatus;
}): boolean {
	return from === to || JOB_TRANSITIONS[from].includes(to);
}

export function clampJobProgress(progressPct: number): number {
	if (!Number.isFinite(progressPct)) return 0;
	return Math.max(0, Math.min(100, Math.round(progressPct)));
}
