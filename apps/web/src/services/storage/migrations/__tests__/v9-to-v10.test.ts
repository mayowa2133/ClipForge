import { describe, expect, test } from "bun:test";
import { transformProjectV9ToV10 } from "../transformers/v9-to-v10";

const v9Project = {
	id: "project-v9-123",
	version: 9,
	metadata: {
		id: "project-v9-123",
		name: "My V9 Project",
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
					id: "text-track",
					type: "text",
					name: "Text",
					hidden: false,
					elements: [
						{
							id: "text-1",
							type: "text",
							name: "Caption",
							content: "hello",
							startTime: 0,
							duration: 2,
							trimStart: 0,
							trimEnd: 0,
							fontSize: 24,
							fontFamily: "Geist",
							color: "#ffffff",
							background: { color: "#000000" },
							textAlign: "center",
							fontWeight: "normal",
							fontStyle: "normal",
							textDecoration: "none",
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
};

describe("V9 to V10 Migration", () => {
	test("adds motion defaults to visual elements", () => {
		const result = transformProjectV9ToV10({ project: v9Project });

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(10);

		const scenes = result.project.scenes as Array<Record<string, unknown>>;
		const tracks = scenes[0]?.tracks as Array<Record<string, unknown>>;
		const videoElements = tracks[0]?.elements as Array<Record<string, unknown>>;
		const textElements = tracks[1]?.elements as Array<Record<string, unknown>>;

		expect(videoElements[0]?.transitionIn).toBeNull();
		expect(videoElements[0]?.keyframes).toBeNull();
		expect(videoElements[1]?.transitionIn).toBeNull();
		expect(videoElements[1]?.keyframes).toBeNull();
		expect(textElements[0]?.transitionIn).toBeNull();
		expect(textElements[0]?.keyframes).toBeNull();
	});

	test("skips projects that are already v10", () => {
		const result = transformProjectV9ToV10({
			project: { ...v9Project, version: 10 },
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("already v10");
	});
});
