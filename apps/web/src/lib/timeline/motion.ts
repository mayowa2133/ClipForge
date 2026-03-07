import type {
	AnimatedPropertyKeyframe,
	ElementTransitionIn,
	ImageElement,
	StickerElement,
	TextElement,
	TimelineElement,
	TimelineTrack,
	TransitionPreset,
	VideoElement,
	VisualKeyframeMap,
} from "@/types/timeline";
import type { Transform } from "@/types/rendering";

export type VisualElement = VideoElement | ImageElement | TextElement | StickerElement;
export type AnimatableVisualProperty = keyof VisualKeyframeMap;

export const ANIMATABLE_VISUAL_PROPERTIES: AnimatableVisualProperty[] = [
	"positionX",
	"positionY",
	"scale",
	"rotate",
	"opacity",
];

const DEFAULT_TRANSITION_MIN_DURATION = 0.1;
const DEFAULT_TRANSITION_MAX_DURATION = 2;

export function isVisualElementWithMotion(
	element: TimelineElement,
): element is VisualElement {
	return (
		element.type === "video" ||
		element.type === "image" ||
		element.type === "text" ||
		element.type === "sticker"
	);
}

export function getElementLocalTime({
	element,
	time,
}: {
	element: Pick<VisualElement, "startTime" | "duration">;
	time: number;
}): number {
	return Math.max(0, Math.min(element.duration, time - element.startTime));
}

export function isTimelineTimeWithinElement({
	element,
	time,
}: {
	element: Pick<VisualElement, "startTime" | "duration">;
	time: number;
}): boolean {
	const end = element.startTime + element.duration;
	return time >= element.startTime && time <= end;
}

export function normalizeAnimatedPropertyKeyframes({
	keyframes,
}: {
	keyframes: AnimatedPropertyKeyframe[];
}): AnimatedPropertyKeyframe[] {
	const deduped = new Map<string, AnimatedPropertyKeyframe>();
	for (const keyframe of keyframes) {
		if (!Number.isFinite(keyframe.time) || !Number.isFinite(keyframe.value)) {
			continue;
		}
		deduped.set(keyframe.time.toFixed(6), {
			time: keyframe.time,
			value: keyframe.value,
		});
	}

	return [...deduped.values()].sort((a, b) => {
		if (a.time !== b.time) return a.time - b.time;
		return a.value - b.value;
	});
}

export function getKeyframesForProperty({
	element,
	property,
}: {
	element: VisualElement;
	property: AnimatableVisualProperty;
}): AnimatedPropertyKeyframe[] {
	return normalizeAnimatedPropertyKeyframes({
		keyframes: element.keyframes?.[property] ?? [],
	});
}

export function hasAnyVisualKeyframes({ element }: { element: VisualElement }): boolean {
	return ANIMATABLE_VISUAL_PROPERTIES.some(
		(property) => getKeyframesForProperty({ element, property }).length > 0,
	);
}

export function hasPropertyKeyframes({
	element,
	property,
}: {
	element: VisualElement;
	property: AnimatableVisualProperty;
}): boolean {
	return getKeyframesForProperty({ element, property }).length > 0;
}

export function getBasePropertyValue({
	element,
	property,
}: {
	element: VisualElement;
	property: AnimatableVisualProperty;
}): number {
	switch (property) {
		case "positionX":
			return element.transform.position.x;
		case "positionY":
			return element.transform.position.y;
		case "scale":
			return element.transform.scale;
		case "rotate":
			return element.transform.rotate;
		case "opacity":
			return element.opacity;
	}
}

export function sampleAnimatedPropertyValue({
	element,
	property,
	localTime,
}: {
	element: VisualElement;
	property: AnimatableVisualProperty;
	localTime: number;
}): number {
	const keyframes = getKeyframesForProperty({ element, property });
	if (keyframes.length === 0) {
		return getBasePropertyValue({ element, property });
	}
	if (keyframes.length === 1) {
		return keyframes[0]?.value ?? getBasePropertyValue({ element, property });
	}

	if (localTime <= (keyframes[0]?.time ?? 0)) {
		return keyframes[0]?.value ?? getBasePropertyValue({ element, property });
	}
	const lastKeyframe = keyframes[keyframes.length - 1];
	if (lastKeyframe && localTime >= lastKeyframe.time) {
		return lastKeyframe.value;
	}

	for (let index = 0; index < keyframes.length - 1; index += 1) {
		const current = keyframes[index];
		const next = keyframes[index + 1];
		if (!current || !next) continue;
		if (localTime < current.time || localTime > next.time) continue;
		const range = next.time - current.time;
		if (range <= 0) {
			return next.value;
		}
		const progress = (localTime - current.time) / range;
		return current.value + (next.value - current.value) * progress;
	}

	return getBasePropertyValue({ element, property });
}

export function getEffectiveVisualStateAtTime({
	element,
	time,
}: {
	element: VisualElement;
	time: number;
}): { transform: Transform; opacity: number } {
	const localTime = getElementLocalTime({ element, time });
	return {
		transform: {
			scale: sampleAnimatedPropertyValue({
				element,
				property: "scale",
				localTime,
			}),
			position: {
				x: sampleAnimatedPropertyValue({
					element,
					property: "positionX",
					localTime,
				}),
				y: sampleAnimatedPropertyValue({
					element,
					property: "positionY",
					localTime,
				}),
			},
			rotate: sampleAnimatedPropertyValue({
				element,
				property: "rotate",
				localTime,
			}),
		},
		opacity: sampleAnimatedPropertyValue({
			element,
			property: "opacity",
			localTime,
		}),
	};
}

