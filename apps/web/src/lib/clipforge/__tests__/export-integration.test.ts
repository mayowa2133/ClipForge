import { describe, expect, test } from "bun:test";
import {
	BestEffortExportIntegration,
	buildDefaultClipForgeProjectData,
} from "@/lib/clipforge";
import type { TProject } from "@/types/project";

function buildProjectFixture(): TProject {
	return {
		metadata: {
			id: "project-export-1",
			name: "Export Test",
			duration: 12,
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
				tracks: [],
			},
		],
		currentSceneId: "scene-1",
		settings: {
			fps: 30,
			canvasSize: { width: 1920, height: 1080 },
			background: { type: "color", color: "#000000" },
		},
		version: 8,
		clipforge: buildDefaultClipForgeProjectData(),
	};
}

describe("BestEffortExportIntegration", () => {
	test("falls back to preview artifact when export fails", async () => {
		const integration = new BestEffortExportIntegration();
		const project = buildProjectFixture();
		const editor = {
			project: {
				export: async () => {
					return {
						success: false,
						error: "renderer unavailable",
						diagnostics: {
							failureCode: "render-frame-failed",
							failedFrameIndex: 12,
							failedTimeSeconds: 0.4,
							backendUsed: "binary-canvas",
							audioIncluded: true,
							format: "mp4",
							quality: "high",
						},
					};
				},
				getActive: () => project,
			},
		} as any;

		const artifact = await integration.exportBestEffort({
			editor,
		});

		expect(artifact.status).toBe("preview-artifact");
		expect(artifact.fileName.endsWith(".json")).toBe(true);
		expect(artifact.fallbackReason).toBe("renderer unavailable");
		expect(artifact.diagnostics?.failureCode).toBe("render-frame-failed");
		expect(artifact.preflightResult).not.toBeNull();
		expect(artifact.attempts).toHaveLength(1);
		expect(artifact.attempts?.[0]?.result).toBe("failed");
		expect(artifact.recoveryRecommendation?.recommendedProfile).toBe(
			"safe-mp4-medium",
		);
	});

	test("returns binary artifact when core export succeeds", async () => {
		const integration = new BestEffortExportIntegration();
		const editor = {
			project: {
				export: async () => ({
					success: true,
					buffer: new Uint8Array([1, 2, 3]).buffer,
				}),
				getActive: () => buildProjectFixture(),
			},
		} as any;

		const artifact = await integration.exportBestEffort({
			editor,
			format: "mp4",
		});

		expect(artifact.status).toBe("exported");
		expect(artifact.fileName.endsWith(".mp4")).toBe(true);
		expect(artifact.diagnostics).toBeUndefined();
		expect(artifact.preflightResult).not.toBeNull();
		expect(artifact.attempts).toHaveLength(1);
		expect(artifact.attempts?.[0]?.result).toBe("success");
		expect(artifact.recoveryRecommendation).toBeNull();
	});
});
