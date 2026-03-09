import { describe, expect, test } from "bun:test";
import { transformProjectV11ToV12 } from "../transformers/v11-to-v12";

const v11Project = {
	id: "project-v11-123",
	version: 11,
	metadata: {
		id: "project-v11-123",
		name: "My V11 Project",
		duration: 12,
		createdAt: "2026-03-09T10:00:00.000Z",
		updatedAt: "2026-03-09T12:00:00.000Z",
	},
	scenes: [
		{
			id: "scene-main",
			name: "Main scene",
			isMain: true,
			bookmarks: [],
			createdAt: "2026-03-09T10:00:00.000Z",
			updatedAt: "2026-03-09T12:00:00.000Z",
			tracks: [
				{
					id: "text-track",
					type: "text",
					name: "Text",
					hidden: false,
					elements: [
						{
							id: "text-1",
							type: "text",
							name: "Title",
							content: "hello",
							startTime: 0,
							duration: 1,
							trimStart: 0,
							trimEnd: 0,
							fontSize: 18,
							fontFamily: "Arial",
							fontWeight: "normal",
							fontStyle: "normal",
							textDecoration: "none",
							textAlign: "center",
							color: "#ffffff",
							background: { color: "transparent" },
							transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
							opacity: 1,
						},
					],
				},
			],
		},
	],
	clipforge: {
		schemaVersion: 3,
		mediaMetadataById: {},
		captionStylesById: {},
		activeCaptionStyleId: "clean-bottom",
		opsAudit: [],
	},
};

describe("V11 to V12 Migration", () => {
	test("adds caption defaults to text elements and clipforge project data", () => {
		const result = transformProjectV11ToV12({ project: v11Project });
		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(12);

		const scenes = result.project.scenes as Array<Record<string, unknown>>;
		const tracks = scenes[0]?.tracks as Array<Record<string, unknown>>;
		const textElements = tracks[0]?.elements as Array<Record<string, unknown>>;
		expect(textElements[0]?.role).toBe("text");
		expect(textElements[0]?.captionTiming).toBeNull();
		expect(
			(result.project.clipforge as Record<string, unknown>).captionTrackIdsBySceneId,
		).toEqual({});
	});

	test("adopts a high-confidence legacy captions track during migration", () => {
		const project = {
			...v11Project,
			clipforge: {
				...v11Project.clipforge,
				captionTrackIdsBySceneId: {},
			},
			scenes: [
				{
					...v11Project.scenes[0],
					tracks: [
						{
							id: "captions-track",
							type: "text",
							name: "Captions",
							hidden: false,
							elements: [
								{
									...(v11Project.scenes[0] as any).tracks[0].elements[0],
									id: "caption-1",
									name: "Caption 1",
									content: "hello there",
									duration: 1.2,
									startTime: 0,
								},
								{
									...(v11Project.scenes[0] as any).tracks[0].elements[0],
									id: "caption-2",
									name: "Caption 2",
									content: "welcome back",
									duration: 1.3,
									startTime: 1.3,
								},
							],
						},
					],
				},
			],
		};
		const result = transformProjectV11ToV12({ project });
		const scenes = result.project.scenes as Array<Record<string, unknown>>;
		const tracks = scenes[0]?.tracks as Array<Record<string, unknown>>;
		const textElements = tracks[0]?.elements as Array<Record<string, unknown>>;

		expect(textElements[0]?.role).toBe("caption");
		expect(textElements[1]?.role).toBe("caption");
		expect(
			((result.project.clipforge as Record<string, any>).captionTrackIdsBySceneId ?? {})["scene-main"],
		).toBe("captions-track");
	});

	test("adopts generic text tracks with caption-like element names during migration", () => {
		const project = {
			...v11Project,
			clipforge: {
				...v11Project.clipforge,
				captionTrackIdsBySceneId: {},
			},
			scenes: [
				{
					...v11Project.scenes[0],
					tracks: [
						{
							id: "legacy-text-track",
							type: "text",
							name: "Text track",
							hidden: false,
							elements: [
								{
									...(v11Project.scenes[0] as any).tracks[0].elements[0],
									id: "caption-1",
									name: "Caption 1",
									content: "hello there",
									duration: 1.2,
									startTime: 0,
								},
								{
									...(v11Project.scenes[0] as any).tracks[0].elements[0],
									id: "caption-2",
									name: "Caption 2",
									content: "welcome back",
									duration: 1.3,
									startTime: 1.3,
								},
							],
						},
					],
				},
			],
		};
		const result = transformProjectV11ToV12({ project });
		const scenes = result.project.scenes as Array<Record<string, unknown>>;
		const tracks = scenes[0]?.tracks as Array<Record<string, unknown>>;
		const textElements = tracks[0]?.elements as Array<Record<string, unknown>>;

		expect(textElements[0]?.role).toBe("caption");
		expect(textElements[1]?.role).toBe("caption");
		expect(
			((result.project.clipforge as Record<string, any>).captionTrackIdsBySceneId ?? {})["scene-main"],
		).toBe("legacy-text-track");
	});
});
