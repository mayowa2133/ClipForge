import { describe, expect, test } from "bun:test";
import { transformProjectV8ToV9 } from "../transformers/v8-to-v9";

const v8Project = {
	id: "project-v8-123",
	version: 8,
	metadata: {
		id: "project-v8-123",
		name: "My V8 Project",
		duration: 12,
		createdAt: "2026-01-01T10:00:00.000Z",
		updatedAt: "2026-01-01T12:00:00.000Z",
	},
	scenes: [
		{
			id: "scene-main",
			name: "Main scene",
			isMain: true,
			bookmarks: [],
			createdAt: "2026-01-01T10:00:00.000Z",
			updatedAt: "2026-01-01T12:00:00.000Z",
			tracks: [
				{
					id: "video-track",
					type: "video",
					name: "Video",
					isMain: true,
					muted: false,
					hidden: false,
					elements: [
						{
							id: "video-1",
							type: "video",
							mediaId: "asset-video",
							name: "Clip",
							startTime: 0,
							duration: 4,
							trimStart: 1,
							trimEnd: 0,
							transform: {
								scale: 1,
								position: { x: 0, y: 0 },
								rotate: 0,
							},
							opacity: 1,
						},
						{
							id: "image-1",
							type: "image",
							mediaId: "asset-image",
							name: "Still",
							startTime: 4,
							duration: 2,
							trimStart: 0,
							trimEnd: 0,
							transform: {
								scale: 1,
								position: { x: 0, y: 0 },
								rotate: 0,
							},
							opacity: 1,
						},
					],
				},
				{
					id: "audio-track",
					type: "audio",
					name: "Audio",
					muted: false,
					elements: [
						{
							id: "audio-1",
							type: "audio",
							sourceType: "upload",
							mediaId: "asset-audio",
							name: "Audio",
							startTime: 0,
							duration: 4,
							trimStart: 0,
							trimEnd: 0,
							volume: 1,
						},
					],
				},
			],
		},
	],
};

describe("V8 to V9 Migration", () => {
	test("adds manual editing defaults to timeline elements", () => {
		const result = transformProjectV8ToV9({ project: v8Project });

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(9);

		const scenes = result.project.scenes as Array<Record<string, unknown>>;
		const tracks = scenes[0]?.tracks as Array<Record<string, unknown>>;
		const videoTrackElements = tracks[0]?.elements as Array<Record<string, unknown>>;
		const audioTrackElements = tracks[1]?.elements as Array<Record<string, unknown>>;

		expect(videoTrackElements[0]?.playbackRate).toBe(1);
		expect(videoTrackElements[0]?.linkedGroupId).toBeNull();
		expect(videoTrackElements[1]?.linkedGroupId).toBeNull();
		expect(audioTrackElements[0]?.playbackRate).toBe(1);
		expect(audioTrackElements[0]?.fadeInDuration).toBe(0);
		expect(audioTrackElements[0]?.fadeOutDuration).toBe(0);
		expect(audioTrackElements[0]?.linkedGroupId).toBeNull();
	});

	test("skips projects that are already v9", () => {
		const result = transformProjectV8ToV9({
			project: {
				...v8Project,
				version: 9,
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("already v9");
	});
});
