import { describe, expect, test } from "bun:test";
import {
	collectMissingMediaReferences,
	isReplacementTypeAllowed,
} from "@/lib/clipforge/missing-media";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type { TimelineTrack } from "@/types/timeline";

function buildProject({
	tracks,
}: {
	tracks: TimelineTrack[];
}): TProject {
	return {
		metadata: {
			id: "project-missing-media",
			name: "Missing Media",
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
				tracks,
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
			id: "existing-video",
			name: "existing.mp4",
			type: "video",
			file: new File(["video"], "existing.mp4", { type: "video/mp4" }),
		},
	];
}

describe("collectMissingMediaReferences", () => {
	test("groups missing references by media id and sorts by earliest start", () => {
		const project = buildProject({
			tracks: [
				{
					id: "video-track-a",
					name: "Video A",
					type: "video",
					isMain: true,
					muted: false,
					hidden: false,
					elements: [
						{
							id: "segment-late",
							name: "Late",
							type: "video",
							mediaId: "missing-b",
							startTime: 5,
							duration: 2,
							trimStart: 0,
							trimEnd: 0,
							transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
							opacity: 1,
						},
					],
				},
				{
					id: "video-track-b",
					name: "Video B",
					type: "video",
					isMain: true,
					muted: false,
					hidden: false,
					elements: [
						{
							id: "segment-early-1",
							name: "Early 1",
							type: "video",
							mediaId: "missing-a",
							startTime: 1,
							duration: 2,
							trimStart: 0,
							trimEnd: 0,
							transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
							opacity: 1,
						},
						{
							id: "segment-early-2",
							name: "Early 2",
							type: "video",
							mediaId: "missing-a",
							startTime: 3,
							duration: 2,
							trimStart: 0,
							trimEnd: 0,
							transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
							opacity: 1,
						},
					],
				},
			],
		});

		const missing = collectMissingMediaReferences({
			project,
			mediaAssets: buildMediaAssets(),
		});

		expect(missing).toHaveLength(2);
		expect(missing[0]?.mediaId).toBe("missing-a");
		expect(missing[0]?.referenceCount).toBe(2);
		expect(missing[0]?.allowedReplacementTypes).toEqual(["video"]);
		expect(missing[1]?.mediaId).toBe("missing-b");
	});

	test("computes allowed replacement intersection across mixed segment kinds", () => {
		const project = buildProject({
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
							id: "video-segment",
							name: "Video Missing",
							type: "video",
							mediaId: "shared-missing",
							startTime: 0,
							duration: 2,
							trimStart: 0,
							trimEnd: 0,
							transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
							opacity: 1,
						},
					],
				},
				{
					id: "audio-track",
					name: "Audio",
					type: "audio",
					muted: false,
					elements: [
						{
							id: "audio-segment",
							name: "Audio Missing",
							type: "audio",
							sourceType: "upload",
							mediaId: "shared-missing",
							startTime: 0,
							duration: 2,
							trimStart: 0,
							trimEnd: 0,
							volume: 1,
						},
					],
				},
			],
		});

		const missing = collectMissingMediaReferences({
			project,
			mediaAssets: [],
		});
		expect(missing).toHaveLength(1);
		expect(missing[0]?.allowedReplacementTypes).toEqual(["video"]);
	});
});

describe("isReplacementTypeAllowed", () => {
	test("returns true only for allowed replacement type", () => {
		expect(
			isReplacementTypeAllowed({
				allowedReplacementTypes: ["audio", "video"],
				replacementType: "video",
			}),
		).toBe(true);
		expect(
			isReplacementTypeAllowed({
				allowedReplacementTypes: ["audio", "video"],
				replacementType: "image",
			}),
		).toBe(false);
	});
});
