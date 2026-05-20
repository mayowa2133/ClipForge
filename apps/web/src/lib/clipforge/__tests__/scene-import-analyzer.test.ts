import { describe, expect, test } from "bun:test";
import {
	analyzeImportedClip,
	analyzeImportedClips,
	segmentBySceneCuts,
} from "../scene-import-analyzer";
import type { MediaAsset, MediaVisualAnalysis } from "@/types/assets";
import type { ClipMediaMetadata } from "@/types/clipforge";

function buildTestAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
	return {
		id: "asset-1",
		name: "test-clip.mp4",
		type: "video",
		url: "/test.mp4",
		duration: 30,
		ephemeral: false,
		...overrides,
	} as MediaAsset;
}

function buildTestMetadata(
	overrides: Partial<ClipMediaMetadata> = {},
): ClipMediaMetadata {
	return {
		words: [],
		segments: [],
		silenceRegions: [],
		transcriptionStatus: "ready",
		transcriptionProvider: null,
		transcriptionLanguage: null,
		transcriptionError: null,
		indexedAt: new Date().toISOString(),
		...overrides,
	};
}

describe("segmentBySceneCuts", () => {
	test("returns single segment when no scene cuts", () => {
		const asset = buildTestAsset({ duration: 10 });
		const result = segmentBySceneCuts({ asset, sceneCuts: [] });

		expect(result.length).toBe(1);
		expect(result[0].startS).toBe(0);
		expect(result[0].endS).toBe(10);
	});

	test("splits at scene cut boundaries", () => {
		const asset = buildTestAsset({ duration: 15 });
		const result = segmentBySceneCuts({ asset, sceneCuts: [5, 10] });

		expect(result.length).toBe(3);
		expect(result[0].startS).toBe(0);
		expect(result[0].endS).toBe(5);
		expect(result[1].startS).toBe(5);
		expect(result[1].endS).toBe(10);
		expect(result[2].startS).toBe(10);
		expect(result[2].endS).toBe(15);
	});

	test("filters cuts too close to start or end", () => {
		const asset = buildTestAsset({ duration: 10 });
		const result = segmentBySceneCuts({ asset, sceneCuts: [0.2, 5, 9.8] });

		// 0.2 is < MIN_SEGMENT_DURATION_S from start, 9.8 is < 0.5 from end
		expect(result.length).toBe(2);
		expect(result[0].startS).toBe(0);
		expect(result[0].endS).toBe(5);
	});

	test("returns empty for zero-duration asset", () => {
		const asset = buildTestAsset({ duration: 0 });
		const result = segmentBySceneCuts({ asset, sceneCuts: [1, 2] });
		expect(result).toEqual([]);
	});

	test("sorts unsorted cuts", () => {
		const asset = buildTestAsset({ duration: 20 });
		const result = segmentBySceneCuts({ asset, sceneCuts: [10, 5, 15] });

		expect(result.length).toBe(4);
		expect(result[0].endS).toBe(5);
		expect(result[1].endS).toBe(10);
		expect(result[2].endS).toBe(15);
	});
});

