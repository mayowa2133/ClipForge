import { describe, expect, test } from "bun:test";
import {
	collectIncompatibleMediaReferences,
	collectUnverifiedMediaReferences,
} from "@/lib/clipforge/incompatible-media";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type { TimelineTrack } from "@/types/timeline";

function buildProject({
	tracks,
}: {
	tracks: TimelineTrack[];
}): TProject {
	return {
		metadata: {
			id: "project-incompatible-media",
			name: "Incompatible Media",
			duration: 10,
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
				tracks,
			},
		],
		currentSceneId: "scene-1",
		settings: {
			fps: 30,
			canvasSize: { width: 1080, height: 1920 },
			background: { type: "color", color: "#000000" },
		},
		version: 8,
	};
}

function buildMediaAssets(): MediaAsset[] {
	return [
		{
			id: "media-video-ok",
			name: "video-ok.mp4",
			type: "video",
			mimeType: "video/mp4",
			compatibility: {
				status: "compatible",
				videoDecode: "supported",
				audioDecode: "supported",
				reason: null,
				checkedAt: "2026-03-05T15:00:00.000Z",
				version: 1,
			},
			file: new File(["video"], "video-ok.mp4", { type: "video/mp4" }),
		},
		{
			id: "media-video-unverified",
			name: "video-unknown.mov",
			type: "video",
			mimeType: "video/quicktime",
			compatibility: {
				status: "unknown",
				videoDecode: "unknown",
				audioDecode: "unknown",
				reason: null,
				checkedAt: null,
				version: 1,
			},
			file: new File(["video"], "video-unknown.mov", { type: "video/quicktime" }),
		},
		{
			id: "media-video-audio-unsupported",
			name: "video-audio-unsupported.mp4",
			type: "video",
			mimeType: "video/mp4",
			compatibility: {
				status: "incompatible",
				videoDecode: "supported",
				audioDecode: "unsupported",
				reason: "audio-decode-unsupported",
				checkedAt: "2026-03-05T15:00:00.000Z",
				version: 1,
			},
			file: new File(["video"], "video-audio-unsupported.mp4", { type: "video/mp4" }),
		},
	];
}

describe("collectUnverifiedMediaReferences", () => {
	test("groups unresolved compatibility references by media id", () => {
		const project = buildProject({
			tracks: [
				{
					id: "video-track",
					name: "Video",
					type: "video",
					isMain: true,
					muted: false,
					hidden: false,
					elements: [
						{
							id: "seg-1",
							name: "A",
							type: "video",
							mediaId: "media-video-unverified",
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
		});

		const unverified = collectUnverifiedMediaReferences({
			project,
			mediaAssets: buildMediaAssets(),
			includeAudio: true,
		});

		expect(unverified).toHaveLength(1);
		expect(unverified[0]?.mediaId).toBe("media-video-unverified");
		expect(unverified[0]?.referenceCount).toBe(1);
		expect(unverified[0]?.compatibilityStatus).toBe("unknown");
	});
});

describe("collectIncompatibleMediaReferences", () => {
	test("returns audio decode incompatibility only when audio export is enabled", () => {
		const project = buildProject({
			tracks: [
				{
					id: "video-track",
					name: "Video",
					type: "video",
					isMain: true,
					muted: false,
					hidden: false,
					elements: [
						{
							id: "seg-1",
							name: "A",
							type: "video",
							mediaId: "media-video-audio-unsupported",
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
		});

		const withAudio = collectIncompatibleMediaReferences({
			project,
			mediaAssets: buildMediaAssets(),
			includeAudio: true,
		});
		const withoutAudio = collectIncompatibleMediaReferences({
			project,
			mediaAssets: buildMediaAssets(),
			includeAudio: false,
		});

		expect(withAudio).toHaveLength(1);
		expect(withAudio[0]?.mediaId).toBe("media-video-audio-unsupported");
		expect(withAudio[0]?.requiresAudioDecode).toBe(true);
		expect(withoutAudio).toHaveLength(0);
	});
});
