import { describe, expect, test } from "bun:test";
import {
	buildProjectRenderGraph,
	buildRenderGraph,
	graphHasVideo,
} from "@/services/renderer/render-graph";
import type { MediaAsset } from "@/types/assets";
import type { TimelineTrack, TScene } from "@/types/timeline";

const baseTransform = {
	scale: 1,
	position: { x: 0, y: 0 },
	rotate: 0,
} as const;

function buildMediaAsset({
	id,
	name,
	type,
}: {
	id: string;
	name: string;
	type: MediaAsset["type"];
}): MediaAsset {
	return {
		id,
		name,
		type,
		file: new File(["x"], name, { type: "application/octet-stream" }),
		url: `blob:${id}`,
	};
}

describe("buildRenderGraph", () => {
	test("omits hidden tracks and elements while preserving preview payload hints", () => {
		const tracks: TimelineTrack[] = [
			{
				id: "text-track",
				type: "text",
				name: "Text",
				hidden: false,
				elements: [
					{
						id: "text-1",
						type: "text",
						name: "Caption",
						content: "hello",
						startTime: 2,
						duration: 1,
						trimStart: 0,
						trimEnd: 0,
						fontSize: 42,
						fontFamily: "Geist",
						color: "#fff",
						background: { color: "#000" },
						textAlign: "center",
						fontWeight: "bold",
						fontStyle: "normal",
						textDecoration: "none",
						transform: baseTransform,
						opacity: 1,
						hidden: false,
					},
				],
			},
			{
				id: "overlay-track",
				type: "video",
				name: "Overlay",
				isMain: false,
				muted: false,
				hidden: false,
				elements: [
					{
						id: "image-2",
						type: "image",
						name: "Cover",
						mediaId: "image-2",
						startTime: 0.5,
						duration: 2,
						trimStart: 0,
						trimEnd: 0,
						adjustments: {
							exposure: 0.2,
							contrast: 0,
							saturation: 0,
							temperature: 0,
							tint: 0,
							highlights: 0,
							shadows: 0,
						},
						effects: [{ id: "fx-blur", kind: "blur", enabled: true, radius: 8 }],
						transform: baseTransform,
						opacity: 0.8,
						hidden: false,
					},
					{
						id: "image-1",
						type: "image",
						name: "Hidden",
						mediaId: "image-1",
						startTime: 0,
						duration: 1,
						trimStart: 0,
						trimEnd: 0,
						transform: baseTransform,
						opacity: 1,
						hidden: true,
					},
				],
			},
			{
				id: "main-track",
				type: "video",
				name: "Main",
				isMain: true,
				muted: false,
				hidden: false,
				elements: [
					{
						id: "video-1",
						type: "video",
						name: "Primary",
						mediaId: "video-1",
						startTime: 1,
						duration: 3,
						trimStart: 0.25,
						trimEnd: 0.1,
						transform: baseTransform,
						opacity: 1,
						muted: false,
					},
				],
			},
			{
				id: "hidden-track",
				type: "sticker",
				name: "Hidden stickers",
				hidden: true,
				elements: [],
			},
		];

		const graph = buildRenderGraph({
			canvasSize: { width: 1080, height: 1920 },
			tracks,
			mediaAssets: [
				buildMediaAsset({ id: "video-1", name: "video.mp4", type: "video" }),
				buildMediaAsset({ id: "image-1", name: "a.png", type: "image" }),
				buildMediaAsset({ id: "image-2", name: "b.png", type: "image" }),
			],
			duration: 4,
			background: { type: "color", color: "#111111" },
			isPreview: true,
		});

		expect(graph.layers.map((layer) => layer.id)).toEqual([
			"video-1",
			"image-2",
			"text-1",
		]);
		expect(graph.layers[0]).toMatchObject({
			kind: "video",
			startTime: 1,
			duration: 3,
			trimStart: 0.25,
			trimEnd: 0.1,
		});
		expect(graph.layers[1]).toMatchObject({
			kind: "image",
			payload: {
				mediaId: "image-2",
				maxSourceSize: 2048,
				adjustments: {
					exposure: 0.2,
				},
				effects: [{ kind: "blur", radius: 8 }],
			},
		});
		expect(graph.layers[2]).toMatchObject({
			kind: "text",
			payload: {
				canvasCenter: { x: 540, y: 960 },
				canvasHeight: 1920,
				textBaseline: "middle",
			},
		});
		expect(graphHasVideo({ graph })).toBe(true);
	});

	test("normalizes blur backgrounds with the configured intensity", () => {
		const graph = buildRenderGraph({
			canvasSize: { width: 1920, height: 1080 },
			tracks: [],
			mediaAssets: [],
			duration: 1,
			background: { type: "blur", blurIntensity: 24 },
		});

		expect(graph.background).toEqual({
			type: "blur",
			blurIntensity: 24,
		});
		expect(graphHasVideo({ graph })).toBe(false);
	});

	test("builds a project graph from ordered scenes", () => {
		const scenes: TScene[] = [
			{
				id: "scene-1",
				name: "Intro",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				updatedAt: new Date("2026-01-01T00:00:00.000Z"),
				tracks: [
					{
						id: "track-1",
						type: "video",
						name: "Main",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [
							{
								id: "video-1",
								type: "video",
								name: "A",
								mediaId: "video-1",
								startTime: 0,
								duration: 2,
								trimStart: 0,
								trimEnd: 0,
								transform: baseTransform,
								opacity: 1,
							},
						],
					},
				],
			},
			{
				id: "scene-2",
				name: "Body",
				isMain: false,
				bookmarks: [],
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				updatedAt: new Date("2026-01-01T00:00:00.000Z"),
				tracks: [
					{
						id: "track-2",
						type: "video",
						name: "Main",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [
							{
								id: "video-2",
								type: "video",
								name: "B",
								mediaId: "video-1",
								startTime: 0,
								duration: 3,
								trimStart: 0,
								trimEnd: 0,
								transform: baseTransform,
								opacity: 1,
							},
						],
					},
				],
			},
		];

		const graph = buildProjectRenderGraph({
			scenes,
			mediaAssets: [buildMediaAsset({ id: "video-1", name: "video.mp4", type: "video" })],
			canvasSize: { width: 1080, height: 1920 },
			background: { type: "color", color: "#000000" },
		});

		expect(graph.scope).toBe("project");
		expect(graph.duration).toBe(5);
		expect(graph.layers.map((layer) => layer.id).sort()).toEqual(["video-1", "video-2"]);
		expect(graph.layers.find((layer) => layer.id === "video-2")?.startTime).toBe(2);
	});
});
