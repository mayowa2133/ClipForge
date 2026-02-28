import { describe, expect, test } from "bun:test";
import {
	buildDefaultClipForgeProjectData,
	buildTimelineTranscriptSegments,
} from "@/lib/clipforge";
import type { TProject } from "@/types/project";

describe("buildTimelineTranscriptSegments", () => {
	test("maps indexed clip metadata onto timeline time", () => {
		const project: TProject = {
			metadata: {
				id: "project-1",
				name: "Timeline",
				duration: 4,
				createdAt: new Date("2026-02-27T00:00:00.000Z"),
				updatedAt: new Date("2026-02-27T00:00:00.000Z"),
			},
			scenes: [
				{
					id: "scene-1",
					name: "Main",
					isMain: true,
					bookmarks: [],
					createdAt: new Date("2026-02-27T00:00:00.000Z"),
					updatedAt: new Date("2026-02-27T00:00:00.000Z"),
					tracks: [
						{
							id: "video-1",
							type: "video",
							name: "Video",
							isMain: true,
							muted: false,
							hidden: false,
							elements: [
								{
									id: "clip-1",
									type: "video",
									name: "Clip",
									mediaId: "media-1",
									startTime: 2,
									duration: 2,
									trimStart: 0,
									trimEnd: 0,
									muted: false,
									hidden: false,
									transform: {
										scale: 1,
										position: { x: 0, y: 0 },
										rotate: 0,
									},
									opacity: 1,
								},
							],
						},
					],
				},
			],
			currentSceneId: "scene-1",
			settings: {
				fps: 30,
				canvasSize: { width: 1920, height: 1080 },
				background: { type: "color", color: "#000" },
			},
			version: 8,
			clipforge: {
				...buildDefaultClipForgeProjectData(),
				mediaMetadataById: {
					"media-1": {
						words: [
							{ text: "hello", start_ms: 0, end_ms: 500 },
							{ text: "world", start_ms: 500, end_ms: 1000 },
						],
						segments: [
							{ text: "hello world", start_ms: 0, end_ms: 1000 },
						],
						silenceRegions: [],
						transcriptionStatus: "ready",
						transcriptionProvider: "srt-import",
						transcriptionLanguage: "en",
						transcriptionError: null,
						indexedAt: "2026-02-27T00:00:00.000Z",
					},
				},
			},
		};

		const segments = buildTimelineTranscriptSegments({ project });

		expect(segments).toEqual([
			{
				text: "hello world",
				start: 2,
				end: 3,
			},
		]);
	});
});