describe("analyzeImportedClip", () => {
	test("returns unknown for zero-duration clip", () => {
		const asset = buildTestAsset({ duration: 0 });
		const result = analyzeImportedClip({ asset, metadata: null });

		expect(result.contentType).toBe("unknown");
		expect(result.segments.length).toBe(0);
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	test("classifies talking-head content", () => {
		const asset = buildTestAsset({
			duration: 60,
			visualAnalysis: {
				activityWindows: [{ startTime: 0, endTime: 60, score: 0.3 }],
				sceneCuts: [],
				analyzedAt: new Date().toISOString(),
				version: 1,
			} as MediaVisualAnalysis,
		});
		const metadata = buildTestMetadata({
			words: Array.from({ length: 120 }, (_, i) => ({
				text: "word",
				start_ms: i * 450,
				end_ms: i * 450 + 400,
			})),
		});

		const result = analyzeImportedClip({ asset, metadata });

		expect(result.contentType).toBe("talking-head");
		expect(result.hasSpeech).toBe(true);
		expect(result.sceneCutCount).toBe(0);
	});

	test("classifies montage content with many scene cuts", () => {
		const sceneCuts = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
		const asset = buildTestAsset({
			duration: 22,
			visualAnalysis: {
				activityWindows: sceneCuts.map((t) => ({
					startTime: t,
					endTime: t + 1.5,
					score: 0.9,
				})),
				sceneCuts,
				analyzedAt: new Date().toISOString(),
				version: 1,
			} as MediaVisualAnalysis,
		});

		const result = analyzeImportedClip({ asset, metadata: null });

		expect(result.contentType).toBe("montage");
		expect(result.sceneCutCount).toBe(10);
		expect(result.segments.length).toBeGreaterThan(1);
	});

	test("classifies mixed content", () => {
		const asset = buildTestAsset({
			duration: 30,
			visualAnalysis: {
				activityWindows: [
					{ startTime: 0, endTime: 10, score: 0.5 },
					{ startTime: 10, endTime: 20, score: 0.7 },
				],
				sceneCuts: [5, 10, 15],
				analyzedAt: new Date().toISOString(),
				version: 1,
			} as MediaVisualAnalysis,
		});
		const metadata = buildTestMetadata({
			words: Array.from({ length: 30 }, (_, i) => ({
				text: "word",
				start_ms: i * 800,
				end_ms: i * 800 + 600,
			})),
		});

		const result = analyzeImportedClip({ asset, metadata });

		expect(result.contentType).toBe("mixed");
		expect(result.hasSpeech).toBe(true);
	});

	test("warns when no visual analysis is available", () => {
		const asset = buildTestAsset({ duration: 10 });
		const result = analyzeImportedClip({ asset, metadata: null });

		expect(result.warnings.some((w) => w.includes("visual analysis"))).toBe(true);
		expect(result.segments.length).toBe(1); // Single full-clip segment
	});

	test("enriches segments with speech data", () => {
		const asset = buildTestAsset({
			duration: 10,
			visualAnalysis: {
				activityWindows: [{ startTime: 0, endTime: 10, score: 0.5 }],
				sceneCuts: [5],
				analyzedAt: new Date().toISOString(),
				version: 1,
			} as MediaVisualAnalysis,
		});
		const metadata = buildTestMetadata({
			words: [
				{ text: "hello", start_ms: 500, end_ms: 800 },
				{ text: "world", start_ms: 900, end_ms: 1200 },
				{ text: "test", start_ms: 6000, end_ms: 6500 },
			],
		});

		const result = analyzeImportedClip({ asset, metadata });

		expect(result.segments.length).toBe(2);
		// First segment (0-5s) should have 2 words
		expect(result.segments[0].wordCount).toBe(2);
		expect(result.segments[0].hasSpeech).toBe(true);
		// Second segment (5-10s) should have 1 word
		expect(result.segments[1].wordCount).toBe(1);
	});
});

describe("analyzeImportedClips", () => {
	test("analyzes only video assets", () => {
		const assets: MediaAsset[] = [
			buildTestAsset({ id: "v1", type: "video", duration: 10 }),
			buildTestAsset({ id: "a1", type: "audio", duration: 5 }),
			buildTestAsset({ id: "v2", type: "video", duration: 15 }),
		];

		const results = analyzeImportedClips({ assets, metadataById: {} });

		expect(results.length).toBe(2);
		expect(results.map((r) => r.assetId)).toEqual(["v1", "v2"]);
	});

	test("excludes ephemeral assets", () => {
		const assets: MediaAsset[] = [
			buildTestAsset({ id: "v1", type: "video", ephemeral: false }),
			buildTestAsset({ id: "v2", type: "video", ephemeral: true }),
		];

		const results = analyzeImportedClips({ assets, metadataById: {} });

		expect(results.length).toBe(1);
		expect(results[0].assetId).toBe("v1");
	});
});
