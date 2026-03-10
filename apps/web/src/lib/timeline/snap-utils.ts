import type { Bookmark, TimelineTrack } from "@/types/timeline";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { BOOKMARK_TIME_EPSILON } from "@/lib/timeline/bookmarks";

export interface SnapPoint {
	time: number;
	type:
		| "element-start"
		| "element-end"
		| "playhead"
		| "bookmark"
		| "beat"
		| "downbeat";
	elementId?: string;
	trackId?: string;
}

export interface SnapResult {
	snappedTime: number;
	snapPoint: SnapPoint | null;
	snapDistance: number;
}

const DEFAULT_SNAP_THRESHOLD_PX = 10;

export function findSnapPoints({
	tracks,
	playheadTime,
	excludeElementId,
	bookmarks = [],
	beatMarkers = [],
	excludeBookmarkTime,
	enableElementSnapping = true,
	enablePlayheadSnapping = true,
	enableBookmarkSnapping = true,
	enableBeatSnapping = true,
}: {
	tracks: Array<TimelineTrack>;
	playheadTime: number;
	excludeElementId?: string;
	bookmarks?: Array<Bookmark>;
	beatMarkers?: Array<{ time: number; kind: "beat" | "downbeat" }>;
	excludeBookmarkTime?: number;
	enableElementSnapping?: boolean;
	enablePlayheadSnapping?: boolean;
	enableBookmarkSnapping?: boolean;
	enableBeatSnapping?: boolean;
}): SnapPoint[] {
	const snapPoints: SnapPoint[] = [];

	if (enableElementSnapping) {
		for (const track of tracks) {
			for (const element of track.elements) {
				if (element.id === excludeElementId) continue;
				snapPoints.push(
					{
						time: element.startTime,
						type: "element-start",
						elementId: element.id,
						trackId: track.id,
					},
					{
						time: element.startTime + element.duration,
						type: "element-end",
						elementId: element.id,
						trackId: track.id,
					},
				);
			}
		}
	}

	if (enablePlayheadSnapping) {
		snapPoints.push({ time: playheadTime, type: "playhead" });
	}

	if (enableBookmarkSnapping) {
		for (const bookmark of bookmarks) {
			if (
				excludeBookmarkTime != null &&
				Math.abs(bookmark.time - excludeBookmarkTime) < BOOKMARK_TIME_EPSILON
			) {
				continue;
			}
			snapPoints.push({ time: bookmark.time, type: "bookmark" });
		}
	}

	if (enableBeatSnapping) {
		for (const beatMarker of beatMarkers) {
			snapPoints.push({
				time: beatMarker.time,
				type: beatMarker.kind,
			});
		}
	}

	return snapPoints;
}

export function snapToNearestPoint({
	targetTime,
	snapPoints,
	zoomLevel,
	snapThreshold = DEFAULT_SNAP_THRESHOLD_PX,
}: {
	targetTime: number;
	snapPoints: Array<SnapPoint>;
	zoomLevel: number;
	snapThreshold?: number;
}): SnapResult {
	const pixelsPerSecond = TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
	const thresholdInSeconds = snapThreshold / pixelsPerSecond;

	let closestSnapPoint: SnapPoint | null = null;
	let closestDistance = Infinity;

	for (const snapPoint of snapPoints) {
		const distance = Math.abs(targetTime - snapPoint.time);
		if (distance < thresholdInSeconds && distance < closestDistance) {
			closestDistance = distance;
			closestSnapPoint = snapPoint;
		}
	}

	return {
		snappedTime: closestSnapPoint ? closestSnapPoint.time : targetTime,
		snapPoint: closestSnapPoint,
		snapDistance: closestDistance,
	};
}

export function snapElementEdge({
	targetTime,
	elementDuration,
	tracks,
	playheadTime,
	zoomLevel,
	excludeElementId,
	snapToStart = true,
	bookmarks = [],
	beatMarkers = [],
}: {
	targetTime: number;
	elementDuration: number;
	tracks: Array<TimelineTrack>;
	playheadTime: number;
	zoomLevel: number;
	excludeElementId?: string;
	snapToStart?: boolean;
	bookmarks?: Array<Bookmark>;
	beatMarkers?: Array<{ time: number; kind: "beat" | "downbeat" }>;
}): SnapResult {
	const snapPoints = findSnapPoints({
		tracks,
		playheadTime,
		excludeElementId,
		bookmarks,
		beatMarkers,
	});

	const effectiveTargetTime = snapToStart
		? targetTime
		: targetTime + elementDuration;

	const snapResult = snapToNearestPoint({
		targetTime: effectiveTargetTime,
		snapPoints,
		zoomLevel,
	});

	if (!snapToStart && snapResult.snapPoint) {
		snapResult.snappedTime = snapResult.snappedTime - elementDuration;
	}

	return snapResult;
}
