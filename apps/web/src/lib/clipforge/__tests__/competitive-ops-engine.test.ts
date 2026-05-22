import { describe, expect, test } from "bun:test";
import {
	buildDefaultClipForgeProjectData,
	buildTimelineDiffPatch,
} from "@/lib/clipforge";
import type { MediaAsset } from "@/types/assets";
import type { TimelineDiffOp } from "@/types/clipforge";
import type { TProject } from "@/types/project";

/**
 * Integration tests that exercise the 5 new competitive-parity ops
 * through the full buildTimelineDiffPatch pipeline (op engine + audit log)
 * with realistic timeline structures.
 */

function buildProjectFixture(): TProject {
	const clipforgeData = buildDefaultClipForgeProjectData();
	// Add media metadata with speech data for EXTRACT_HIGHLIGHT testing
	clipforgeData.mediaMetadataById["media-a"] = {
		words: [
			{ text: "hello", start_ms: 500, end_ms: 800 },
			{ text: "world", start_ms: 900, end_ms: 1200 },
			{ text: "this", start_ms: 1500, end_ms: 1700 },
			{ text: "is", start_ms: 1800, end_ms: 1950 },
			{ text: "a", start_ms: 2000, end_ms: 2100 },
			{ text: "test", start_ms: 2200, end_ms: 2500 },
			{ text: "of", start_ms: 2700, end_ms: 2850 },
			{ text: "the", start_ms: 3000, end_ms: 3150 },
			{ text: "highlight", start_ms: 3300, end_ms: 3700 },
			{ text: "extraction", start_ms: 3800, end_ms: 4300 },
			{ text: "feature", start_ms: 4500, end_ms: 4900 },
			{ text: "which", start_ms: 5200, end_ms: 5400 },
			{ text: "should", start_ms: 5500, end_ms: 5700 },
			{ text: "find", start_ms: 5800, end_ms: 6000 },
			{ text: "the", start_ms: 6100, end_ms: 6250 },
			{ text: "densest", start_ms: 6300, end_ms: 6600 },
			{ text: "speech", start_ms: 6700, end_ms: 7000 },
		],
		segments: [],
		silenceRegions: [],
		transcriptionStatus: "ready",
		transcriptionProvider: null,
		transcriptionLanguage: null,
		transcriptionError: null,
		indexedAt: new Date().toISOString(),
	};

	return {
		metadata: {
			id: "project-competitive-1",
			name: "Competitive Ops Test",
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
							{
								id: "segment-img",
								type: "image",
								name: "Photo",
								mediaId: "media-img",
								duration: 3000,
								startTime: 17000,
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
								role: "caption",
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
		clipforge: clipforgeData,
	};
}

function getVideoTrack(project: TProject) {
	return project.scenes[0].tracks.find(
		(t) => t.type === "video" && t.isMain,
	)!;
}

function getElement(project: TProject, id: string) {
	for (const track of project.scenes[0].tracks) {
		const el = track.elements.find((e) => e.id === id);
		if (el) return el;
	}
	return undefined;
}

// ----------------------------------------------------------------
// SET_SPEED_RAMP — end-to-end
// ----------------------------------------------------------------

describe("SET_SPEED_RAMP engine", () => {
	test("applies speed ramp metadata to a video element", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "SET_SPEED_RAMP",
				clip_id: "segment-a",
				curve: "ease-in",
				speed_start: 1.0,
				speed_end: 0.3,
				ramp_start_ms: 0,
				ramp_end_ms: 3000,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-a") as any;

		expect(element.speedRamp).toBeDefined();
		expect(element.speedRamp.curve).toBe("ease-in");
		expect(element.speedRamp.speedStart).toBe(1.0);
		expect(element.speedRamp.speedEnd).toBe(0.3);
		expect(element.speedRamp.rampStartMs).toBe(0);
		expect(element.speedRamp.rampEndMs).toBe(3000);
	});

	test("clamps speed values to 0.1-4.0 range", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "SET_SPEED_RAMP",
				clip_id: "segment-a",
				curve: "flash",
				speed_start: 0.01,
				speed_end: 10.0,
				ramp_start_ms: 0,
				ramp_end_ms: 2000,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-a") as any;

		expect(element.speedRamp.speedStart).toBe(0.1);
		expect(element.speedRamp.speedEnd).toBe(4.0);
	});

	test("clamps ramp window to element bounds", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "SET_SPEED_RAMP",
				clip_id: "segment-a",
				curve: "ease-out",
				speed_start: 2.0,
				speed_end: 0.5,
				ramp_start_ms: -500,
				ramp_end_ms: 999999,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-a") as any;

		expect(element.speedRamp.rampStartMs).toBe(0);
		// element.duration is 8000 (ms), ramp clamped to that
		expect(element.speedRamp.rampEndMs).toBe(8000);
	});

	test("skips non-video elements", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "SET_SPEED_RAMP",
				clip_id: "caption-1",
				curve: "ease-in",
				speed_start: 1.0,
				speed_end: 0.5,
				ramp_start_ms: 0,
				ramp_end_ms: 1000,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "caption-1") as any;

		expect(element.speedRamp).toBeUndefined();
	});

	test("skips nonexistent clip_id", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "SET_SPEED_RAMP",
				clip_id: "does-not-exist",
				curve: "ease-in",
				speed_start: 1.0,
				speed_end: 0.5,
				ramp_start_ms: 0,
				ramp_end_ms: 1000,
			},
		];

		// Should not throw
		const patch = buildTimelineDiffPatch({ project, ops });
		expect(patch.after).toBeDefined();
	});

	test("audit log records the op", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "SET_SPEED_RAMP",
				clip_id: "segment-a",
				curve: "ease-in-out",
				speed_start: 1.0,
				speed_end: 0.4,
				ramp_start_ms: 500,
				ramp_end_ms: 2500,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		expect(patch.auditEntry.ops.length).toBe(1);
		expect(patch.auditEntry.ops[0].type).toBe("SET_SPEED_RAMP");
	});
});

