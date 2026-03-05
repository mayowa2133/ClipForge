import { describe, expect, test } from "bun:test";
import {
	applyTimelineDiffPatch,
	buildDefaultClipForgeProjectData,
	buildTimelineDiffPatch,
	revertTimelineDiffPatch,
} from "@/lib/clipforge";
import type { MediaAsset } from "@/types/assets";
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

function buildMediaAssets(): MediaAsset[] {
	return [
		{
			id: "media-a",
			name: "A.mp4",
			type: "video",
			duration: 8,
			file: new File(["video"], "A.mp4", { type: "video/mp4" }),
		},
		{
			id: "media-b",
			name: "B.mp4",
			type: "video",
			duration: 7,
			file: new File(["video"], "B.mp4", { type: "video/mp4" }),
		},
		{
			id: "broll-1",
			name: "broll.mp4",
			type: "video",
			duration: 5,
			file: new File(["video"], "broll.mp4", { type: "video/mp4" }),
		},
	];
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
		expect(videoTrack?.elements.some((element) => element.startTime === 7)).toBe(
			true,
		);
		expect(videoTrack?.elements.some((element) => element.startTime === 13)).toBe(
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

	test("INSERT_BROLL creates or reuses an overlay video track", () => {
		const project = buildProjectFixture();
		const mediaAssets = buildMediaAssets();
		const patch = buildTimelineDiffPatch({
			project,
			mediaAssets,
			ops: [
				{
					type: "INSERT_BROLL",
					media_id: "broll-1",
					start_ms: 2000,
					end_ms: 5000,
					lane: "overlay-primary",
					fit_mode: "cover",
					mute: true,
				},
			],
			now: new Date("2026-02-01T02:00:00.000Z"),
		});

		const applied = applyTimelineDiffPatch({ patch });
		const activeScene =
			applied.scenes.find((scene) => scene.id === applied.currentSceneId) ??
			applied.scenes[0];
		const overlayTrack = activeScene.tracks.find(
			(track) => track.type === "video" && track.isMain === false,
		);

		expect(overlayTrack?.type).toBe("video");
		if (overlayTrack?.type === "video") {
			expect(overlayTrack.elements).toHaveLength(1);
			expect(overlayTrack.elements[0]).toMatchObject({
				type: "video",
				mediaId: "broll-1",
				startTime: 2,
				duration: 3,
				muted: true,
			});
		}

		expect(revertTimelineDiffPatch({ patch })).toEqual(patch.before);
	});

	test("INSERT_BROLL reuses an existing overlay track when windows do not overlap", () => {
		const project = buildProjectFixture();
		project.scenes[0].tracks.unshift({
			id: "overlay-track",
			type: "video",
			name: "Overlay",
			isMain: false,
			muted: false,
			hidden: false,
			elements: [
				{
					id: "overlay-segment",
					type: "video",
					name: "Overlay Seed",
					mediaId: "broll-1",
					duration: 2,
					startTime: 6,
					trimStart: 0,
					trimEnd: 0,
					muted: true,
					hidden: false,
					transform: {
						scale: 1,
						position: { x: 0, y: 0 },
						rotate: 0,
					},
					opacity: 1,
				},
			],
		});

		const patch = buildTimelineDiffPatch({
			project,
			mediaAssets: buildMediaAssets(),
			ops: [
				{
					type: "INSERT_BROLL",
					media_id: "broll-1",
					start_ms: 2000,
					end_ms: 4000,
					lane: "overlay-primary",
					fit_mode: "cover",
					mute: true,
				},
			],
		});
		const applied = applyTimelineDiffPatch({ patch });
		const activeScene =
			applied.scenes.find((scene) => scene.id === applied.currentSceneId) ??
			applied.scenes[0];
		const overlayTracks = activeScene.tracks.filter(
			(track) => track.type === "video" && track.isMain === false,
		);

		expect(overlayTracks).toHaveLength(1);
		if (overlayTracks[0]?.type === "video") {
			expect(overlayTracks[0].elements).toHaveLength(2);
		}
	});

	test("ADD_TEXT_OVERLAY reuses an existing text track and remains undoable", () => {
		const project = buildProjectFixture();
		const patch = buildTimelineDiffPatch({
			project,
			ops: [
				{
					type: "ADD_TEXT_OVERLAY",
					text: "this",
					start_ms: 2000,
					end_ms: 5000,
					position: "top",
					style_id: "overlay-top",
					font: "Arial",
					size: 64,
					color: "#FFFFFF",
					outline: true,
					background: false,
				},
			],
		});
		const applied = applyTimelineDiffPatch({ patch });
		const activeScene =
			applied.scenes.find((scene) => scene.id === applied.currentSceneId) ??
			applied.scenes[0];
		const textTrack = activeScene.tracks.find((track) => track.type === "text");

		expect(textTrack?.type).toBe("text");
		if (textTrack?.type === "text") {
			expect(textTrack.elements).toHaveLength(2);
			expect(textTrack.elements[1]).toMatchObject({
				content: "this",
				startTime: 2,
				duration: 3,
				transform: {
					position: {
						x: 0,
						y: -345.6,
					},
				},
			});
		}

		expect(revertTimelineDiffPatch({ patch })).toEqual(patch.before);
	});
});
