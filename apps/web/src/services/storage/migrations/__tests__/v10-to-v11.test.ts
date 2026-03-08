import { describe, expect, test } from "bun:test";
import { transformProjectV10ToV11 } from "../transformers/v10-to-v11";

const v10Project = {
	id: "project-v10-123",
	version: 10,
	metadata: {
		id: "project-v10-123",
		name: "My V10 Project",
		duration: 12,
		createdAt: "2026-03-01T10:00:00.000Z",
		updatedAt: "2026-03-01T12:00:00.000Z",
	},
	scenes: [
		{
			id: "scene-main",
			name: "Main scene",
			isMain: true,
			bookmarks: [],
			createdAt: "2026-03-01T10:00:00.000Z",
			updatedAt: "2026-03-01T12:00:00.000Z",
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
							trimStart: 0,
							trimEnd: 0,
							transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
							opacity: 1,
							transitionIn: null,
							keyframes: null,
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
							transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
							opacity: 1,
							transitionIn: null,
							keyframes: null,
						},
					],
				},
			],
		},
	],
};

describe("V10 to V11 Migration", () => {
	test("adds finishing defaults to video and image elements", () => {
		const result = transformProjectV10ToV11({ project: v10Project });
		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(11);
		const scenes = result.project.scenes as Array<Record<string, unknown>>;
		const tracks = scenes[0]?.tracks as Array<Record<string, unknown>>;
		const videoElements = tracks[0]?.elements as Array<Record<string, unknown>>;
		expect(videoElements[0]?.adjustments).toBeNull();
		expect(videoElements[0]?.effects).toBeNull();
		expect(videoElements[1]?.adjustments).toBeNull();
		expect(videoElements[1]?.effects).toBeNull();
	});

	test("skips projects already at v11", () => {
		const result = transformProjectV10ToV11({
			project: { ...v10Project, version: 11 },
		});
		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("already v11");
	});
});