// ----------------------------------------------------------------
// SMART_ZOOM — end-to-end
// ----------------------------------------------------------------

describe("SMART_ZOOM engine", () => {
	test("applies zoom metadata and modifies scale on video element", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "SMART_ZOOM",
				clip_id: "segment-a",
				zoom_start: 1.0,
				zoom_end: 1.5,
				focus_x: 0.5,
				focus_y: 0.4,
				ease: "ease-in-out",
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-a") as any;

		expect(element.smartZoom).toBeDefined();
		expect(element.smartZoom.zoomStart).toBe(1.0);
		expect(element.smartZoom.zoomEnd).toBe(1.5);
		expect(element.smartZoom.focusX).toBe(0.5);
		expect(element.smartZoom.focusY).toBe(0.4);
		expect(element.smartZoom.ease).toBe("ease-in-out");
		// Scale should be multiplied by zoomStart
		expect(element.transform.scale).toBe(1.0);
	});

	test("works on image elements too", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "SMART_ZOOM",
				clip_id: "segment-img",
				zoom_start: 1.2,
				zoom_end: 1.0,
				focus_x: 0.5,
				focus_y: 0.5,
				ease: "ease-out",
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-img") as any;

		expect(element.smartZoom).toBeDefined();
		expect(element.smartZoom.zoomStart).toBe(1.2);
		expect(element.smartZoom.zoomEnd).toBe(1.0);
		expect(element.transform.scale).toBe(1.2);
	});

	test("clamps zoom values to 0.5-3.0 range", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "SMART_ZOOM",
				clip_id: "segment-a",
				zoom_start: 0.1,
				zoom_end: 5.0,
				focus_x: 0.5,
				focus_y: 0.5,
				ease: "linear",
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-a") as any;

		expect(element.smartZoom.zoomStart).toBe(0.5);
		expect(element.smartZoom.zoomEnd).toBe(3.0);
	});

	test("clamps focus point to 0-1 range", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "SMART_ZOOM",
				clip_id: "segment-a",
				zoom_start: 1.0,
				zoom_end: 1.3,
				focus_x: -0.5,
				focus_y: 1.5,
				ease: "ease-in",
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-a") as any;

		expect(element.smartZoom.focusX).toBe(0);
		expect(element.smartZoom.focusY).toBe(1);
	});

	test("does not modify original project", () => {
		const project = buildProjectFixture();
		const originalScale = (getElement(project, "segment-a") as any).transform.scale;

		buildTimelineDiffPatch({
			project,
			ops: [
				{
					type: "SMART_ZOOM",
					clip_id: "segment-a",
					zoom_start: 2.0,
					zoom_end: 1.0,
					focus_x: 0.5,
					focus_y: 0.5,
					ease: "ease-in-out",
				},
			],
		});

		// Original should be unchanged
		expect((getElement(project, "segment-a") as any).transform.scale).toBe(originalScale);
	});
});

// ----------------------------------------------------------------
// EXTRACT_HIGHLIGHT — end-to-end
// ----------------------------------------------------------------

