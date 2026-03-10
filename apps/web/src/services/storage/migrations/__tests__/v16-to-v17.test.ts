import { describe, expect, test } from "bun:test";
import { transformProjectV16ToV17 } from "../transformers/v16-to-v17";
import { buildDefaultProjectVersionPack } from "@/constants/project-constants";

const v16Project = {
	id: "project-v16-123",
	version: 16,
	metadata: {
		id: "project-v16-123",
		name: "My V16 Project",
		duration: 14,
		createdAt: "2026-03-10T10:00:00.000Z",
		updatedAt: "2026-03-10T12:00:00.000Z",
	},
	settings: {
		fps: 30,
		canvasSize: { width: 1080, height: 1920 },
		background: { type: "color", color: "#000000" },
	},
	scenes: [
		{
			id: "scene-1",
			name: "Scene 1",
			isMain: true,
			bookmarks: [],
			createdAt: "2026-03-10T10:00:00.000Z",
			updatedAt: "2026-03-10T12:00:00.000Z",
			tracks: [
				{
					id: "text-track-1",
					name: "Text",
					type: "text",
					hidden: false,
					elements: [
						{
							id: "text-1",
							type: "text",
							name: "Title",
							content: "Hello",
							duration: 2,
							startTime: 0,
							trimStart: 0,
							trimEnd: 0,
							fontSize: 14,
							fontFamily: "Arial",
							color: "#ffffff",
							background: { color: "#000000" },
							textAlign: "center",
							fontWeight: "bold",
							fontStyle: "normal",
							textDecoration: "none",
							transform: {
								scale: 1,
								rotate: 0,
								position: { x: 0, y: 0 },
							},
							opacity: 1,
						},
					],
				},
			],
		},
	],
};

describe("V16 to V17 migration", () => {
	test("adds default version pack and version overrides", () => {
		const result = transformProjectV16ToV17({ project: v16Project });

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(17);
		expect((result.project.settings as any).versionPack).toEqual(
			buildDefaultProjectVersionPack({
				canvasSize: { width: 1080, height: 1920 },
			}),
		);
		expect(
			(result.project.scenes as any)[0].tracks[0].elements[0].versionOverrides,
		).toBeNull();
	});
});
