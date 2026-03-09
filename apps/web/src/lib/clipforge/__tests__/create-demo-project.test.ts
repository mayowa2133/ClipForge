import { describe, expect, test } from "bun:test";
import {
	buildDefaultClipForgeProjectData,
	createClipForgeDemoProject,
} from "@/lib/clipforge";
import type { MediaAsset } from "@/types/assets";
import type { ClipMediaMetadata } from "@/types/clipforge";
import type { TProject } from "@/types/project";

function buildProjectFixture(): TProject {
	return {
		metadata: {
			id: "demo-project",
			name: "ClipForge Demo",
			duration: 0,
			createdAt: new Date("2026-03-03T00:00:00.000Z"),
			updatedAt: new Date("2026-03-03T00:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-main",
				name: "Main scene",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-03-03T00:00:00.000Z"),
				updatedAt: new Date("2026-03-03T00:00:00.000Z"),
				tracks: [],
			},
		],
		currentSceneId: "scene-main",
		settings: {
			fps: 30,
			canvasSize: { width: 1080, height: 1920 },
			background: { type: "color", color: "#000000" },
		},
		version: 8,
		clipforge: buildDefaultClipForgeProjectData(),
	};
}

describe("createClipForgeDemoProject", () => {
	test("creates a new project, imports primary clips first, and seeds metadata", async () => {
		const currentProject = buildProjectFixture();
		const importedAssets: MediaAsset[] = [];
		const events: string[] = [];

		const editor = {
			project: {
				createNewProject: async ({ name }: { name: string }) => {
					events.push(`create:${name}`);
					currentProject.metadata.name = name;
					return currentProject.metadata.id;
				},
				getActive: () => currentProject,
				saveCurrentProject: async () => {
					events.push("save");
				},
			},
			media: {
				addMediaAsset: async ({
					projectId,
					asset,
				}: {
					projectId: string;
					asset: Omit<MediaAsset, "id">;
				}) => {
					const imported: MediaAsset = {
						id: `${projectId}-${asset.name}`,
						...asset,
					};
					importedAssets.push(imported);
					events.push(`import:${asset.name}`);
					return imported;
				},
			},
			timeline: {} as any,
			clipforge: {
				initializeMediaMetadata: ({
					mediaAssets,
				}: {
					mediaAssets: MediaAsset[];
				}) => {
					events.push(`init:${mediaAssets.map((asset) => asset.name).join(",")}`);
				},
				seedMediaMetadata: ({
					mediaId,
					metadata,
				}: {
					mediaId: string;
					metadata: ClipMediaMetadata;
				}) => {
					currentProject.clipforge!.mediaMetadataById[mediaId] = metadata;
					events.push(`seed:${mediaId}`);
				},
				autoEditTikTokDraft: () => {
					const primaryAssets = importedAssets.filter((asset) =>
						asset.name.startsWith("clip-"),
					);
					currentProject.scenes[0].tracks = [
						{
							id: "video-main",
							type: "video",
							name: "Main video",
							isMain: true,
							muted: false,
							hidden: false,
							elements: primaryAssets.map((asset, index) => ({
								id: `video-${index + 1}`,
								type: "video",
								name: asset.name,
								mediaId: asset.id,
								duration: 1.2,
								startTime: index * 1.2,
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
							})),
						},
					];
					events.push("auto-edit");
				},
				generateSceneCaptions: ({
					template,
				}: {
					language?: string;
					template: "clean-bottom" | "bold-center";
					overwriteExisting: boolean;
				}) => {
					events.push(`captions:${template}`);
					return { generated: 3, trackId: "text-track-1" };
				},
			},
		};

		const processFiles = async ({
			files,
		}: {
			files: File[];
		}) =>
			files.map((file) => ({
				name: file.name,
				type: "video" as const,
				file,
				url: `blob:${file.name}`,
				duration: 2.2,
			}));

		const result = await createClipForgeDemoProject({
			editor,
			fetchImpl: ((async () =>
				new Response(new Blob(["video"], { type: "video/mp4" }), {
					status: 200,
				})) as unknown) as typeof fetch,
			processFiles,
		});

		expect(result.projectId).toBe("demo-project");
		expect(result.mediaIds).toHaveLength(4);
		expect(Object.keys(currentProject.clipforge!.mediaMetadataById)).toHaveLength(4);
		expect(events).toContain("auto-edit");
		expect(events).toContain("save");
		expect(events).toContain("captions:bold-center");
		expect(events.indexOf("auto-edit")).toBeGreaterThan(
			events.indexOf("init:clip-1.mp4,clip-2.mp4,clip-3.mp4"),
		);
		expect(events.indexOf("init:broll-1.mp4")).toBeGreaterThan(
			events.indexOf("auto-edit"),
		);
	});
});