describe("EXTRACT_HIGHLIGHT engine", () => {
	test("trims clip to highlight region (replace mode)", () => {
		const project = buildProjectFixture();
		const originalDuration = getElement(project, "segment-a")!.duration;
		const ops: TimelineDiffOp[] = [
			{
				type: "EXTRACT_HIGHLIGHT",
				source_clip_id: "segment-a",
				target_duration_s: 3,
				strategy: "speech-density",
				keep_original: false,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-a")!;

		// target_duration_s=3 → 3000ms
		expect(element.duration).toBe(3000);
		expect(element.duration).toBeLessThan(originalDuration);
	});

	test("appends highlight copy in keep_original mode", () => {
		const project = buildProjectFixture();
		const videoTrack = getVideoTrack(project);
		const originalCount = videoTrack.elements.length;

		const ops: TimelineDiffOp[] = [
			{
				type: "EXTRACT_HIGHLIGHT",
				source_clip_id: "segment-a",
				target_duration_s: 2,
				strategy: "combined",
				keep_original: true,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const afterVideoTrack = getVideoTrack(patch.after);

		// Should have one more element (the highlight copy)
		expect(afterVideoTrack.elements.length).toBe(originalCount + 1);

		// Original should be unchanged in duration
		const originalElement = getElement(patch.after, "segment-a")!;
		expect(originalElement.duration).toBe(8000);

		// The new element should have the target duration (2s = 2000ms)
		const newElement = afterVideoTrack.elements.find(
			(e) => e.id !== "segment-a" && e.id !== "segment-b" && e.id !== "segment-img",
		)!;
		expect(newElement.duration).toBe(2000);
	});

	test("skips if target_duration_s >= element duration", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "EXTRACT_HIGHLIGHT",
				source_clip_id: "segment-a",
				target_duration_s: 9999,
				strategy: "combined",
				keep_original: false,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-a")!;

		// Duration should be unchanged since target exceeds element
		expect(element.duration).toBe(8000);
	});

	test("uses visual-peaks strategy for clips without speech", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "EXTRACT_HIGHLIGHT",
				source_clip_id: "segment-b",
				target_duration_s: 3,
				strategy: "visual-peaks",
				keep_original: false,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-b")!;

		// Should trim to 3s = 3000ms using visual peaks (early-bias fallback)
		expect(element.duration).toBe(3000);
	});
});

// ----------------------------------------------------------------
// APPLY_COLOR_GRADE — end-to-end
// ----------------------------------------------------------------

describe("APPLY_COLOR_GRADE engine", () => {
	test("applies color grade to a specific clip", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "APPLY_COLOR_GRADE",
				preset: "cool-cinematic",
				intensity: 0.75,
				clip_id: "segment-a",
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-a") as any;

		expect(element.colorGrade).toBeDefined();
		expect(element.colorGrade.preset).toBe("cool-cinematic");
		expect(element.colorGrade.intensity).toBe(0.75);

		// Other video elements should NOT have color grade
		const elementB = getElement(patch.after, "segment-b") as any;
		expect(elementB.colorGrade).toBeUndefined();
	});

	test("applies color grade to all video/image clips when clip_id is null", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "APPLY_COLOR_GRADE",
				preset: "warm-vintage",
				intensity: 0.8,
				clip_id: null,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });

		// All video elements should have the grade
		const elementA = getElement(patch.after, "segment-a") as any;
		const elementB = getElement(patch.after, "segment-b") as any;
		const elementImg = getElement(patch.after, "segment-img") as any;

		expect(elementA.colorGrade?.preset).toBe("warm-vintage");
		expect(elementB.colorGrade?.preset).toBe("warm-vintage");
		expect(elementImg.colorGrade?.preset).toBe("warm-vintage");

		// Text elements should NOT have color grade
		const caption = getElement(patch.after, "caption-1") as any;
		expect(caption.colorGrade).toBeUndefined();
	});

	test("clamps intensity to 0-1 range", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "APPLY_COLOR_GRADE",
				preset: "moody-dark",
				intensity: 1.5,
				clip_id: "segment-a",
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-a") as any;

		expect(element.colorGrade.intensity).toBe(1);
	});

	test("overwrites existing color grade", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "APPLY_COLOR_GRADE",
				preset: "warm-vintage",
				intensity: 0.5,
				clip_id: "segment-a",
			},
			{
				type: "APPLY_COLOR_GRADE",
				preset: "golden-hour",
				intensity: 0.9,
				clip_id: "segment-a",
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-a") as any;

		// Second grade should overwrite
		expect(element.colorGrade.preset).toBe("golden-hour");
		expect(element.colorGrade.intensity).toBe(0.9);
	});

	test("skips nonexistent clip_id", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "APPLY_COLOR_GRADE",
				preset: "vibrant-social",
				intensity: 0.7,
				clip_id: "nonexistent",
			},
		];

		// Should not throw
		const patch = buildTimelineDiffPatch({ project, ops });
		expect(patch.after).toBeDefined();
	});
});

// ----------------------------------------------------------------
// SET_KEYFRAME_EASING — end-to-end
// ----------------------------------------------------------------

