import { describe, expect, test } from "bun:test";
import { exportProjectToFcpxml } from "@/lib/clipforge/fcpxml-export";
import type { TProject } from "@/types/project";
import type { MediaAsset } from "@/types/assets";
import type { VideoElement, TextElement, TimelineTrack } from "@/types/timeline";

function buildMinimalProject(
	overrides: Partial<TProject> = {},
): TProject {
	return {
		metadata: {
			id: "proj-1",
			name: "Test Project",
			thumbnail: undefined,
			duration: 10,
			createdAt: new Date("2025-01-01"),
			updatedAt: new Date("2025-01-01"),
		},
		scenes: [
			{
				id: "scene-main",
				name: "Main",
				isMain: true,
				tracks: [],
				bookmarks: [],
				createdAt: new Date("2025-01-01"),
				updatedAt: new Date("2025-01-01"),
			},
		],
		currentSceneId: "scene-main",
		settings: {
			fps: 30,
			canvasSize: { width: 1920, height: 1080 },
			background: { type: "color", color: "#000000" },
		},
		version: 1,
		...overrides,
	};
}

function buildVideoElement(
	overrides: Partial<VideoElement> = {},
): VideoElement {
	return {
		id: "el-1",
		name: "Clip 1",
		type: "video",
		duration: 5,
		startTime: 0,
		trimStart: 0,
		trimEnd: 5,
		mediaId: "media-1",
		transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
		opacity: 1,
		...overrides,
	};
}

function buildMediaAsset(
	overrides: Partial<MediaAsset> = {},
): MediaAsset {
	return {
		id: "media-1",
		name: "clip.mp4",
		type: "video",
		file: new File([], "clip.mp4"),
		url: "file:///clip.mp4",
		width: 1920,
		height: 1080,
		duration: 10,
		...overrides,
	} as MediaAsset;
}

function buildVideoTrack(elements: VideoElement[]): TimelineTrack {
	return {
		id: "track-main",
		name: "Main Video",
		type: "video",
		isMain: true,
		elements,
		hidden: false,
		muted: false,
	};
}

