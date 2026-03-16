import { describe, expect, test } from "bun:test";
import { buildDefaultClipForgeProjectData } from "@/lib/clipforge";
import { ProjectManager } from "@/core/managers/project-manager";
import { storageService } from "@/services/storage/service";
import type { TProject } from "@/types/project";

function buildProjectFixture(): TProject {
	return {
		metadata: {
			id: "project-save-1",
			name: "Persistence Test",
			duration: 0,
			createdAt: new Date("2026-03-13T00:00:00.000Z"),
			updatedAt: new Date("2026-03-13T00:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-main",
				name: "Main",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-03-13T00:00:00.000Z"),
				updatedAt: new Date("2026-03-13T00:00:00.000Z"),
				tracks: [
					{
						id: "track-video",
						type: "video",
						name: "Main video",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [],
					},
				],
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

describe("ProjectManager.saveCurrentProject", () => {
	test("persists the active scene from the live timeline tracks", async () => {
		const originalSaveProject = storageService.saveProject;
		const originalLoadAllTemplates = storageService.loadAllTemplates;
		const savedProjects: TProject[] = [];
		storageService.saveProject = (async ({ project }) => {
			savedProjects.push(project);
		}) as typeof storageService.saveProject;
		storageService.loadAllTemplates = (async () => []) as typeof storageService.loadAllTemplates;

		try {
			const project = buildProjectFixture();
			const liveTracks = [
				{
					id: "track-video",
					type: "video" as const,
					name: "Main video",
					isMain: true,
					muted: false,
					hidden: false,
					elements: [
						{
							id: "video-1",
							type: "video" as const,
							name: "Opener",
							mediaId: "asset-1",
							startTime: 0,
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
			];
			const manager = new ProjectManager({
				scenes: {
					getScenes: () => project.scenes,
				},
				timeline: {
					getTracks: () => liveTracks,
				},
			} as any);
			manager.setActiveProject({ project });

			await manager.saveCurrentProject();

			expect(savedProjects).toHaveLength(1);
			expect(savedProjects[0]?.scenes[0]?.tracks[0]?.elements).toHaveLength(1);
			expect(savedProjects[0]?.scenes[0]?.tracks[0]?.elements[0]).toMatchObject({
				id: "video-1",
				type: "video",
				mediaId: "asset-1",
			});
		} finally {
			storageService.saveProject = originalSaveProject;
			storageService.loadAllTemplates = originalLoadAllTemplates;
		}
	});
});
