import { describe, expect, test } from "bun:test";
import {
	buildAutoEditTikTokDraft,
	buildDefaultClipForgeProjectData,
	scoreRawAsset,
	rankVideoAssets,
} from "@/lib/clipforge";
import type { MediaAsset, MediaVisualAnalysis } from "@/types/assets";
import type { ClipMediaMetadata } from "@/types/clipforge";
import type { TProject } from "@/types/project";

function buildProjectFixture(): TProject {
	return {
		metadata: {
			id: "project-auto-edit-1",
			name: "Auto Edit",
			duration: 0,
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
						id: "video-track-main",
						type: "video",
						name: "Main video",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [],
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

function makeVideoAsset({
	id,
	name,
	duration,
}: {
	id: string;
	name: string;
	duration: number;
}): MediaAsset {
	return {
		id,
		name,
		type: "video",
		duration,
		file: new File(["video"], `${name}.mp4`, { type: "video/mp4" }),
	};
}

function buildMetadata(
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
		indexedAt: null,
		...overrides,
	};
}

describe("scoreRawAsset", () => {
	test("returns a positive score for an asset with visual analysis", () => {
		const asset = makeVideoAsset({ id: "v1", name: "action", duration: 10 });
		const analysis: MediaVisualAnalysis = {
			sceneCuts: [2, 5],
			activityWindows: [
				{ startTime: 0, endTime: 3, score: 1.2 },
				{ startTime: 3, endTime: 6, score: 0.8 },
			],
			analyzedAt: "2026-01-01",
			version: 1,
		};
		(asset as MediaAsset & { visualAnalysis: MediaVisualAnalysis }).visualAnalysis = analysis;
		const score = scoreRawAsset({ asset, metadata: null });
		expect(score).toBeGreaterThan(0);
	});

	test("penalizes heavy silence", () => {
		const asset = makeVideoAsset({ id: "v2", name: "quiet", duration: 10 });
		const silentMetadata = buildMetadata({
			silenceRegions: [{ start_ms: 0, end_ms: 8000 }],
		});
		const talkyMetadata = buildMetadata({
			words: Array.from({ length: 30 }, (_, i) => ({
				text: "word",
				start_ms: i * 300,
				end_ms: i * 300 + 200,
			})),
		});

		const silentScore = scoreRawAsset({ asset, metadata: silentMetadata });
		const talkyScore = scoreRawAsset({ asset, metadata: talkyMetadata });

		expect(talkyScore).toBeGreaterThan(silentScore);
	});

	test("gives bonus for clips in the 5-30s sweet spot", () => {
		const short = makeVideoAsset({ id: "s", name: "short", duration: 15 });
		const long = makeVideoAsset({ id: "l", name: "long", duration: 120 });

		const shortScore = scoreRawAsset({ asset: short, metadata: null });
		const longScore = scoreRawAsset({ asset: long, metadata: null });

		expect(shortScore).toBeGreaterThan(longScore);
	});

	test("gives scene-cut bonus for clips with scene cuts", () => {
		const withCuts = makeVideoAsset({ id: "c1", name: "cuts", duration: 10 });
		(withCuts as MediaAsset & { visualAnalysis: MediaVisualAnalysis }).visualAnalysis = {
			sceneCuts: [1, 3, 5],
			activityWindows: [],
			analyzedAt: "2026-01-01",
			version: 1,
		};
		const noCuts = makeVideoAsset({ id: "c2", name: "nocuts", duration: 10 });
		(noCuts as MediaAsset & { visualAnalysis: MediaVisualAnalysis }).visualAnalysis = {
			sceneCuts: [],
			activityWindows: [],
			analyzedAt: "2026-01-01",
			version: 1,
		};

		const withCutsScore = scoreRawAsset({ asset: withCuts, metadata: null });
		const noCutsScore = scoreRawAsset({ asset: noCuts, metadata: null });

		expect(withCutsScore).toBeGreaterThan(noCutsScore);
	});
});

describe("rankVideoAssets", () => {
	test("falls back to alphabetical when no metadata exists", () => {
		const project = buildProjectFixture();
		const assets = [
			makeVideoAsset({ id: "c", name: "c_clip", duration: 5 }),
			makeVideoAsset({ id: "a", name: "a_clip", duration: 5 }),
			makeVideoAsset({ id: "b", name: "b_clip", duration: 5 }),
		];

		const ranked = rankVideoAssets({ videoAssets: assets, project });

		expect(ranked.map((a) => a.id)).toEqual(["a", "b", "c"]);
	});

	test("ranks by score when metadata is available", () => {
		const project = buildProjectFixture();
		project.clipforge = {
			...buildDefaultClipForgeProjectData(),
			mediaMetadataById: {
				weak: buildMetadata({
					silenceRegions: [{ start_ms: 0, end_ms: 9000 }],
				}),
				strong: buildMetadata({
					words: Array.from({ length: 25 }, (_, i) => ({
						text: "word",
						start_ms: i * 400,
						end_ms: i * 400 + 300,
					})),
				}),
			},
		};

		const assets = [
			makeVideoAsset({ id: "weak", name: "z_weak", duration: 10 }),
			makeVideoAsset({ id: "strong", name: "a_strong", duration: 10 }),
		];

		const ranked = rankVideoAssets({ videoAssets: assets, project });

		expect(ranked[0].id).toBe("strong");
	});
});

describe("buildAutoEditTikTokDraft", () => {
	test("stitches video clips in stable name order when no metadata and applies tiktok preset", () => {
		const project = buildProjectFixture();
		const mediaAssets: MediaAsset[] = [
			makeVideoAsset({ id: "clip-b", name: "b_clip", duration: 3 }),
			makeVideoAsset({ id: "clip-a", name: "a_clip", duration: 2 }),
			{
				id: "image-1",
				name: "cover",
				type: "image",
				file: new File(["img"], "cover.png", { type: "image/png" }),
			},
		];

		const drafted = buildAutoEditTikTokDraft({ project, mediaAssets });
		const activeScene =
			drafted.scenes.find((scene) => scene.id === drafted.currentSceneId) ??
			drafted.scenes[0];
		const mainTrack = activeScene.tracks.find(
			(track) => track.type === "video" && track.isMain,
		);

		expect(drafted.settings.canvasSize).toEqual({ width: 1080, height: 1920 });
		expect(mainTrack?.type).toBe("video");
		if (mainTrack?.type === "video") {
			expect(mainTrack.elements).toHaveLength(2);
			expect(mainTrack.elements[0].mediaId).toBe("clip-a");
			expect(mainTrack.elements[0].startTime).toBe(0);
			expect(mainTrack.elements[1].mediaId).toBe("clip-b");
			expect(mainTrack.elements[1].startTime).toBe(2);
		}

		const audit = drafted.clipforge?.opsAudit.at(-1);
		expect(audit?.source).toBe("auto-edit");
		expect(audit?.ops.map((op) => op.type)).toEqual([
			"SET_ASPECT_RATIO",
			"REMOVE_SILENCE",
		]);
	});

	test("ranks clips by metadata score when available", () => {
		const project = buildProjectFixture();
		project.clipforge = {
			...buildDefaultClipForgeProjectData(),
			mediaMetadataById: {
				"clip-z": buildMetadata({
					words: Array.from({ length: 20 }, (_, i) => ({
						text: "talk",
						start_ms: i * 500,
						end_ms: i * 500 + 400,
					})),
				}),
				"clip-a": buildMetadata({
					silenceRegions: [{ start_ms: 0, end_ms: 4500 }],
				}),
			},
		};

		const mediaAssets: MediaAsset[] = [
			makeVideoAsset({ id: "clip-a", name: "a_first_alphabetically", duration: 5 }),
			makeVideoAsset({ id: "clip-z", name: "z_last_alphabetically", duration: 10 }),
		];

		const drafted = buildAutoEditTikTokDraft({ project, mediaAssets });
		const activeScene =
			drafted.scenes.find((scene) => scene.id === drafted.currentSceneId) ??
			drafted.scenes[0];
		const mainTrack = activeScene.tracks.find(
			(track) => track.type === "video" && track.isMain,
		);

		if (mainTrack?.type === "video") {
			// clip-z should be first because it has more engaging content
			expect(mainTrack.elements[0].mediaId).toBe("clip-z");
		}
	});

	test("excludes ephemeral assets", () => {
		const project = buildProjectFixture();
		const mediaAssets: MediaAsset[] = [
			makeVideoAsset({ id: "clip-real", name: "real", duration: 5 }),
			{
				...makeVideoAsset({ id: "clip-temp", name: "temp", duration: 3 }),
				ephemeral: true,
			},
		];

		const drafted = buildAutoEditTikTokDraft({ project, mediaAssets });
		const activeScene =
			drafted.scenes.find((scene) => scene.id === drafted.currentSceneId) ??
			drafted.scenes[0];
		const mainTrack = activeScene.tracks.find(
			(track) => track.type === "video" && track.isMain,
		);

		if (mainTrack?.type === "video") {
			expect(mainTrack.elements).toHaveLength(1);
			expect(mainTrack.elements[0].mediaId).toBe("clip-real");
		}
	});
});
