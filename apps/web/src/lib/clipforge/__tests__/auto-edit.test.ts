import { describe, expect, test } from "bun:test";
import { buildAutoEditTikTokDraft, buildDefaultClipForgeProjectData } from "@/lib/clipforge";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";

function buildProjectFixture(): TProject {
	return {
		metadata: {
			id: "project-auto-edit-1",
			name: "Auto Edit",
			duration: 0,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-main",
				name: "Main",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				updatedAt: new Date("2026-01-01T00:00:00.000Z"),
				tracks: [
					{
						id: "video-track-main",
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
			canvasSize: { width: 1920, height: 1080 },
			background: { type: "color", color: "#000000" },
		},
		version: 8,
		clipforge: buildDefaultClipForgeProjectData(),
	};
}

function makeVideoAsset({
	id,
	name,
	duration,
}: {
	id: string;
	name: string;
	duration: number;
}): MediaAsset {
	return {
		id,
		name,
		type: "video",
		duration,
		file: new File(["video"], `${name}.mp4`, { type: "video/mp4" }),
	};
}

describe("buildAutoEditTikTokDraft", () => {
	test("stitches video clips in stable name order and applies tik tok preset", () => {
		const project = buildProjectFixture();
		const mediaAssets: MediaAsset[] = [
			makeVideoAsset({ id: "clip-b", name: "b_clip", duration: 3 }),
			makeVideoAsset({ id: "clip-a", name: "a_clip", duration: 2 }),
			{
				id: "image-1",
				name: "cover",
				type: "image",
				file: new File(["img"], "cover.png", { type: "image/png" }),
			},
		];

		const drafted = buildAutoEditTikTokDraft({ project, mediaAssets });
		const activeScene =
			drafted.scenes.find((scene) => scene.id === drafted.currentSceneId) ??
			drafted.scenes[0];
		const mainTrack = activeScene.tracks.find(
			(track) => track.type === "video" && track.isMain,
		);

		expect(drafted.settings.canvasSize).toEqual({ width: 1080, height: 1920 });
		expect(mainTrack?.type).toBe("video");
		if (mainTrack?.type === "video") {
			expect(mainTrack.elements).toHaveLength(2);
			expect(mainTrack.elements[0].mediaId).toBe("clip-a");
			expect(mainTrack.elements[0].startTime).toBe(0);
			expect(mainTrack.elements[1].mediaId).toBe("clip-b");
			expect(mainTrack.elements[1].startTime).toBe(2);
		}

		const audit = drafted.clipforge?.opsAudit.at(-1);
		expect(audit?.source).toBe("auto-edit");
		expect(audit?.ops.map((op) => op.type)).toEqual([
			"SET_ASPECT_RATIO",
			"REMOVE_SILENCE",
		]);
	});
});