describe("SET_KEYFRAME_EASING engine", () => {
	test("adds keyframe easing to an element", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "SET_KEYFRAME_EASING",
				element_id: "caption-1",
				property: "scale",
				easing: "bounce",
				keyframe_index: 0,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "caption-1") as any;

		expect(element.keyframeEasings).toBeDefined();
		expect(element.keyframeEasings.length).toBe(1);
		expect(element.keyframeEasings[0].property).toBe("scale");
		expect(element.keyframeEasings[0].easing).toBe("bounce");
		expect(element.keyframeEasings[0].keyframeIndex).toBe(0);
	});

	test("adds multiple easing entries for different properties", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "SET_KEYFRAME_EASING",
				element_id: "segment-a",
				property: "position",
				easing: "ease-in-out",
				keyframe_index: 0,
			},
			{
				type: "SET_KEYFRAME_EASING",
				element_id: "segment-a",
				property: "opacity",
				easing: "spring",
				keyframe_index: 0,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-a") as any;

		expect(element.keyframeEasings.length).toBe(2);
		expect(element.keyframeEasings[0].property).toBe("position");
		expect(element.keyframeEasings[1].property).toBe("opacity");
	});

	test("replaces easing for same property+keyframe_index", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "SET_KEYFRAME_EASING",
				element_id: "segment-a",
				property: "scale",
				easing: "ease-in",
				keyframe_index: 0,
			},
			{
				type: "SET_KEYFRAME_EASING",
				element_id: "segment-a",
				property: "scale",
				easing: "bounce",
				keyframe_index: 0,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-a") as any;

		// Should have 1 entry, not 2 — second replaces first
		expect(element.keyframeEasings.length).toBe(1);
		expect(element.keyframeEasings[0].easing).toBe("bounce");
	});

	test("supports different keyframe indices", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "SET_KEYFRAME_EASING",
				element_id: "segment-a",
				property: "scale",
				easing: "ease-in",
				keyframe_index: 0,
			},
			{
				type: "SET_KEYFRAME_EASING",
				element_id: "segment-a",
				property: "scale",
				easing: "ease-out",
				keyframe_index: 1,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const element = getElement(patch.after, "segment-a") as any;

		// Different keyframe indices = separate entries
		expect(element.keyframeEasings.length).toBe(2);
		expect(element.keyframeEasings[0].easing).toBe("ease-in");
		expect(element.keyframeEasings[1].easing).toBe("ease-out");
	});
});

// ----------------------------------------------------------------
// Multi-op creative recipe — end-to-end
// ----------------------------------------------------------------

describe("multi-op creative recipes", () => {
	test("cinematic recipe: color grade + smart zoom + speed ramp", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "APPLY_COLOR_GRADE",
				preset: "cool-cinematic",
				intensity: 0.7,
				clip_id: null,
			},
			{
				type: "SMART_ZOOM",
				clip_id: "segment-a",
				zoom_start: 1.0,
				zoom_end: 1.3,
				focus_x: 0.5,
				focus_y: 0.4,
				ease: "ease-in-out",
			},
			{
				type: "SET_SPEED_RAMP",
				clip_id: "segment-b",
				curve: "ease-in",
				speed_start: 1.0,
				speed_end: 0.4,
				ramp_start_ms: 2000,
				ramp_end_ms: 5000,
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });

		// Color grade on all
		const elementA = getElement(patch.after, "segment-a") as any;
		const elementB = getElement(patch.after, "segment-b") as any;
		expect(elementA.colorGrade?.preset).toBe("cool-cinematic");
		expect(elementB.colorGrade?.preset).toBe("cool-cinematic");

		// Zoom on A
		expect(elementA.smartZoom?.zoomEnd).toBe(1.3);

		// Speed ramp on B
		expect(elementB.speedRamp?.curve).toBe("ease-in");
		expect(elementB.speedRamp?.speedEnd).toBe(0.4);

		// Audit log should have all 3 ops
		expect(patch.auditEntry.ops.length).toBe(3);
	});

	test("extract + polish recipe: highlight + color + captions", () => {
		const project = buildProjectFixture();
		const ops: TimelineDiffOp[] = [
			{
				type: "EXTRACT_HIGHLIGHT",
				source_clip_id: "segment-a",
				target_duration_s: 4,
				strategy: "speech-density",
				keep_original: false,
			},
			{
				type: "APPLY_COLOR_GRADE",
				preset: "vibrant-social",
				intensity: 0.85,
				clip_id: "segment-a",
			},
			{
				type: "SET_CAPTION_STYLE",
				style_id: "bold-center",
				font: "Arial",
				size: 74,
				position: "center",
				outline: true,
				highlight_mode: "word",
			},
		];

		const patch = buildTimelineDiffPatch({ project, ops });
		const elementA = getElement(patch.after, "segment-a")!;

		// Highlight extraction (4s = 4000ms)
		expect(elementA.duration).toBe(4000);

		// Color grade applied after extraction
		expect((elementA as any).colorGrade?.preset).toBe("vibrant-social");

		// Audit log
		expect(patch.auditEntry.ops.length).toBe(3);
	});
});
