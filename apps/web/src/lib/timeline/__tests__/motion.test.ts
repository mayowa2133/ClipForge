import { describe, expect, test } from "bun:test";
import {
	clampTransitionDuration,
	findAdjacentVisualIncomingTransitionTarget,
	getEffectiveVisualStateAtTime,
	getElementLocalTime,
	removePropertyKeyframeValue,
	setPropertyKeyframeValue,
} from "@/lib/timeline";
import type { TimelineTrack, VideoElement } from "@/types/timeline";

function buildVideoElement(overrides: Partial<VideoElement> = {}): VideoElement {
	return {
		id: "video-1",
		type: "video",
		mediaId: "asset-video",
		name: "Clip",
		startTime: 0,
		duration: 4,
		trimStart: 0,
		trimEnd: 0,
		transform: {
			scale: 1,
			position: { x: 0, y: 0 },
			rotate: 0,
		},
		opacity: 1,
		linkedGroupId: null,
		playbackRate: 1,
		transitionIn: null,
		keyframes: null,
		...overrides,
	};
}

describe("motion helpers", () => {
	test("samples static values when no keyframes exist", () => {
		const element = buildVideoElement({
			transform: {
				scale: 1.5,
				position: { x: 24, y: -12 },
				rotate: 18,
			},
			opacity: 0.8,
		});

		const state = getEffectiveVisualStateAtTime({ element, time: 2 });
		expect(state.transform.position.x).toBe(24);
		expect(state.transform.position.y).toBe(-12);
		expect(state.transform.scale).toBe(1.5);
		expect(state.transform.rotate).toBe(18);
		expect(state.opacity).toBe(0.8);
	});

	test("seeds the first keyframe from the base value and interpolates linearly", () => {
		const element = buildVideoElement({
			transform: {
				scale: 1,
				position: { x: 10, y: 0 },
				rotate: 0,
			},
		});

		const keyframes = setPropertyKeyframeValue({
			element,
			property: "positionX",
			localTime: 2,
			value: 110,
		});

		const animatedElement = { ...element, keyframes };
		expect(animatedElement.keyframes?.positionX).toEqual([
			{ time: 0, value: 10 },
			{ time: 2, value: 110 },
		]);

		const state = getEffectiveVisualStateAtTime({
			element: animatedElement,
			time: 1,
		});
		expect(state.transform.position.x).toBe(60);
	});

	test("removes exact keyframes and clears empty property maps", () => {
		const element = buildVideoElement({
			keyframes: {
				opacity: [
					{ time: 0, value: 1 },
					{ time: 1, value: 0.5 },
				],
			},
		});

		const next = removePropertyKeyframeValue({
			element,
			property: "opacity",
			localTime: 1,
		});
		expect(next?.opacity).toEqual([{ time: 0, value: 1 }]);

		const cleared = removePropertyKeyframeValue({
			element: { ...element, keyframes: next },
			property: "opacity",
			localTime: 0,
		});
		expect(cleared).toBeNull();
	});

	test("local time mapping stays relative to the clip start", () => {
		const element = buildVideoElement({
			startTime: 5,
			duration: 3,
			keyframes: {
				scale: [
					{ time: 0, value: 1 },
					{ time: 3, value: 2 },
				],
			},
		});

		expect(getElementLocalTime({ element, time: 6.5 })).toBe(1.5);
		const state = getEffectiveVisualStateAtTime({ element, time: 6.5 });
		expect(state.transform.scale).toBe(1.5);
	});

	test("transition duration clamps to valid neighboring clip limits", () => {
		expect(
			clampTransitionDuration({
				duration: 4,
				currentDuration: 1.2,
				previousDuration: 0.75,
			}),
		).toBe(0.75);
		expect(
			clampTransitionDuration({
				duration: 0.02,
				currentDuration: 3,
				previousDuration: 3,
			}),
		).toBe(0.1);
	});

	test("adjacent transition targets reject gaps and return touching clips only", () => {
		const track: TimelineTrack = {
			id: "track-video",
			type: "video",
			name: "Video",
			isMain: true,
			muted: false,
			hidden: false,
			elements: [
				buildVideoElement({
					id: "video-a",
					name: "A",
					startTime: 0,
					duration: 2,
				}),
				buildVideoElement({
					id: "video-b",
					name: "B",
					startTime: 2,
					duration: 2,
				}),
				buildVideoElement({
					id: "video-c",
					name: "C",
					startTime: 4.25,
					duration: 2,
				}),
			],
		};

		const adjacent = findAdjacentVisualIncomingTransitionTarget({
			track,
			elementId: "video-b",
			fps: 30,
		});
		expect(adjacent?.previous.id).toBe("video-a");
		expect(adjacent?.current.id).toBe("video-b");

		const gap = findAdjacentVisualIncomingTransitionTarget({
			track,
			elementId: "video-c",
			fps: 30,
		});
		expect(gap).toBeNull();
	});
});
