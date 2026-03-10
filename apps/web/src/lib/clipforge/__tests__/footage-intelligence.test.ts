import { describe, expect, test } from "bun:test";
import { buildDefaultClipForgeProjectData, buildSceneFootageIntelligenceReport } from "@/lib/clipforge";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type { SceneBeatMarker } from "@/types/timeline";

function buildProjectFixture(): TProject {
	return {
		metadata: {
			id: "project-fi-1",
			name: "Footage Intelligence",
			duration: 12,
			createdAt: new Date("2026-03-10T00:00:00.000Z"),
			updatedAt: new Date("2026-03-10T00:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-1",
				name: "Main scene",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-03-10T00:00:00.000Z"),
				updatedAt: new Date("2026-03-10T00:00:00.000Z"),
				tracks: [
					{
						id: "video-track-1",
						type: "video",
						name: "Main",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [
							{
								id: "video-1",
								type: "video",
								name: "Clip 1",
								mediaId: "video-1",
								startTime: 0,
								duration: 5,
								trimStart: 0,
								trimEnd: 0,
								transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
								opacity: 1,
							},
							{
								id: "video-2",
								type: "video",
								name: "Clip 2",
								mediaId: "video-2",
								startTime: 5,
								duration: 4,
								trimStart: 0,
								trimEnd: 0,
								transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
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
			canvasSize: { width: 1080, height: 1920 },
			background: { type: "color", color: "#000000" },
		},
		version: 17,
		clipforge: {
			...buildDefaultClipForgeProjectData(),
			mediaMetadataById: {
				"video-1": {
					words: [
						{ text: "wake", start_ms: 0, end_ms: 300 },
						{ text: "up", start_ms: 320, end_ms: 620 },
						{ text: "early", start_ms: 640, end_ms: 980 },
					],
					segments: [{ text: "wake up early", start_ms: 0, end_ms: 980 }],
					silenceRegions: [],
					transcriptionStatus: "ready",
					transcriptionProvider: "browser-whisper",
					transcriptionLanguage: "en",
					transcriptionError: null,
					indexedAt: "2026-03-10T00:00:00.000Z",
				},
				"video-2": {
					words: [],
					segments: [],
					silenceRegions: [{ start_ms: 0, end_ms: 2800 }],
					transcriptionStatus: "ready",
					transcriptionProvider: "browser-whisper",
					transcriptionLanguage: "en",
					transcriptionError: null,
					indexedAt: "2026-03-10T00:00:00.000Z",
				},
			},
		},
	};
}

function buildVideoAsset({
	id,
	activityWindows,
	sceneCuts,
}: {
	id: string;
	activityWindows: Array<{ startTime: number; endTime: number; score: number }>;
	sceneCuts: number[];
}): MediaAsset {
	return {
		id,
		name: id,
		type: "video",
		duration: 6,
		visualAnalysis: {
			activityWindows,
			sceneCuts,
			analyzedAt: "2026-03-10T00:00:00.000Z",
			version: 1,
		},
		file: new File(["fixture"], `${id}.mp4`, { type: "video/mp4" }),
	};
}

describe("buildSceneFootageIntelligenceReport", () => {
	test("ranks an early transcript-rich window as the best hook candidate", () => {
		const project = buildProjectFixture();
		const report = buildSceneFootageIntelligenceReport({
			project,
			mediaAssets: [
				buildVideoAsset({
					id: "video-1",
					activityWindows: [{ startTime: 0, endTime: 1.5, score: 0.92 }],
					sceneCuts: [0],
				}),
				buildVideoAsset({
					id: "video-2",
					activityWindows: [{ startTime: 0, endTime: 1.5, score: 0.25 }],
					sceneCuts: [],
				}),
			],
			beatMarkers: [{ time: 0, kind: "downbeat", sourceMediaId: "song-1" } satisfies SceneBeatMarker],
		});

		expect(report.hookCandidates[0]?.elementId).toBe("video-1");
		expect(report.hookCandidates[0]?.reasons).toContain("Starts early in the scene.");
		expect(report.keepCutRecommendations.find((item) => item.elementId === "video-2")?.action).toBe("cut");
	});

	test("falls back with warnings when transcript and visual analysis are missing", () => {
		const project = buildProjectFixture();
		project.clipforge = {
			...project.clipforge!,
			mediaMetadataById: {},
		};
		const report = buildSceneFootageIntelligenceReport({
			project,
			mediaAssets: [
				{
					id: "video-1",
					name: "video-1",
					type: "video",
					duration: 6,
					file: new File(["fixture"], "video-1.mp4", { type: "video/mp4" }),
				},
			],
		});

		expect(report.warnings).toContain(
			"No transcript metadata is available, so scoring falls back to visual timing signals.",
		);
		expect(report.warnings).toContain(
			"Some clips have no visual activity analysis, so hook scoring falls back to transcript and timing signals.",
		);
		expect(report.hookCandidates.length).toBeGreaterThan(0);
	});
});
