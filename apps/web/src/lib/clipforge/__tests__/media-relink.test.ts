import { describe, expect, test } from "bun:test";
import { buildEmptyMediaMetadata } from "@/lib/clipforge";
import type { EditorCore } from "@/core";
import { ClipForgeManager } from "@/core/managers/clipforge-manager";
import type { TProject } from "@/types/project";
import type { MediaAsset } from "@/types/assets";
import type { ClipMediaMetadata } from "@/types/clipforge";

function buildProjectFixture(): TProject {
	return {
		metadata: {
			id: "project-relink",
			name: "Relink",
			duration: 6,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-1",
				name: "Main",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				updatedAt: new Date("2026-01-01T00:00:00.000Z"),
				tracks: [
					{
						id: "video-track",
						name: "Video",
						type: "video",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [
							{
								id: "segment-1",
								name: "Segment 1",
								type: "video",
								mediaId: "missing-media-1",
								startTime: 0,
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
				],
			},
		],
		currentSceneId: "scene-1",
		settings: {
			fps: 30,
			canvasSize: { width: 1080, height: 1920 },
			background: { type: "color", color: "#000000" },
		},
		version: 8,
	};
}

function buildReplacementAsset(): Omit<MediaAsset, "id"> {
	return {
		name: "replacement.mp4",
		type: "video",
		file: new File(["video"], "replacement.mp4", { type: "video/mp4" }),
		duration: 2,
	};
}

describe("ClipForgeManager relinkMissingMediaReference", () => {
	test("relinks to same media id and resets metadata", async () => {
		const activeProject = buildProjectFixture();
		const upsertCalls: Array<{ mediaId: string; metadata: ClipMediaMetadata }> = [];
		const fakeEditor = {
			project: {
				getActive: () => activeProject,
			},
			media: {
				getAssets: () => [],
				relinkMediaAsset: async () =>
					({
						id: "missing-media-1",
						...buildReplacementAsset(),
					}) as MediaAsset,
			},
			save: {
				markDirty: () => {},
			},
		};

		const manager = new ClipForgeManager(fakeEditor as unknown as EditorCore);
		manager.upsertMediaMetadata = ({
			mediaId,
			metadata,
		}: {
			mediaId: string;
			metadata: ClipMediaMetadata;
		}) => {
			upsertCalls.push({ mediaId, metadata });
		};

		const result = await manager.relinkMissingMediaReference({
			mediaId: "missing-media-1",
			replacementAsset: buildReplacementAsset(),
		});

		expect(result).toEqual({
			mediaId: "missing-media-1",
			restoredReferences: 1,
		});
		expect(upsertCalls).toHaveLength(1);
		expect(upsertCalls[0]).toEqual({
			mediaId: "missing-media-1",
			metadata: buildEmptyMediaMetadata(),
		});
	});

	test("rejects incompatible replacement media type", async () => {
		const activeProject = buildProjectFixture();
		const fakeEditor = {
			project: {
				getActive: () => activeProject,
			},
			media: {
				getAssets: () => [],
				relinkMediaAsset: async () => null,
			},
			save: {
				markDirty: () => {},
			},
		};

		const manager = new ClipForgeManager(fakeEditor as unknown as EditorCore);
		await expect(
			manager.relinkMissingMediaReference({
				mediaId: "missing-media-1",
				replacementAsset: {
					name: "replacement.png",
					type: "image",
					file: new File(["image"], "replacement.png", { type: "image/png" }),
				},
			}),
		).rejects.toThrow("incompatible");
	});
});