describe("exportProjectToFcpxml", () => {
	test("produces valid XML with fcpxml root element", () => {
		const project = buildMinimalProject();
		const result = exportProjectToFcpxml({
			project,
			mediaAssets: [],
		});

		expect(result.xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(result.xml).toContain("<!DOCTYPE fcpxml>");
		expect(result.xml).toContain('<fcpxml version="1.11">');
		expect(result.xml).toContain("</fcpxml>");
	});

	test("contains resources and spine elements", () => {
		const project = buildMinimalProject();
		const result = exportProjectToFcpxml({ project, mediaAssets: [] });

		expect(result.xml).toContain("<resources>");
		expect(result.xml).toContain("</resources>");
		expect(result.xml).toContain("<spine>");
		expect(result.xml).toContain("</spine>");
	});

	test("empty project produces valid minimal XML with no warnings", () => {
		const project = buildMinimalProject();
		const result = exportProjectToFcpxml({ project, mediaAssets: [] });

		expect(result.xml.length).toBeGreaterThan(0);
		expect(result.warnings).toEqual([]);
		expect(result.fileName).toBe("Test_Project_export.fcpxml");
	});

	test("returns empty xml and warning when project has no scenes", () => {
		const project = buildMinimalProject({ scenes: [] });
		const result = exportProjectToFcpxml({ project, mediaAssets: [] });

		expect(result.xml).toBe("");
		expect(result.fileName).toBe("");
		expect(result.warnings).toEqual(["No scenes found in project."]);
	});

	test("includes asset-clip elements for video tracks", () => {
		const videoEl = buildVideoElement();
		const project = buildMinimalProject({
			scenes: [
				{
					id: "scene-main",
					name: "Main",
					isMain: true,
					tracks: [buildVideoTrack([videoEl])],
					bookmarks: [],
					createdAt: new Date("2025-01-01"),
					updatedAt: new Date("2025-01-01"),
				},
			],
		});
		const mediaAsset = buildMediaAsset();

		const result = exportProjectToFcpxml({
			project,
			mediaAssets: [mediaAsset],
		});

		expect(result.xml).toContain("asset-clip");
		expect(result.xml).toContain('name="Clip 1"');
	});

	test("generates warning for missing media asset", () => {
		const videoEl = buildVideoElement({ mediaId: "missing-id" });
		const project = buildMinimalProject({
			scenes: [
				{
					id: "scene-main",
					name: "Main",
					isMain: true,
					tracks: [buildVideoTrack([videoEl])],
					bookmarks: [],
					createdAt: new Date("2025-01-01"),
					updatedAt: new Date("2025-01-01"),
				},
			],
		});

		const result = exportProjectToFcpxml({ project, mediaAssets: [] });

		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings[0]).toContain("missing-id");
	});

	test("uses fps override when provided", () => {
		const project = buildMinimalProject();
		const result = exportProjectToFcpxml({
			project,
			mediaAssets: [],
			fps: 24,
		});

		expect(result.xml).toContain("24000s");
	});

	test("sanitizes project name in filename", () => {
		const project = buildMinimalProject({
			metadata: {
				id: "proj-1",
				name: "My Project / Final (v2)",
				thumbnail: undefined,
				duration: 10,
				createdAt: new Date("2025-01-01"),
				updatedAt: new Date("2025-01-01"),
			},
		});

		const result = exportProjectToFcpxml({ project, mediaAssets: [] });

		expect(result.fileName).not.toContain("/");
		expect(result.fileName).not.toContain("(");
		expect(result.fileName).toContain("_export.fcpxml");
	});

	test("escapes XML special characters in project name", () => {
		const project = buildMinimalProject({
			metadata: {
				id: "proj-1",
				name: 'Project "A" & B',
				thumbnail: undefined,
				duration: 10,
				createdAt: new Date("2025-01-01"),
				updatedAt: new Date("2025-01-01"),
			},
		});

		const result = exportProjectToFcpxml({ project, mediaAssets: [] });

		expect(result.xml).toContain("&amp;");
		expect(result.xml).toContain("&quot;");
	});

	test("includes title elements for text tracks", () => {
		const textEl = {
			id: "text-1",
			name: "Title Card",
			type: "text" as const,
			content: "Hello World",
			duration: 3,
			startTime: 1,
			trimStart: 0,
			trimEnd: 3,
			fontSize: 48,
			fontFamily: "Arial",
			color: "#ffffff",
			background: { color: "transparent" },
			textAlign: "center" as const,
			fontWeight: "normal" as const,
			fontStyle: "normal" as const,
			textDecoration: "none" as const,
			transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
			opacity: 1,
		};

		const project = buildMinimalProject({
			scenes: [
				{
					id: "scene-main",
					name: "Main",
					isMain: true,
					tracks: [
						{
							id: "track-text",
							name: "Text",
							type: "text" as const,
							elements: [textEl],
							hidden: false,
						},
					],
					bookmarks: [],
					createdAt: new Date("2025-01-01"),
					updatedAt: new Date("2025-01-01"),
				},
			],
		});

		const result = exportProjectToFcpxml({ project, mediaAssets: [] });

		expect(result.xml).toContain("<title");
		expect(result.xml).toContain("<text>Hello World</text>");
	});

	test("inserts gap element when no main video track but other tracks exist", () => {
		const textEl = {
			id: "text-1",
			name: "Overlay",
			type: "text" as const,
			content: "Test",
			duration: 2,
			startTime: 0,
			trimStart: 0,
			trimEnd: 2,
			fontSize: 24,
			fontFamily: "Arial",
			color: "#ffffff",
			background: { color: "transparent" },
			textAlign: "center" as const,
			fontWeight: "normal" as const,
			fontStyle: "normal" as const,
			textDecoration: "none" as const,
			transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
			opacity: 1,
		};

		const project = buildMinimalProject({
			scenes: [
				{
					id: "scene-main",
					name: "Main",
					isMain: true,
					tracks: [
						{
							id: "track-text",
							name: "Text",
							type: "text" as const,
							elements: [textEl],
							hidden: false,
						},
					],
					bookmarks: [],
					createdAt: new Date("2025-01-01"),
					updatedAt: new Date("2025-01-01"),
				},
			],
		});

		const result = exportProjectToFcpxml({ project, mediaAssets: [] });

		expect(result.xml).toContain("<gap");
	});

	test("format element uses rational frame duration for 30fps", () => {
		const project = buildMinimalProject();
		const result = exportProjectToFcpxml({ project, mediaAssets: [], fps: 30 });

		expect(result.xml).toContain('frameDuration="1001/30000s"');
	});
});
