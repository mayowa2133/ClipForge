import { describe, expect, test } from "bun:test";
import {
	applyTimelineDiffPatch,
	buildDefaultClipForgeProjectData,
	buildTimelineDiffPatch,
	revertTimelineDiffPatch,
} from "@/lib/clipforge";
import type { TimelineDiffOp } from "@/types/clipforge";
import type { TProject } from "@/types/project";

function buildProjectFixture(): TProject {
	return {
		metadata: {
			id: "project-ops-1",
			name: "Ops Test",
			duration: 20_000,
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
						id: "video-track-1",
						type: "video",
						name: "Video",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [
							{
								id: "segment-a",
								type: "video",
								name: "A",
								mediaId: "media-a",
								duration: 8000,
								startTime: 0,
								trimStart: 0,
								trimEnd: 0,
								transform: {
									scale: 1,
									position: { x: 0, y: 0 },
									rotate: 0,
								},
								opacity: 1,
							},
							{
								id: "segment-b",
								type: "video",
								name: "B",
								mediaId: "media-b",
								duration: 7000,
								startTime: 9000,
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
					{
						id: "text-track-1",
						type: "text",
						name: "Captions",
						hidden: false,
						elements: [
							{
								id: "caption-1",
								type: "text",
								name: "Caption",
								content: "hello world",
								fontSize: 18,
								fontFamily: "Arial",
								color: "#ffffff",
								background: { color: "transparent" },
								textAlign: "center",
								fontWeight: "normal",
								fontStyle: "normal",
								textDecoration: "none",
								duration: 4000,
								startTime: 0,
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

describe("timeline op engine", () => {
	test("builds deterministic patch and supports apply/revert", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{ type: "MOVE_SEGMENT", segment_id: "segment-b", to_ms: 7000 },
			{ type: "DUPLICATE_SEGMENT", segment_id: "segment-a", to_ms: 13000 },
			{
				type: "FIX_CAPTION_TEXT",
				segment_id: "caption-1",
				from: "hello",
				to: "yo",
			},
			{ type: "SET_ASPECT_RATIO", preset: "9:16" },
		];

		const patch = buildTimelineDiffPatch({
			project,
			ops,
			source: "chat",
			now: new Date("2026-02-01T00:00:00.000Z"),
		});
		const applied = applyTimelineDiffPatch({ patch });
		const reverted = revertTimelineDiffPatch({ patch });

		const activeScene =
			applied.scenes.find((scene) => scene.id === applied.currentSceneId) ??
			applied.scenes[0];
		const videoTrack = activeScene.tracks.find((track) => track.id === "video-track-1");
		const textTrack = activeScene.tracks.find((track) => track.id === "text-track-1");

		expect(applied.settings.canvasSize).toEqual({ width: 1080, height: 1920 });
		expect(videoTrack?.elements.length).toBe(3);
		expect(videoTrack?.elements.some((element) => element.startTime === 7000)).toBe(
			true,
		);
		expect(textTrack?.type).toBe("text");
		if (textTrack?.type === "text") {
			expect(textTrack.elements[0].content).toBe("yo world");
		}

		expect(reverted).toEqual(patch.before);
	});

	test("MAKE_VERSION trims timeline to target duration", () => {
		const project = buildProjectFixture();
		const patch = buildTimelineDiffPatch({
			project,
			ops: [
				{
					type: "MAKE_VERSION",
					duration_target_s: 8,
					aggressiveness: 0.7,
				},
			],
			now: new Date("2026-02-01T01:00:00.000Z"),
		});

		const applied = applyTimelineDiffPatch({ patch });
		expect(applied.metadata.duration).toBeLessThanOrEqual(8000);
	});
});
