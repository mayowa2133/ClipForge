import { describe, expect, test } from "bun:test";
import {
	applyExportPreflightActions,
	evaluateExportPreflight,
} from "@/lib/clipforge/export-preflight";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type { AudioTrack, VideoTrack } from "@/types/timeline";

function buildMediaAssets(): MediaAsset[] {
	return [
		{
			id: "media-video-1",
			name: "main.mp4",
			type: "video",
			duration: 6,
			mimeType: "video/mp4",
			compatibility: {
				status: "compatible",
				videoDecode: "supported",
				audioDecode: "supported",
				reason: null,
				checkedAt: "2026-03-05T15:00:00.000Z",
				version: 1,
			},
			file: new File(["video"], "main.mp4", { type: "video/mp4" }),
		},
	];
}

function buildVideoTrack({
	trackId = "track-video-1",
	segmentId = "segment-video-1",
	mediaId = "media-video-1",
	duration = 4,
	startTime = 0,
}: {
	trackId?: string;
	segmentId?: string;
	mediaId?: string;
	duration?: number;
	startTime?: number;
} = {}): VideoTrack {
	return {
		id: trackId,
		name: "Video",
		type: "video",
		isMain: true,
		muted: false,
		hidden: false,
		elements: [
			{
				id: segmentId,
				name: "Primary",
				type: "video",
				mediaId,
				duration,
				startTime,
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
	};
}

function buildAudioTrack({
	trackId = "track-audio-1",
	segmentId = "segment-audio-1",
	mediaId = "song-1",
	role = "music",
	duration = 4,
	startTime = 0,
}: {
	trackId?: string;
	segmentId?: string;
	mediaId?: string;
	role?: "audio" | "voiceover" | "music" | "sfx";
	duration?: number;
	startTime?: number;
} = {}): AudioTrack {
	return {
		id: trackId,
		name: "Audio",
		type: "audio",
		isMain: false,
		muted: false,
		hidden: false,
		elements: [
			{
				id: segmentId,
				name: "Audio clip",
				type: "audio",
				sourceType: "upload",
				mediaId,
				role,
				duration,
				startTime,
				trimStart: 0,
				trimEnd: 0,
				volume: 1,
			},
		],
	};
}

function buildProject({
	tracks,
	duration = 4,
}: {
	tracks: TProject["scenes"][number]["tracks"];
	duration?: number;
}): TProject {
	return {
		metadata: {
			id: "project-export-preflight",
			name: "Preflight",
			duration,
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

describe("evaluateExportPreflight", () => {
	test("returns blocked no-active-project when project is missing", () => {
		const result = evaluateExportPreflight({
			project: null,
			mediaAssets: [],
			format: "mp4",
			quality: "high",
			includeAudio: true,
		});

		expect(result.ready).toBe(false);
		expect(result.blockingCount).toBe(1);
		expect(result.issues[0]?.code).toBe("no-active-project");
		expect(result.issues[0]?.id).toContain("issue-v1|no-active-project");
		expect(typeof result.computedAt).toBe("string");
		expect(result.healthFingerprint).toBe("health-v1|no-project|target:base");
	});

	test("returns blocked empty-project when timeline has no elements", () => {
		const project = buildProject({
			tracks: [],
			duration: 0,
		});
		const result = evaluateExportPreflight({
			project,
			mediaAssets: buildMediaAssets(),
			format: "mp4",
			quality: "high",
			includeAudio: true,
		});

		expect(result.ready).toBe(false);
		expect(result.issues.some((issue) => issue.code === "empty-project")).toBe(true);
	});

	test("reports missing media as actionable blocker", () => {
		const project = buildProject({
			tracks: [buildVideoTrack({ mediaId: "missing-media" })],
		});
		const result = evaluateExportPreflight({
			project,
			mediaAssets: buildMediaAssets(),
			format: "mp4",
			quality: "high",
			includeAudio: true,
		});

		const issue = result.issues.find((entry) => entry.code === "missing-media-asset");
		expect(result.ready).toBe(false);
		expect(issue?.actionable).toBe(true);
		expect(issue?.action).toBe("remove-missing-segments");
		expect(issue?.mediaId).toBe("missing-media");
		expect(issue?.referenceCount).toBe(1);
		expect(issue?.allowedReplacementTypes).toEqual(["video"]);
	});

	test("groups missing media issues by media id with aggregated reference counts", () => {
		const project = buildProject({
			tracks: [
				buildVideoTrack({
					trackId: "track-a",
					segmentId: "segment-a",
					mediaId: "missing-media",
					startTime: 0,
				}),
				buildVideoTrack({
					trackId: "track-b",
					segmentId: "segment-b",
					mediaId: "missing-media",
					startTime: 3,
				}),
			],
		});
		const result = evaluateExportPreflight({
			project,
			mediaAssets: buildMediaAssets(),
			format: "mp4",
			quality: "high",
			includeAudio: true,
		});

		const missingIssues = result.issues.filter(
			(entry) => entry.code === "missing-media-asset",
		);
		expect(missingIssues).toHaveLength(1);
		expect(missingIssues[0]?.mediaId).toBe("missing-media");
		expect(missingIssues[0]?.referenceCount).toBe(2);
	});

test("reports invalid ranges as actionable blocker", () => {
		const project = buildProject({
			tracks: [buildVideoTrack({ duration: 0 })],
		});
		const result = evaluateExportPreflight({
			project,
			mediaAssets: buildMediaAssets(),
			format: "mp4",
			quality: "high",
			includeAudio: true,
		});

		const issue = result.issues.find((entry) => entry.code === "invalid-segment-range");
		expect(result.ready).toBe(false);
		expect(issue?.actionable).toBe(true);
		expect(issue?.action).toBe("remove-invalid-ranges");
	});

	test("surfaces blockers from non-active scenes in assembled project scope", () => {
		const project = buildProject({
			tracks: [buildVideoTrack({ duration: 4 })],
			duration: 8,
		});
		project.scenes.push({
			id: "scene-2",
			name: "Second",
			isMain: false,
			bookmarks: [],
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
			tracks: [buildVideoTrack({ trackId: "track-2", segmentId: "segment-2", mediaId: "missing-media" })],
		});

		const result = evaluateExportPreflight({
			project,
			mediaAssets: buildMediaAssets(),
			format: "mp4",
			quality: "high",
			includeAudio: true,
		});

		expect(result.issues.some((issue) => issue.code === "missing-media-asset")).toBe(true);
	});

	test("reports media compatibility as blocked when unresolved", () => {
		const project = buildProject({
			tracks: [buildVideoTrack({ duration: 4 })],
			duration: 4,
		});
		const result = evaluateExportPreflight({
			project,
			mediaAssets: [
				{
					...buildMediaAssets()[0],
					compatibility: {
						status: "unknown",
						videoDecode: "unknown",
						audioDecode: "unknown",
						reason: null,
						checkedAt: null,
						version: 1,
					},
				},
			],
			format: "mp4",
			quality: "high",
			includeAudio: true,
		});
		const issue = result.issues.find(
			(entry) => entry.code === "media-compatibility-unverified",
		);
		expect(result.ready).toBe(false);
		expect(issue?.actionable).toBe(true);
		expect(issue?.action).toBe("scan-media-compatibility");
	});

	test("reports unsupported audio decode as disable-audio blocker", () => {
		const project = buildProject({
			tracks: [buildVideoTrack({ duration: 4 })],
			duration: 4,
		});
		const result = evaluateExportPreflight({
			project,
			mediaAssets: [
				{
					...buildMediaAssets()[0],
					compatibility: {
						status: "incompatible",
						videoDecode: "supported",
						audioDecode: "unsupported",
						reason: "audio-decode-unsupported",
						checkedAt: "2026-03-05T15:00:00.000Z",
						version: 1,
					},
				},
			],
			format: "mp4",
			quality: "high",
			includeAudio: true,
		});
		const issue = result.issues.find(
			(entry) => entry.code === "unsupported-audio-decode",
		);
		expect(result.ready).toBe(false);
		expect(issue?.actionable).toBe(true);
		expect(issue?.action).toBe("disable-export-audio");
	});

	test("reports timeline duration mismatch as actionable blocker", () => {
		const project = buildProject({
			tracks: [buildVideoTrack({ duration: 4 })],
			duration: 10,
		});
		const result = evaluateExportPreflight({
			project,
			mediaAssets: buildMediaAssets(),
			format: "mp4",
			quality: "high",
			includeAudio: true,
		});

		const issue = result.issues.find(
			(entry) => entry.code === "timeline-duration-mismatch",
		);
		expect(result.ready).toBe(false);
		expect(issue?.action).toBe("normalize-duration");
	});

	test("warns when imported music has unknown rights for the selected destination", () => {
		const project = buildProject({
			tracks: [buildVideoTrack({ duration: 4 }), buildAudioTrack()],
			duration: 4,
		});
		const result = evaluateExportPreflight({
			project,
			mediaAssets: [
				...buildMediaAssets(),
				{
					id: "song-1",
					name: "Imported song",
					type: "audio",
					duration: 12,
					file: new File(["audio"], "song.mp3", { type: "audio/mpeg" }),
					musicSourceType: "user-imported",
					rightsProfile: "unknown",
					allowedDestinations: null,
					attributionRequired: false,
					attributionText: null,
					sourceLabel: "Imported by user",
					sourceUrl: null,
				},
			],
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "instagram",
		});

		const warning = result.issues.find(
			(issue) => issue.code === "music-rights-unknown-warning",
		);
		expect(warning?.severity).toBe("warning");
		expect(warning?.publishDestination).toBe("instagram");
	});

	test("warns when platform-limited music is exported to a different destination", () => {
		const project = buildProject({
			tracks: [buildVideoTrack({ duration: 4 }), buildAudioTrack()],
			duration: 4,
		});
		const result = evaluateExportPreflight({
			project,
			mediaAssets: [
				...buildMediaAssets(),
				{
					id: "song-1",
					name: "TikTok-only song",
					type: "audio",
					duration: 12,
					file: new File(["audio"], "song.mp3", { type: "audio/mpeg" }),
					musicSourceType: "royalty-free-external",
					rightsProfile: "platform-limited",
					allowedDestinations: ["tiktok"],
					attributionRequired: true,
					attributionText: "Credit Example Artist",
					sourceLabel: "Example Library",
					sourceUrl: "https://example.com/song",
				},
			],
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "youtube",
		});

		expect(
			result.issues.some((issue) => issue.code === "music-platform-limited-warning"),
		).toBe(true);
		expect(
			result.issues.some((issue) => issue.code === "music-attribution-required-warning"),
		).toBe(true);
	});

	test("returns ready when only warnings are present", () => {
		const project = buildProject({
			tracks: [buildVideoTrack({ duration: 4 })],
			duration: 4,
		});
		const result = evaluateExportPreflight({
			project,
			mediaAssets: buildMediaAssets(),
			format: "webm",
			quality: "low",
			includeAudio: false,
		});

		expect(result.ready).toBe(true);
		expect(result.blockingCount).toBe(0);
		expect(result.warningCount).toBe(3);
		expect(result.issues.some((issue) => issue.code === "audio-disabled-warning")).toBe(
			true,
		);
		expect(result.issues.some((issue) => issue.code === "low-quality-warning")).toBe(
			true,
		);
		expect(result.issues.some((issue) => issue.code === "webm-compat-warning")).toBe(
			true,
		);
		expect(result.issues.every((issue) => issue.id.startsWith("issue-v1|"))).toBe(
			true,
		);
		expect(result.healthFingerprint.startsWith("health-v1|")).toBe(true);
	});

	test("missing-media issue id remains stable across repeated runs", () => {
		const project = buildProject({
			tracks: [buildVideoTrack({ mediaId: "missing-media" })],
		});
		const first = evaluateExportPreflight({
			project,
			mediaAssets: buildMediaAssets(),
			format: "mp4",
			quality: "high",
			includeAudio: true,
		});
		const second = evaluateExportPreflight({
			project,
			mediaAssets: buildMediaAssets(),
			format: "mp4",
			quality: "high",
			includeAudio: true,
		});

		const firstId = first.issues.find(
			(issue) => issue.code === "missing-media-asset",
		)?.id;
		const secondId = second.issues.find(
			(issue) => issue.code === "missing-media-asset",
		)?.id;
		expect(firstId).toBeTruthy();
		expect(firstId).toBe(secondId);
	});
});

describe("applyExportPreflightActions", () => {
	test("remove-missing-segments removes matching segments across project scenes", () => {
		let currentProject = buildProject({
			tracks: [buildVideoTrack({ mediaId: "missing-media" })],
			duration: 4,
		});
		const result = applyExportPreflightActions({
			project: currentProject,
			getProject: () => currentProject,
			mediaAssets: buildMediaAssets(),
			actions: ["remove-missing-segments"],
			setProject: ({ project }) => {
				currentProject = project;
			},
			markDirty: () => {},
		});

		expect(result.applied).toBe(1);
		expect(result.failed).toBe(0);
		expect(currentProject.scenes[0]?.tracks[0]?.elements).toEqual([]);
	});

	test("normalize-duration updates project metadata deterministically", () => {
		let currentProject = buildProject({
			tracks: [buildVideoTrack({ duration: 4 })],
			duration: 10,
		});
		let markedDirty = false;

		const result = applyExportPreflightActions({
			project: currentProject,
			getProject: () => currentProject,
			mediaAssets: buildMediaAssets(),
			actions: ["normalize-duration"],
			setProject: ({ project }) => {
				currentProject = project;
			},
			markDirty: () => {
				markedDirty = true;
			},
		});

		expect(result.applied).toBe(1);
		expect(result.failed).toBe(0);
		expect(currentProject.metadata.duration).toBe(4);
		expect(markedDirty).toBe(true);
	});

	test("unsupported UI-only action is reported as failed", () => {
		const project = buildProject({
			tracks: [buildVideoTrack({ duration: 4 })],
			duration: 4,
		});
		const result = applyExportPreflightActions({
			project,
			getProject: () => project,
			mediaAssets: buildMediaAssets(),
			actions: ["switch-format-mp4"],
			setProject: () => {},
			markDirty: () => {},
		});

		expect(result.applied).toBe(0);
		expect(result.failed).toBe(1);
		expect(
			result.messages.some((message) => message.includes("UI-only")),
		).toBe(true);
	});
});
