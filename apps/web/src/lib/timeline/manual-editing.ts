import type { MediaAsset } from "@/types/assets";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";
import { getElementPlaybackRate } from "./element-utils";

export const MIN_PLAYBACK_RATE = 0.25;
export const MAX_PLAYBACK_RATE = 4;

export function clampPlaybackRate({
	playbackRate,
}: {
	playbackRate: number;
}): number {
	return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, playbackRate));
}

export function getElementVisibleSourceSpan({
	element,
}: {
	element: TimelineElement;
}): number {
	return element.duration * getElementPlaybackRate({ element });
}

export function getPlaybackDurationForSourceSpan({
	sourceSpan,
	playbackRate,
}: {
	sourceSpan: number;
	playbackRate: number;
}): number {
	return sourceSpan / clampPlaybackRate({ playbackRate });
}

export function getElementSourceTimeAtTimelineTime({
	element,
	time,
}: {
	element: TimelineElement;
	time: number;
}): number {
	return (
		element.trimStart +
		Math.max(0, time - element.startTime) * getElementPlaybackRate({ element })
	);
}

export function getMediaSourceDuration({
	element,
	mediaAsset,
}: {
	element: TimelineElement;
	mediaAsset: MediaAsset | null | undefined;
}): number {
	if (typeof mediaAsset?.duration === "number" && mediaAsset.duration > 0) {
		return mediaAsset.duration;
	}

	return element.trimStart + getElementVisibleSourceSpan({ element }) + element.trimEnd;
}

export function canPreserveElementSourceSpan({
	element,
	replacementDuration,
}: {
	element: TimelineElement;
	replacementDuration: number;
}): boolean {
	const requiredDuration =
		element.trimStart + getElementVisibleSourceSpan({ element }) + element.trimEnd;
	return replacementDuration >= requiredDuration;
}

export function shiftTrackElementsAfterTime({
	track,
	time,
	delta,
	excludeElementId,
}: {
	track: TimelineTrack;
	time: number;
	delta: number;
	excludeElementId?: string;
}): TimelineTrack {
	if (delta === 0) return track;

	return {
		...track,
		elements: track.elements.map((element) => {
			if (element.id === excludeElementId) {
				return element;
			}
			if (element.startTime < time) {
				return element;
			}
			return {
				...element,
				startTime: Math.max(0, element.startTime + delta),
			};
		}),
	} as TimelineTrack;
}
