import { describe, expect, test } from "bun:test";
import {
	buildAutoMontageWindows,
	mapBeatAnalysisToTimeline,
	quantizeTimeToMarkers,
	resolveSceneBeatMarkers,
} from "@/lib/media/beat-analysis";

describe("beat analysis helpers", () => {
	test("maps beat metadata into timeline markers with playback rate", () => {
		const markers = mapBeatAnalysisToTimeline({
			element: {
				id: "audio-1",
				type: "audio",
				sourceType: "upload",
				mediaId: "media-1",
				name: "Song",
				startTime: 5,
				duration: 4,
				trimStart: 2,
				trimEnd: 0,
				volume: 1,
				role: "music",
				playbackRate: 2,
			},
			beatAnalysis: {
				bpm: 120,
				beats: [1.5, 2, 3, 4, 5, 6],
				downbeats: [2, 4, 6],
				analyzedAt: "2026-03-10T00:00:00.000Z",
				version: 1,
			},
		});

		expect(markers.map((marker) => marker.time)).toEqual([5, 5.5, 6, 6.5, 7]);
		expect(markers[0]?.kind).toBe("downbeat");
		expect(markers[1]?.kind).toBe("beat");
	});

	test("resolves the earliest music clip as the default beat source", () => {
		const beatState = resolveSceneBeatMarkers({
			tracks: [
				{
					id: "audio-track",
					name: "Audio",
					type: "audio",
					muted: false,
					volume: 1,
					elements: [
						{
							id: "music-a",
							type: "audio",
							sourceType: "upload",
							mediaId: "song-a",
							name: "Song A",
							startTime: 4,
							duration: 3,
							trimStart: 0,
							trimEnd: 0,
							volume: 1,
							role: "music",
						},
						{
							id: "music-b",
							type: "audio",
							sourceType: "upload",
							mediaId: "song-b",
							name: "Song B",
							startTime: 1,
							duration: 3,
							trimStart: 0,
							trimEnd: 0,
							volume: 1,
							role: "music",
						},
					],
				},
			],
			selectedBeatSourceMediaId: null,
			mediaAssets: [
				{
					id: "song-a",
					name: "Song A",
					type: "audio",
					file: new File(["a"], "a.mp3", { type: "audio/mpeg" }),
					beatAnalysis: {
						bpm: 120,
						beats: [0, 0.5, 1, 1.5],
						downbeats: [0, 1],
						analyzedAt: "2026-03-10T00:00:00.000Z",
						version: 1,
					},
				},
				{
					id: "song-b",
					name: "Song B",
					type: "audio",
					file: new File(["b"], "b.mp3", { type: "audio/mpeg" }),
					beatAnalysis: {
						bpm: 100,
						beats: [0, 0.6, 1.2, 1.8],
						downbeats: [0, 1.2],
						analyzedAt: "2026-03-10T00:00:00.000Z",
						version: 1,
					},
				},
			],
		});

		expect(beatState.sourceMediaId).toBe("song-b");
		expect(beatState.bpm).toBe(100);
		expect(beatState.markers[0]?.time).toBe(1);
	});

	test("quantizes to the nearest marker deterministically", () => {
		expect(
			quantizeTimeToMarkers({
				time: 2.18,
				markers: [
					{ time: 2, kind: "beat", sourceMediaId: "song-1" },
					{ time: 2.5, kind: "downbeat", sourceMediaId: "song-1" },
				],
			}),
		).toBe(2);
	});

	test("builds montage windows from beat markers", () => {
		const windows = buildAutoMontageWindows({
			markers: [
				{ time: 0, kind: "downbeat", sourceMediaId: "song-1" },
				{ time: 0.5, kind: "beat", sourceMediaId: "song-1" },
				{ time: 1, kind: "beat", sourceMediaId: "song-1" },
				{ time: 1.5, kind: "beat", sourceMediaId: "song-1" },
				{ time: 2, kind: "downbeat", sourceMediaId: "song-1" },
			],
			beatDivision: 2,
		});

		expect(windows).toEqual([
			{ startTime: 0, duration: 1 },
			{ startTime: 1, duration: 1 },
		]);
	});
});
