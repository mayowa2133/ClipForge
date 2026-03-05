import { describe, expect, test } from "bun:test";
import {
	buildExportPreflightIssueId,
	buildProjectHealthFingerprint,
} from "@/lib/clipforge/project-health";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";

function buildProject({
	startTime = 0,
	mediaId = "media-1",
	duration = 4,
}: {
	startTime?: number;
	mediaId?: string;
	duration?: number;
} = {}): TProject {
	return {
		metadata: {
			id: "project-health",
			name: "Health",
			duration: 10,
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
						id: "track-1",
						name: "Video",
						type: "video",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [
							{
								id: "segment-1",
								name: "Clip",
								type: "video",
								mediaId,
								startTime,
								duration,
								trimStart: 0,
								trimEnd: 0,
								opacity: 1,
								transform: {
									scale: 1,
									position: { x: 0, y: 0 },
									rotate: 0,
								},
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

function buildMediaAssets(): MediaAsset[] {
	return [
		{
			id: "media-1",
			name: "clip-1.mp4",
			type: "video",
			duration: 4,
			file: new File(["video"], "clip-1.mp4", { type: "video/mp4" }),
		},
	];
}

describe("project health fingerprint", () => {
	test("changes when segment timing changes", () => {
		const mediaAssets = buildMediaAssets();
		const before = buildProjectHealthFingerprint({
			project: buildProject({ startTime: 0 }),
			mediaAssets,
		});
		const after = buildProjectHealthFingerprint({
			project: buildProject({ startTime: 1 }),
			mediaAssets,
		});
		expect(before).not.toBe(after);
	});

	test("changes when segment media id changes", () => {
		const mediaAssets = buildMediaAssets();
		const before = buildProjectHealthFingerprint({
			project: buildProject({ mediaId: "media-1" }),
			mediaAssets,
		});
		const after = buildProjectHealthFingerprint({
			project: buildProject({ mediaId: "media-2" }),
			mediaAssets,
		});
		expect(before).not.toBe(after);
	});

	test("changes when media asset list changes", () => {
		const project = buildProject();
		const before = buildProjectHealthFingerprint({
			project,
			mediaAssets: buildMediaAssets(),
		});
		const after = buildProjectHealthFingerprint({
			project,
			mediaAssets: [
				...buildMediaAssets(),
				{
					id: "media-2",
					name: "clip-2.mp4",
					type: "video",
					duration: 2,
					file: new File(["video"], "clip-2.mp4", { type: "video/mp4" }),
				},
			],
		});
		expect(before).not.toBe(after);
	});

	test("remains stable for equivalent media ordering", () => {
		const project = buildProject();
		const mediaA = buildMediaAssets();
		const mediaB = [...mediaA].reverse();

		const fingerprintA = buildProjectHealthFingerprint({
			project,
			mediaAssets: mediaA,
		});
		const fingerprintB = buildProjectHealthFingerprint({
			project,
			mediaAssets: mediaB,
		});

		expect(fingerprintA).toBe(fingerprintB);
	});
});

describe("preflight issue id", () => {
	test("is deterministic for same payload", () => {
		const first = buildExportPreflightIssueId({
			code: "missing-media-asset",
			mediaId: "missing-1",
			trackId: "track-1",
			segmentId: "segment-1",
		});
		const second = buildExportPreflightIssueId({
			code: "missing-media-asset",
			mediaId: "missing-1",
			trackId: "track-1",
			segmentId: "segment-1",
		});
		expect(first).toBe(second);
	});
});
