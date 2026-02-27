import { describe, expect, test } from "bun:test";
import { validateTimelineDiffOps } from "@/lib/clipforge";
import { buildDefaultClipForgeProjectData } from "@/lib/clipforge/project-data";
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
});
