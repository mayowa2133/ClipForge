import { describe, expect, test } from "bun:test";
import { validateTimelineDiffOps } from "@/lib/clipforge";
import { buildDefaultClipForgeProjectData } from "@/lib/clipforge/project-data";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";

function buildProjectFixture(): TProject {
	return {
		metadata: {
			id: "project-1",
			name: "ClipForge Test",
			duration: 12_000,
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
						id: "video-track-1",
						type: "video",
						name: "Video",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [
							{
								id: "clip-1",
								type: "video",
								name: "Clip 1",
								mediaId: "media-1",
								duration: 6000,
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
					{
						id: "text-track-1",
						type: "text",
						name: "Text",
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
								duration: 3000,
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

function buildMediaAssets(): MediaAsset[] {
	return [
		{
			id: "media-1",
			name: "primary.mp4",
			type: "video",
			duration: 12,
			file: new File(["video"], "primary.mp4", { type: "video/mp4" }),
		},
		{
			id: "broll-1",
			name: "broll.mp4",
			type: "video",
			duration: 8,
			file: new File(["video"], "broll.mp4", { type: "video/mp4" }),
		},
		{
			id: "audio-1",
			name: "music.mp3",
			type: "audio",
			duration: 8,
			file: new File(["audio"], "music.mp3", { type: "audio/mpeg" }),
		},
	];
}

describe("validateTimelineDiffOps", () => {
	test("accepts valid operation set", () => {
		const project = buildProjectFixture();
		const result = validateTimelineDiffOps({
			project,
			ops: [
				{ type: "TRIM_CLIP", clip_id: "clip-1", in_ms: 100, out_ms: 200 },
				{
					type: "SET_CAPTION_STYLE",
					style_id: "bold-center",
					font: "Arial",
					size: 22,
					position: "center",
					outline: true,
					highlight_mode: "line",
				},
				{
					type: "FIX_CAPTION_TEXT",
					segment_id: "caption-1",
					from: "hello",
					to: "hi",
				},
			],
		});

		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.ops).toHaveLength(3);
	});

	test("rejects unsupported op type", () => {
		const project = buildProjectFixture();
		const result = validateTimelineDiffOps({
			project,
			ops: [{ type: "LAUNCH_NUKE" }],
		});

		expect(result.valid).toBe(false);
		expect(result.errors[0]?.code).toBe("unsupported_op");
	});

	test("rejects FIX_CAPTION_TEXT for non-text segment", () => {
		const project = buildProjectFixture();
		const result = validateTimelineDiffOps({
			project,
			ops: [
				{
					type: "FIX_CAPTION_TEXT",
					segment_id: "clip-1",
					from: "a",
					to: "b",
				},
			],
		});

		expect(result.valid).toBe(false);
		expect(result.errors[0]?.code).toBe("caption_segment_not_text");
	});

	test("rejects TRIM_CLIP exceeding source duration", () => {
		const project = buildProjectFixture();
		const result = validateTimelineDiffOps({
			project,
			ops: [{ type: "TRIM_CLIP", clip_id: "clip-1", in_ms: 4000, out_ms: 4000 }],
		});

		expect(result.valid).toBe(false);
		expect(result.errors[0]?.code).toBe("trim_exceeds_source");
	});

	test("accepts valid INSERT_BROLL for imported visual asset", () => {
		const project = buildProjectFixture();
		const result = validateTimelineDiffOps({
			project,
			mediaAssets: buildMediaAssets(),
			ops: [
				{
					type: "INSERT_BROLL",
					media_id: "broll-1",
					start_ms: 1000,
					end_ms: 3000,
					lane: "overlay-primary",
					fit_mode: "cover",
					mute: true,
				},
			],
		});

		expect(result.valid).toBe(true);
		expect(result.ops[0]?.type).toBe("INSERT_BROLL");
	});

	test("rejects INSERT_BROLL for missing asset", () => {
		const project = buildProjectFixture();
		const result = validateTimelineDiffOps({
			project,
			mediaAssets: buildMediaAssets(),
			ops: [
				{
					type: "INSERT_BROLL",
					media_id: "missing",
					start_ms: 1000,
					end_ms: 3000,
					lane: "overlay-primary",
					fit_mode: "cover",
					mute: true,
				},
			],
		});

		expect(result.valid).toBe(false);
		expect(result.errors[0]?.code).toBe("insert_broll_missing_asset");
	});

	test("rejects INSERT_BROLL for audio assets", () => {
		const project = buildProjectFixture();
		const result = validateTimelineDiffOps({
			project,
			mediaAssets: buildMediaAssets(),
			ops: [
				{
					type: "INSERT_BROLL",
					media_id: "audio-1",
					start_ms: 1000,
					end_ms: 3000,
					lane: "overlay-primary",
					fit_mode: "cover",
					mute: true,
				},
			],
		});

		expect(result.valid).toBe(false);
		expect(result.errors[0]?.code).toBe("insert_broll_asset_not_visual");
	});

	test("rejects INSERT_BROLL with invalid ranges or enums", () => {
		const project = buildProjectFixture();
		const mediaAssets = buildMediaAssets();
		const invalidRange = validateTimelineDiffOps({
			project,
			mediaAssets,
			ops: [
				{
					type: "INSERT_BROLL",
					media_id: "broll-1",
					start_ms: 3000,
					end_ms: 3000,
					lane: "overlay-primary",
					fit_mode: "cover",
					mute: true,
				},
			],
		});
		const invalidLane = validateTimelineDiffOps({
			project,
			mediaAssets,
			ops: [
				{
					type: "INSERT_BROLL",
					media_id: "broll-1",
					start_ms: 1000,
					end_ms: 3000,
					lane: "overlay-secondary",
					fit_mode: "cover",
					mute: true,
				},
			],
		});
		const invalidFitMode = validateTimelineDiffOps({
			project,
			mediaAssets,
			ops: [
				{
					type: "INSERT_BROLL",
					media_id: "broll-1",
					start_ms: 1000,
					end_ms: 3000,
					lane: "overlay-primary",
					fit_mode: "contain",
					mute: true,
				},
			],
		});

		expect(invalidRange.errors[0]?.code).toBe("insert_broll_invalid_range");
		expect(invalidLane.errors[0]?.code).toBe("insert_broll_invalid_lane");
		expect(invalidFitMode.errors[0]?.code).toBe("insert_broll_invalid_fit_mode");
	});
});
