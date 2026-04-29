import { describe, expect, test } from "bun:test";
import {
	buildRenderGraphInput,
	defaultArtifactFileName,
	isRenderGraphInput,
} from "@/lib/clipforge/production/render-graph";
import type { TProject } from "@/types/project";

function makeProject(overrides: Partial<TProject> = {}): TProject {
	return {
		metadata: {
			id: "proj_test",
			name: "Sample Project",
			duration: 12.34,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		scenes: [],
		currentSceneId: "scene_main",
		settings: {
			fps: 30,
			canvasSize: { width: 1080, height: 1920 },
			background: { type: "color", color: "#000000" },
		},
		version: 7,
		...overrides,
	} as TProject;
}

describe("buildRenderGraphInput", () => {
	test("captures project metadata, settings, and export options", () => {
		const project = makeProject();
		const input = buildRenderGraphInput({
			project,
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "tiktok",
			mediaRefs: [{ mediaId: "asset_1", cloudStorageKey: "key_1" }],
		});
		expect(input.contractVersion).toBe(1);
		expect(input.projectId).toBe("proj_test");
		expect(input.projectName).toBe("Sample Project");
		expect(input.projectVersion).toBe(7);
		expect(input.canvasSize).toEqual({ width: 1080, height: 1920 });
		expect(input.durationSeconds).toBe(12.34);
		expect(input.publishDestination).toBe("tiktok");
		expect(input.mediaRefs).toHaveLength(1);
		expect(input.project).toBe(project);
	});

	test("defaults mediaRefs to empty array", () => {
		const input = buildRenderGraphInput({
			project: makeProject(),
			format: "mp4",
			quality: "medium",
			includeAudio: false,
			publishDestination: "generic-export",
		});
		expect(input.mediaRefs).toEqual([]);
	});
});

describe("isRenderGraphInput", () => {
	test("accepts a well-formed render graph", () => {
		const input = buildRenderGraphInput({
			project: makeProject(),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "youtube",
		});
		expect(isRenderGraphInput(input)).toBe(true);
	});

	test("rejects malformed payloads", () => {
		expect(isRenderGraphInput(null)).toBe(false);
		expect(isRenderGraphInput({})).toBe(false);
		expect(isRenderGraphInput({ contractVersion: 2 })).toBe(false);
		expect(
			isRenderGraphInput({
				contractVersion: 1,
				projectId: 123,
				projectVersion: 1,
				format: "mp4",
				quality: "high",
				includeAudio: true,
			}),
		).toBe(false);
	});
});

describe("defaultArtifactFileName", () => {
	test("uses sanitized project name and matching extension", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				metadata: {
					id: "proj_test",
					name: "My!! TikTok Draft / v3",
					duration: 1,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			}),
			format: "webm",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
		});
		expect(defaultArtifactFileName({ input })).toBe("My_TikTok_Draft_v3.webm");
	});

	test("falls back to a default name when sanitization removes everything", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				metadata: {
					id: "proj_test",
					name: "!!!!",
					duration: 1,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
		});
		expect(defaultArtifactFileName({ input })).toBe("clipforge-export.mp4");
	});
});
