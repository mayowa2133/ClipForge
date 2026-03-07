import { describe, expect, test } from "bun:test";
import {
	canPreserveElementSourceSpan,
	clampPlaybackRate,
	getElementSourceTimeAtTimelineTime,
	getPlaybackDurationForSourceSpan,
} from "@/lib/timeline/manual-editing";
import type { AudioElement, TimelineTrack, VideoElement } from "@/types/timeline";

describe("manual editing helpers", () => {
	test("playback duration scales inversely with playback rate", () => {
		expect(
			getPlaybackDurationForSourceSpan({
				sourceSpan: 4,
				playbackRate: 2,
			}),
		).toBe(2);
		expect(
			getPlaybackDurationForSourceSpan({
				sourceSpan: 4,
				playbackRate: 0.5,
			}),
		).toBe(8);
	});

	test("source-time mapping respects playback rate", () => {
		const element: VideoElement = {
			id: "video-1",
			type: "video",
			mediaId: "asset-video",
			name: "Clip",
			startTime: 10,
			duration: 3,
			trimStart: 1,
			trimEnd: 0,
			playbackRate: 2,
			linkedGroupId: null,
			transform: {
				scale: 1,
				position: { x: 0, y: 0 },
				rotate: 0,
			},
			opacity: 1,
		};

		expect(
			getElementSourceTimeAtTimelineTime({
				element,
				time: 11.5,
			}),
		).toBeCloseTo(4);
	});

	test("replacement validation uses visible source span", () => {
		const element: AudioElement = {
			id: "audio-1",
			type: "audio",
			sourceType: "upload",
			mediaId: "asset-audio",
			name: "Audio",
			startTime: 0,
			duration: 3,
			trimStart: 1,
			trimEnd: 0,
			volume: 1,
			playbackRate: 2,
			fadeInDuration: 0,
			fadeOutDuration: 0,
			linkedGroupId: null,
		};

		expect(
			canPreserveElementSourceSpan({
				element,
				replacementDuration: 7,
			}),
		).toBe(true);
		expect(
			canPreserveElementSourceSpan({
				element,
				replacementDuration: 6.9,
			}),
		).toBe(false);
	});

	test("clamps playback rate to supported range", () => {
		expect(clampPlaybackRate({ playbackRate: 0.01 })).toBe(0.25);
		expect(clampPlaybackRate({ playbackRate: 10 })).toBe(4);
		expect(clampPlaybackRate({ playbackRate: 1.5 })).toBe(1.5);
	});
});
