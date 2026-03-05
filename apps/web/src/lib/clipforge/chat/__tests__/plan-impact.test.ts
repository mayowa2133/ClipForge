import { describe, expect, test } from "bun:test";
import { buildPlanImpactPreview } from "@/lib/clipforge/chat/plan-impact";
import type { MediaAsset } from "@/types/assets";
import type { TimelineDiffOp } from "@/types/clipforge";
import type { TProject } from "@/types/project";

function createProject(): TProject {
	return {
		version: 1,
		currentSceneId: "scene-1",
		settings: {
			fps: 30,
			canvasSize: { width: 1080, height: 1920 },
			originalCanvasSize: { width: 1080, height: 1920 },
			background: { type: "color", color: "#000000" },
		},
		metadata: {
			id: "project-1",
			name: "Preview test",
			duration: 8,
			createdAt: new Date("2026-03-05T00:00:00.000Z"),
			updatedAt: new Date("2026-03-05T00:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-1",
				name: "Main",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-03-05T00:00:00.000Z"),
				updatedAt: new Date("2026-03-05T00:00:00.000Z"),
				tracks: [
					{
						id: "track-video",
						name: "Video",
						type: "video",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [
							{
								id: "clip-1",
								name: "Clip 1",
								type: "video",
								mediaId: "asset-1",
								startTime: 0,
								duration: 4,
								trimStart: 0,
								trimEnd: 0,
								hidden: false,
								transform: {
									scale: 1,
									position: { x: 0, y: 0 },
									rotate: 0,
								},
								opacity: 1,
							},
							{
								id: "clip-2",
								name: "Clip 2",
								type: "video",
								mediaId: "asset-2",
								startTime: 4,
								duration: 4,
								trimStart: 0,
								trimEnd: 0,
								hidden: false,
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
						id: "track-text",
						name: "Captions",
						type: "text",
						hidden: false,
						elements: [
							{
								id: "cap-1",
								name: "Caption 1",
								type: "text",
								startTime: 1,
								duration: 1,
								trimStart: 0,
								trimEnd: 0,
								content: "teh demo",
								fontSize: 64,
								fontFamily: "Arial",
								color: "#FFFFFF",
								background: { color: "transparent" },
								textAlign: "center",
								fontWeight: "bold",
								fontStyle: "normal",
								textDecoration: "none",
								transform: {
									scale: 1,
									position: { x: 0, y: 0 },
									rotate: 0,
								},
								opacity: 1,
								hidden: false,
							},
						],
					},
				],
			},
		],
	};
}

function createMediaAssets(): MediaAsset[] {
	return [
		{
			id: "asset-1",
			name: "clip-1.mp4",
			type: "video",
			file: new File(["a"], "clip-1.mp4", { type: "video/mp4" }),
			ephemeral: false,
		},
		{
			id: "asset-2",
			name: "clip-2.mp4",
			type: "video",
			file: new File(["b"], "clip-2.mp4", { type: "video/mp4" }),
			ephemeral: false,
		},
		{
			id: "broll-1",
			name: "broll-1.mp4",
			type: "video",
			file: new File(["c"], "broll-1.mp4", { type: "video/mp4" }),
			ephemeral: false,
		},
	];
}

describe("buildPlanImpactPreview", () => {
	test("does not mutate the source project", () => {
		const project = createProject();
		const snapshot = structuredClone(project);
		const ops: TimelineDiffOp[] = [
			{
				type: "MOVE_SEGMENT",
				segment_id: "clip-1",
				to_ms: 5,
			},
			{
				type: "FIX_CAPTION_TEXT",
				segment_id: "cap-1",
				from: "teh",
				to: "the",
			},
		];

		buildPlanImpactPreview({
			project,
			mediaAssets: createMediaAssets(),
			ops,
		});

		expect(project).toEqual(snapshot);
	});

	test("builds move and trim cards with deterministic details", () => {
		const preview = buildPlanImpactPreview({
			project: createProject(),
			mediaAssets: createMediaAssets(),
			ops: [
				{
					type: "MOVE_SEGMENT",
					segment_id: "clip-1",
					to_ms: 5,
				},
				{
					type: "TRIM_CLIP",
					clip_id: "clip-2",
					in_ms: 500,
					out_ms: 0,
				},
			],
		});

		expect(preview.cards).toHaveLength(2);
		expect(preview.cards[0]).toMatchObject({
			kind: "move",
			title: "Move segment",
		});
		expect(preview.cards[0]?.detail.includes("->")).toBe(true);
		expect(preview.cards[1]).toMatchObject({
			kind: "trim",
			title: "Trim clip",
		});
		expect(preview.cards[1]?.detail).toContain("Start trim +500ms");
	});

	test("builds FIX_CAPTION_TEXT cards with before and after text", () => {
		const preview = buildPlanImpactPreview({
			project: createProject(),
			mediaAssets: createMediaAssets(),
			ops: [
				{
					type: "FIX_CAPTION_TEXT",
					segment_id: "cap-1",
					from: "teh",
					to: "the",
				},
			],
		});

		expect(preview.cards).toHaveLength(1);
		expect(preview.cards[0]).toMatchObject({
			kind: "fix-caption",
			beforeText: "teh demo",
			afterText: "the demo",
		});
	});

	test("resolves delete jump targets from the original segment location", () => {
		const preview = buildPlanImpactPreview({
			project: createProject(),
			mediaAssets: createMediaAssets(),
			ops: [
				{
					type: "DELETE_SEGMENT",
					segment_id: "clip-2",
				},
			],
		});

		expect(preview.cards[0]?.kind).toBe("delete");
		expect(preview.cards[0]?.jump).toMatchObject({
			track_id: "track-video",
			segment_id: "clip-2",
		});
	});

	test("produces deterministic cards for global ops and summary deltas", () => {
		const preview = buildPlanImpactPreview({
			project: createProject(),
			mediaAssets: createMediaAssets(),
			ops: [
				{
					type: "SET_CAPTION_STYLE",
					style_id: "bold-center",
					font: "Arial",
					size: 64,
					position: "center",
					outline: true,
					highlight_mode: "word",
				},
				{
					type: "DELETE_SEGMENT",
					segment_id: "clip-2",
				},
			],
		});

		expect(preview.cards[0]?.kind).toBe("caption-style");
		expect(preview.summary.totalOps).toBe(2);
		expect(preview.summary.impactCount).toBe(2);
		expect(preview.summary.simulatedDurationDeltaMs).toBeLessThan(0);
	});
});