export function seedKeyframesIfNeeded({
	element,
	property,
	localTime,
	value,
}: {
	element: VisualElement;
	property: AnimatableVisualProperty;
	localTime: number;
	value: number;
}): AnimatedPropertyKeyframe[] {
	const existing = getKeyframesForProperty({ element, property });
	if (existing.length > 0) {
		return normalizeAnimatedPropertyKeyframes({
			keyframes: [...existing, { time: localTime, value }],
		});
	}

	if (localTime <= 0) {
		return [{ time: 0, value }];
	}

	return normalizeAnimatedPropertyKeyframes({
		keyframes: [
			{ time: 0, value: getBasePropertyValue({ element, property }) },
			{ time: localTime, value },
		],
	});
}

export function setPropertyKeyframeValue({
	element,
	property,
	localTime,
	value,
}: {
	element: VisualElement;
	property: AnimatableVisualProperty;
	localTime: number;
	value: number;
}): VisualKeyframeMap {
	const nextKeyframes = seedKeyframesIfNeeded({
		element,
		property,
		localTime,
		value,
	});
	return {
		...(element.keyframes ?? {}),
		[property]: nextKeyframes,
	};
}

export function removePropertyKeyframeValue({
	element,
	property,
	localTime,
}: {
	element: VisualElement;
	property: AnimatableVisualProperty;
	localTime: number;
}): VisualKeyframeMap | null {
	const current = getKeyframesForProperty({ element, property });
	const next = current.filter(
		(keyframe) => Math.abs(keyframe.time - localTime) > 0.0005,
	);
	const keyframes: VisualKeyframeMap = { ...(element.keyframes ?? {}) };
	if (next.length === 0) {
		delete keyframes[property];
	} else {
		keyframes[property] = next;
	}
	return Object.keys(keyframes).length > 0 ? keyframes : null;
}

export function clearVisualKeyframes({
	element,
	property,
}: {
	element: VisualElement;
	property?: AnimatableVisualProperty;
}): VisualKeyframeMap | null {
	if (!property) return null;
	const keyframes: VisualKeyframeMap = { ...(element.keyframes ?? {}) };
	delete keyframes[property];
	return Object.keys(keyframes).length > 0 ? keyframes : null;
}

export function clampTransitionDuration({
	duration,
	currentDuration,
	previousDuration,
}: {
	duration: number;
	currentDuration: number;
	previousDuration: number;
}): number {
	const hardMax = Math.min(
		DEFAULT_TRANSITION_MAX_DURATION,
		currentDuration,
		previousDuration,
	);
	if (hardMax <= 0) return 0;
	return Math.min(hardMax, Math.max(DEFAULT_TRANSITION_MIN_DURATION, duration));
}

export function findAdjacentVisualIncomingTransitionTarget({
	track,
	elementId,
	fps,
}: {
	track: TimelineTrack;
	elementId: string;
	fps: number;
}): {
	current: VideoElement | ImageElement;
	previous: VideoElement | ImageElement;
} | null {
	if (track.type !== "video") return null;
	const epsilon = 1 / Math.max(1, fps);
	const sortedElements = track.elements
		.filter(
			(element): element is VideoElement | ImageElement =>
				element.type === "video" || element.type === "image",
		)
		.slice()
		.sort((a, b) => {
			if (a.startTime !== b.startTime) return a.startTime - b.startTime;
			return a.id.localeCompare(b.id);
		});
	const currentIndex = sortedElements.findIndex((element) => element.id === elementId);
	if (currentIndex <= 0) return null;
	const current = sortedElements[currentIndex];
	const previous = sortedElements[currentIndex - 1];
	if (!current || !previous) return null;
	const previousEnd = previous.startTime + previous.duration;
	if (Math.abs(previousEnd - current.startTime) > epsilon) {
		return null;
	}
	return { current, previous };
}

export function isTransitionPreset(value: string): value is TransitionPreset {
	return (
		value === "cross-dissolve" ||
		value === "fade-black" ||
		value === "fade-white" ||
		value === "slide"
	);
}

export function transitionIsActiveAtTime({
	element,
	time,
}: {
	element: Pick<VisualElement, "startTime" | "transitionIn">;
	time: number;
}): boolean {
	if (!element.transitionIn) return false;
	return time >= element.startTime && time < element.startTime + element.transitionIn.duration;
}

export function getTransitionProgress({
	element,
	time,
}: {
	element: Pick<VisualElement, "startTime" | "transitionIn">;
	time: number;
}): number {
	if (!element.transitionIn) return 1;
	const duration = Math.max(DEFAULT_TRANSITION_MIN_DURATION, element.transitionIn.duration);
	return Math.max(0, Math.min(1, (time - element.startTime) / duration));
}

export function getPreviousTransitionSampleTime({
	previous,
	current,
	time,
}: {
	previous: Pick<VisualElement, "startTime" | "duration">;
	current: Pick<VisualElement, "startTime"> & { transitionIn: ElementTransitionIn };
	time: number;
}): number {
	const progress = getTransitionProgress({ element: current, time });
	const previousStart = previous.startTime + previous.duration - current.transitionIn.duration;
	return previousStart + current.transitionIn.duration * progress;
}
