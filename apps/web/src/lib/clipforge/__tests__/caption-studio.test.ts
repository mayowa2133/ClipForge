import { describe, expect, test } from "bun:test";
import {
	adoptLegacyCaptionTracks,
	applyCaptionStyleToTextElement,
	buildDefaultClipForgeProjectData,
	buildSceneCaptionSegments,
	createCaptionTextElements,
	mergeCaptionElements,
	splitCaptionElement,
} from "@/lib/clipforge";
import type { TProject } from "@/types/project";
import type { TextElement } from "@/types/timeline";

function buildProjectFixture(): TProject {
	return {
		metadata: {
			id: "project-caption-1",
			name: "Caption Fixture",
			duration: 2,
			createdAt: new Date("2026-03-09T00:00:00.000Z"),
			updatedAt: new Date("2026-03-09T00:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-main",
				name: "Main",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-03-09T00:00:00.000Z"),
				updatedAt: new Date("2026-03-09T00:00:00.000Z"),
				tracks: [
					{
						id: "video-track",
						type: "video",
						name: "Video",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [
							{
								id: "video-1",
								type: "video",
								name: "Clip",
								mediaId: "media-1",
								startTime: 0,
								duration: 2,
								trimStart: 0,
								trimEnd: 0,
								transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
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
			canvasSize: { width: 1080, height: 1920 },
			background: { type: "color", color: "#000000" },
		},
		version: 12,
		clipforge: {
			...buildDefaultClipForgeProjectData(),
			mediaMetadataById: {
				"media-1": {
					words: [
						{ text: "hello", start_ms: 0, end_ms: 400 },
						{ text: "there", start_ms: 400, end_ms: 800 },
						{ text: "friend", start_ms: 800, end_ms: 1200 },
					],
					segments: [{ text: "hello there friend", start_ms: 0, end_ms: 1200 }],
					silenceRegions: [],
					transcriptionStatus: "ready",
					transcriptionProvider: "browser-whisper",
					transcriptionLanguage: "en",
					transcriptionError: null,
					indexedAt: "2026-03-09T00:00:00.000Z",
				},
			},
		},
	};
}

function buildCaptionElement(): TextElement {
	return {
		id: "caption-1",
		type: "text",
		role: "caption",
		name: "Caption 1",
		content: "hello there friend",
		startTime: 0,
		duration: 1.2,
		trimStart: 0,
		trimEnd: 0,
		fontSize: 18,
		fontFamily: "Instrument Sans",
		fontWeight: "normal",
		fontStyle: "normal",
		textDecoration: "none",
		textAlign: "center",
		color: "#FFFFFF",
		background: { color: "transparent", paddingX: 0, paddingY: 0, cornerRadius: 0 },
		transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
		opacity: 1,
		captionTiming: {
			words: [
				{ text: "hello", startTime: 0, endTime: 0.4 },
				{ text: "there", startTime: 0.4, endTime: 0.8 },
				{ text: "friend", startTime: 0.8, endTime: 1.2 },
			],
		},
	};
}

describe("caption studio helpers", () => {
	test("createCaptionTextElements creates caption-role text elements with word timing", () => {
		const elements = createCaptionTextElements({
			project: buildProjectFixture(),
			styleId: "clean-bottom",
		});

		expect(elements.length).toBeGreaterThan(0);
		expect(elements[0]?.role).toBe("caption");
		expect(elements[0]?.captionTiming?.words.length).toBeGreaterThan(0);
	});

	test("buildSceneCaptionSegments returns active-scene caption rows only", () => {
		const project = buildProjectFixture();
		project.scenes[0]?.tracks.push({
			id: "text-track",
			type: "text",
			name: "Captions",
			hidden: false,
			elements: [
				buildCaptionElement(),
				{
					...buildCaptionElement(),
					id: "text-overlay-1",
					role: "text",
					content: "overlay",
					captionTiming: null,
					startTime: 1.4,
				},
			],
		});

		const segments = buildSceneCaptionSegments({ project });
		expect(segments).toHaveLength(1);
		expect(segments[0]?.elementId).toBe("caption-1");
	});

	test("splitCaptionElement splits content and timing deterministically", () => {
		const result = splitCaptionElement({
			element: buildCaptionElement(),
			splitWordIndex: 1,
		});

		expect(result.first.content).toBe("hello");
		expect(result.second.content).toBe("there friend");
		expect(result.first.captionTiming?.words).toHaveLength(1);
		expect(result.second.captionTiming?.words).toHaveLength(2);
	});

	test("mergeCaptionElements merges text and timing deterministically", () => {
		const first = buildCaptionElement();
		const second = {
			...buildCaptionElement(),
			id: "caption-2",
			content: "again",
			startTime: 1.2,
			duration: 0.4,
			captionTiming: {
				words: [{ text: "again", startTime: 1.2, endTime: 1.6 }],
			},
		};
		const merged = mergeCaptionElements({ first, second });

		expect(merged.content).toBe("hello there friend again");
		expect(merged.duration).toBeCloseTo(1.6, 5);
		expect(merged.captionTiming?.words).toHaveLength(4);
	});

	test("applyCaptionStyleToTextElement applies caption styling deterministically", () => {
		const styled = applyCaptionStyleToTextElement({
			element: buildCaptionElement(),
			style: {
				style_id: "bold-center",
				font: "Bebas Neue",
				size: 64,
				position: "center",
				outline: true,
				highlight_mode: "word",
			},
			canvasHeight: 1920,
		});

		expect(styled.role).toBe("caption");
		expect(styled.fontFamily).toBe("Bebas Neue");
		expect(styled.fontWeight).toBe("bold");
		expect(styled.background.color).toBe("#000000");
	});

	test("adoptLegacyCaptionTracks adopts a high-confidence legacy caption track", () => {
		const project = buildProjectFixture();
		project.scenes[0]?.tracks.push({
			id: "legacy-captions",
			type: "text",
			name: "Captions",
			hidden: false,
			elements: [
				{
					...buildCaptionElement(),
					role: "text",
					captionTiming: null,
				},
				{
					...buildCaptionElement(),
					id: "caption-2",
					role: "text",
					captionTiming: null,
					startTime: 1.3,
					duration: 1.2,
					content: "hello again",
				},
			],
		});

		const adopted = adoptLegacyCaptionTracks({ project });
		const track = adopted.scenes[0]?.tracks.find((candidate) => candidate.id === "legacy-captions");

		expect(track?.type).toBe("text");
		if (track?.type === "text") {
			expect(track.elements.every((element) => element.type === "text" && element.role === "caption")).toBe(true);
		}
		expect(adopted.clipforge?.captionTrackIdsBySceneId["scene-main"]).toBe("legacy-captions");
	});

	test("adoptLegacyCaptionTracks adopts generic text tracks when element names are caption-like", () => {
		const project = buildProjectFixture();
		project.scenes[0]?.tracks.push({
			id: "legacy-text-track",
			type: "text",
			name: "Text track",
			hidden: false,
			elements: [
				{
					...buildCaptionElement(),
					id: "caption-1",
					name: "Caption 1",
					role: "text",
					captionTiming: null,
					content: "hey welcome to clipforge",
					startTime: 0,
					duration: 1.4,
				},
				{
					...buildCaptionElement(),
					id: "caption-2",
					name: "Caption 2",
					role: "text",
					captionTiming: null,
					content: "this demo shows smart jump cuts",
					startTime: 2,
					duration: 1.66,
				},
			],
		});

		const adopted = adoptLegacyCaptionTracks({ project });
		const track = adopted.scenes[0]?.tracks.find((candidate) => candidate.id === "legacy-text-track");

		expect(track?.type).toBe("text");
		if (track?.type === "text") {
			expect(track.elements.every((element) => element.type === "text" && element.role === "caption")).toBe(true);
		}
		expect(adopted.clipforge?.captionTrackIdsBySceneId["scene-main"]).toBe("legacy-text-track");
	});

	test("adoptLegacyCaptionTracks does not adopt mixed overlay text tracks", () => {
		const project = buildProjectFixture();
		project.scenes[0]?.tracks.push({
			id: "mixed-text",
			type: "text",
			name: "Captions",
			hidden: false,
			elements: [
				{
					...buildCaptionElement(),
					role: "text",
					captionTiming: null,
				},
				{
					...buildCaptionElement(),
					id: "overlay-title",
					role: "text",
					captionTiming: null,
					name: "Title overlay",
					content: "Subscribe now",
					duration: 9,
					startTime: 4,
				},
			],
		});

		const adopted = adoptLegacyCaptionTracks({ project });
		const track = adopted.scenes[0]?.tracks.find((candidate) => candidate.id === "mixed-text");

		expect(track?.type).toBe("text");
		if (track?.type === "text") {
			expect(track.elements.every((element) => element.type === "text" && (element.role ?? "text") === "text")).toBe(true);
		}
		expect(adopted.clipforge?.captionTrackIdsBySceneId["scene-main"]).toBeUndefined();
	});
});
