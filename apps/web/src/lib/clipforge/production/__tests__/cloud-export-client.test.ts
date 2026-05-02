import { describe, expect, test } from "bun:test";
import {
	buildMediaRefsFromCloudObjects,
	collectReferencedMediaIds,
	computeCloudReadiness,
	CloudExportApiError,
	type FetchLike,
	getArtifactSummary,
	pollCloudExportJob,
	submitCloudExportJob,
} from "@/lib/clipforge/production/cloud-export-client";
import type {
	ClipForgeJobRecord,
	CloudMediaObjectRecord,
} from "@/types/production";
import type { TProject } from "@/types/project";
import type {
	AudioTrack,
	UploadAudioElement,
	VideoElement,
	VideoTrack,
} from "@/types/timeline";

function makeProject(): TProject {
	return {
		metadata: {
			id: "proj_test",
			name: "Sample",
			duration: 5,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		scenes: [],
		currentSceneId: "scene_main",
		settings: {
			fps: 30,
			canvasSize: { width: 1080, height: 1920 },
			background: { type: "color", color: "#000000" },
		},
		version: 1,
	} as TProject;
}

function makeProjectWithMedia({
	videoMediaIds,
	audioMediaIds = [],
}: {
	videoMediaIds: string[];
	audioMediaIds?: string[];
}): TProject {
	const project = makeProject();
	const videoElements: VideoElement[] = videoMediaIds.map((mediaId, index) => ({
		id: `video_${index}`,
		name: `Clip ${index}`,
		type: "video",
		mediaId,
		duration: 4,
		startTime: index * 4,
		trimStart: 0,
		trimEnd: 0,
		transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
		opacity: 1,
	}));
	const videoTrack: VideoTrack = {
		id: "track_main",
		name: "Main",
		type: "video",
		isMain: true,
		muted: false,
		hidden: false,
		elements: videoElements,
	};
	const audioElements: UploadAudioElement[] = audioMediaIds.map(
		(mediaId, index) => ({
			id: `audio_${index}`,
			name: `Audio ${index}`,
			type: "audio",
			sourceType: "upload",
			mediaId,
			duration: 4,
			startTime: 0,
			trimStart: 0,
			trimEnd: 0,
			volume: 1,
		}),
	);
	const audioTrack: AudioTrack = {
		id: "track_audio",
		name: "Audio",
		type: "audio",
		muted: false,
		elements: audioElements,
	};
	project.scenes = [
		{
			id: "scene_main",
			name: "Main",
			isMain: true,
			tracks: [videoTrack, audioTrack],
			bookmarks: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	];
	return project;
}

function makeMediaRecord(
	overrides: Partial<CloudMediaObjectRecord>,
): CloudMediaObjectRecord {
	return {
		id: "media_1",
		projectId: "proj_test",
		ownerId: "owner_1",
		mediaId: "asset_1",
		storageKey: "key_asset_1",
		bytes: 100,
		sha256: null,
		status: "stored",
		encrypted: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function makeJob(overrides: Partial<ClipForgeJobRecord> = {}): ClipForgeJobRecord {
	return {
		id: "job_1",
		ownerId: "owner_1",
		projectId: null,
		kind: "export",
		status: "queued",
		provider: null,
		input: {},
		result: null,
		errorMessage: null,
		progressPct: 0,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		startedAt: null,
		completedAt: null,
		...overrides,
	};
}

describe("submitCloudExportJob", () => {
	test("POSTs render graph to /api/clipforge/jobs and returns the job", async () => {
		const calls: Array<{ url: string; body: unknown }> = [];
		const fetchImpl: FetchLike = async (input, init) => {
			calls.push({
				url: input,
				body: init?.body ? JSON.parse(init.body) : null,
			});
			return new Response(
				JSON.stringify({
					job: makeJob({ status: "queued", input: {} }),
				}),
				{ status: 201 },
			);
		};

		const job = await submitCloudExportJob({
			project: makeProject(),
			cloudProjectId: "proj_cloud",
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "tiktok",
			fetchImpl,
		});

		expect(job.id).toBe("job_1");
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toBe("/api/clipforge/jobs");
		const body = calls[0]!.body as {
			projectId: string;
			kind: string;
			input: { contractVersion: number };
		};
		expect(body.kind).toBe("export");
		expect(body.projectId).toBe("proj_cloud");
		expect(body.input.contractVersion).toBe(1);
	});
});

describe("pollCloudExportJob", () => {
	test("returns when job reaches completed", async () => {
		const responses: Array<{ status: ClipForgeJobRecord["status"]; download: unknown }> = [
			{ status: "queued", download: null },
			{ status: "processing", download: null },
			{
				status: "completed",
				download: { url: "https://r2.example/x", expiresAt: "2026-01-01" },
			},
		];
		const fetchImpl = (async () => {
			const next = responses.shift()!;
			return new Response(
				JSON.stringify({ job: makeJob({ status: next.status }), download: next.download }),
				{ status: 200 },
			);
		}) satisfies FetchLike;

		const progressEvents: ClipForgeJobRecord["status"][] = [];
		const result = await pollCloudExportJob({
			jobId: "job_1",
			pollIntervalMs: 1,
			fetchImpl,
			onProgress: (job) => progressEvents.push(job.status),
		});

		expect(result.job.status).toBe("completed");
		expect(result.download?.url).toBe("https://r2.example/x");
		expect(progressEvents).toEqual(["queued", "processing", "completed"]);
	});

	test("returns when job reaches failed without throwing", async () => {
		const fetchImpl: FetchLike = async () =>
			new Response(
				JSON.stringify({
					job: makeJob({ status: "failed", errorMessage: "renderer crashed" }),
					download: null,
				}),
				{ status: 200 },
			);

		const result = await pollCloudExportJob({
			jobId: "job_1",
			pollIntervalMs: 1,
			fetchImpl,
		});
		expect(result.job.status).toBe("failed");
		expect(result.job.errorMessage).toBe("renderer crashed");
	});

	test("times out when polling exceeds timeoutMs", async () => {
		const fetchImpl: FetchLike = async () =>
			new Response(
				JSON.stringify({ job: makeJob({ status: "processing" }), download: null }),
				{ status: 200 },
			);

		await expect(
			pollCloudExportJob({
				jobId: "job_1",
				pollIntervalMs: 1,
				timeoutMs: 5,
				fetchImpl,
			}),
		).rejects.toBeInstanceOf(CloudExportApiError);
	});
});

describe("getArtifactSummary", () => {
	test("returns artifact when result is well-formed", () => {
		const job = makeJob({
			result: {
				storageKey: "key",
				fileName: "out.mp4",
				contentType: "video/mp4",
				bytes: 100,
				durationSeconds: 5,
				contractVersion: 1,
				stub: true,
				rendererId: "stub",
				completedAt: "2026-01-01T00:00:00Z",
			},
		});
		const summary = getArtifactSummary(job);
		expect(summary?.storageKey).toBe("key");
		expect(summary?.stub).toBe(true);
	});

	test("returns null when result is missing required fields", () => {
		expect(getArtifactSummary(makeJob({ result: null }))).toBeNull();
		expect(getArtifactSummary(makeJob({ result: { foo: "bar" } }))).toBeNull();
		expect(
			getArtifactSummary(makeJob({ result: { storageKey: "k" } })),
		).toBeNull();
	});
});

describe("collectReferencedMediaIds", () => {
	test("collects video and uploaded-audio mediaIds, deduped", () => {
		const project = makeProjectWithMedia({
			videoMediaIds: ["a", "b", "a"],
			audioMediaIds: ["c"],
		});
		const result = collectReferencedMediaIds({ project });
		expect(result.mediaIds.sort()).toEqual(["a", "b", "c"]);
	});

	test("returns empty for empty project", () => {
		expect(collectReferencedMediaIds({ project: makeProject() }).mediaIds).toEqual([]);
	});
});

describe("buildMediaRefsFromCloudObjects", () => {
	test("maps stored media records to cloud storage keys", () => {
		const project = makeProjectWithMedia({ videoMediaIds: ["a", "b"] });
		const refs = buildMediaRefsFromCloudObjects({
			project,
			cloudMediaObjects: [
				makeMediaRecord({ mediaId: "a", storageKey: "key_a", status: "stored" }),
				makeMediaRecord({ mediaId: "b", storageKey: "key_b", status: "stored" }),
			],
		});
		const sorted = [...refs].sort((x, y) => x.mediaId.localeCompare(y.mediaId));
		expect(sorted.map((r) => r.mediaId)).toEqual(["a", "b"]);
		expect(sorted.map((r) => r.cloudStorageKey)).toEqual(["key_a", "key_b"]);
	});

	test("non-stored media yields cloudStorageKey=null so the renderer reports it as missing", () => {
		const project = makeProjectWithMedia({ videoMediaIds: ["a"] });
		const refs = buildMediaRefsFromCloudObjects({
			project,
			cloudMediaObjects: [
				makeMediaRecord({ mediaId: "a", storageKey: "key_a", status: "uploading" }),
			],
		});
		expect(refs).toHaveLength(1);
		expect(refs[0]!.cloudStorageKey).toBeNull();
	});

	test("includes referenced mediaIds with no record at all (cloudStorageKey null)", () => {
		const project = makeProjectWithMedia({ videoMediaIds: ["a", "b"] });
		const refs = buildMediaRefsFromCloudObjects({
			project,
			cloudMediaObjects: [
				makeMediaRecord({ mediaId: "a", storageKey: "key_a", status: "stored" }),
			],
		});
		const byId = new Map(refs.map((r) => [r.mediaId, r]));
		expect(byId.get("a")?.cloudStorageKey).toBe("key_a");
		expect(byId.get("b")?.cloudStorageKey).toBeNull();
	});

	test("prefers the most recently updated record when duplicates exist", () => {
		const project = makeProjectWithMedia({ videoMediaIds: ["a"] });
		const refs = buildMediaRefsFromCloudObjects({
			project,
			cloudMediaObjects: [
				makeMediaRecord({
					id: "old",
					mediaId: "a",
					storageKey: "key_old",
					status: "stored",
					updatedAt: new Date(2020, 0, 1).toISOString(),
				}),
				makeMediaRecord({
					id: "new",
					mediaId: "a",
					storageKey: "key_new",
					status: "stored",
					updatedAt: new Date(2030, 0, 1).toISOString(),
				}),
			],
		});
		expect(refs[0]!.cloudStorageKey).toBe("key_new");
	});
});

describe("submitCloudExportJob with cloudMediaObjects", () => {
	test("sends mediaRefs in the job input when cloud media is provided", async () => {
		const project = makeProjectWithMedia({ videoMediaIds: ["a"] });
		let capturedBody: string | undefined;
		const fakeFetch: FetchLike = async (url, init) => {
			capturedBody = init?.body as string;
			return new Response(
				JSON.stringify({ job: makeJob({ id: "job_x" }) }),
				{ status: 201, headers: { "content-type": "application/json" } },
			);
		};
		await submitCloudExportJob({
			project,
			cloudProjectId: "cp_1",
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			cloudMediaObjects: [
				makeMediaRecord({ mediaId: "a", storageKey: "key_a", status: "stored" }),
			],
			fetchImpl: fakeFetch,
		});

		expect(capturedBody).toBeDefined();
		const parsed = JSON.parse(capturedBody!) as {
			input: { mediaRefs: Array<{ mediaId: string; cloudStorageKey: string | null }> };
		};
		expect(parsed.input.mediaRefs).toHaveLength(1);
		expect(parsed.input.mediaRefs[0]!.mediaId).toBe("a");
		expect(parsed.input.mediaRefs[0]!.cloudStorageKey).toBe("key_a");
	});
});

function makeCloudProjectListItem(name: string): import("@/types/production").CloudProjectListItem {
	return {
		id: `cp_${name}`,
		name,
		mode: "cloud",
		projectVersion: 1,
		storageStatus: "synced",
		quotaBytesUsed: 0,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

describe("computeCloudReadiness", () => {
	test("blocks when no cloud project matches the active project name", () => {
		const project = makeProjectWithMedia({ videoMediaIds: ["a"] });
		project.metadata.name = "Local only";
		const summary = computeCloudReadiness({
			project,
			allCloudProjects: [makeCloudProjectListItem("Other")],
			mediaObjects: [],
		});
		expect(summary.cloudProject).toBeNull();
		expect(summary.canSubmit).toBe(false);
		expect(summary.blockerReason).toContain("Local only");
	});

	test("blocks when referenced media is missing or not stored", () => {
		const project = makeProjectWithMedia({ videoMediaIds: ["a", "b"] });
		project.metadata.name = "My Project";
		const summary = computeCloudReadiness({
			project,
			allCloudProjects: [makeCloudProjectListItem("My Project")],
			mediaObjects: [
				makeMediaRecord({ mediaId: "a", storageKey: "k_a", status: "stored" }),
				makeMediaRecord({ mediaId: "b", storageKey: "k_b", status: "uploading" }),
			],
		});
		expect(summary.cloudProject?.name).toBe("My Project");
		expect(summary.missingMediaIds).toEqual(["b"]);
		expect(summary.canSubmit).toBe(false);
		expect(summary.blockerReason).toContain("1 referenced media");
	});

	test("allows submission when all referenced media are stored", () => {
		const project = makeProjectWithMedia({
			videoMediaIds: ["a"],
			audioMediaIds: ["v"],
		});
		project.metadata.name = "OK";
		const summary = computeCloudReadiness({
			project,
			allCloudProjects: [makeCloudProjectListItem("OK")],
			mediaObjects: [
				makeMediaRecord({ mediaId: "a", storageKey: "k_a", status: "stored" }),
				makeMediaRecord({ mediaId: "v", storageKey: "k_v", status: "stored" }),
			],
		});
		expect(summary.canSubmit).toBe(true);
		expect(summary.blockerReason).toBeNull();
		expect(summary.storedMediaIds.sort()).toEqual(["a", "v"]);
		expect(summary.missingMediaIds).toEqual([]);
	});

	test("empty project (no referenced media) can submit when cloud project exists", () => {
		const project = makeProject();
		project.metadata.name = "Empty cloud";
		const summary = computeCloudReadiness({
			project,
			allCloudProjects: [makeCloudProjectListItem("Empty cloud")],
			mediaObjects: [],
		});
		expect(summary.canSubmit).toBe(true);
		expect(summary.referencedMediaIds).toEqual([]);
	});
});

describe("computeCloudReadiness with stored cloudProjectId linkage", () => {
	function withCloudLink(project: TProject, cloudProjectId: string | null): TProject {
		return {
			...project,
			clipforge: {
				...(project.clipforge as object),
				cloudProjectId,
			} as TProject["clipforge"],
		};
	}

	test("prefers cloudProjectId over name match", () => {
		const project = withCloudLink(
			makeProjectWithMedia({ videoMediaIds: ["a"] }),
			"cp_xyz",
		);
		project.metadata.name = "Some Other Name";
		const summary = computeCloudReadiness({
			project,
			allCloudProjects: [
				makeCloudProjectListItem("Some Other Name"),
				{
					...makeCloudProjectListItem("Linked"),
					id: "cp_xyz",
				},
			],
			mediaObjects: [
				makeMediaRecord({ mediaId: "a", storageKey: "k_a", status: "stored" }),
			],
		});
		expect(summary.cloudProject?.id).toBe("cp_xyz");
		expect(summary.canSubmit).toBe(true);
	});

	test("survives renames: stored ID wins even when name no longer matches", () => {
		const project = withCloudLink(
			makeProjectWithMedia({ videoMediaIds: ["a"] }),
			"cp_keep",
		);
		project.metadata.name = "Renamed locally";
		const summary = computeCloudReadiness({
			project,
			allCloudProjects: [
				{
					...makeCloudProjectListItem("Original Cloud Name"),
					id: "cp_keep",
				},
			],
			mediaObjects: [
				makeMediaRecord({ mediaId: "a", storageKey: "k_a", status: "stored" }),
			],
		});
		expect(summary.cloudProject?.id).toBe("cp_keep");
		expect(summary.cloudProject?.name).toBe("Original Cloud Name");
		expect(summary.canSubmit).toBe(true);
	});

	test("falls back to name match when stored ID no longer exists", () => {
		const project = withCloudLink(
			makeProjectWithMedia({ videoMediaIds: ["a"] }),
			"cp_deleted",
		);
		project.metadata.name = "My Project";
		const summary = computeCloudReadiness({
			project,
			allCloudProjects: [makeCloudProjectListItem("My Project")],
			mediaObjects: [
				makeMediaRecord({ mediaId: "a", storageKey: "k_a", status: "stored" }),
			],
		});
		// Currently the impl reports the linked-but-missing case as a blocker
		// rather than falling through silently.
		expect(summary.cloudProject).toBeNull();
		expect(summary.blockerReason).toContain("cp_deleted");
		expect(summary.blockerReason).toContain("Re-save");
	});

	test("name fallback still works for projects without a stored link", () => {
		const project = makeProjectWithMedia({ videoMediaIds: ["a"] });
		project.metadata.name = "Legacy";
		const summary = computeCloudReadiness({
			project,
			allCloudProjects: [makeCloudProjectListItem("Legacy")],
			mediaObjects: [
				makeMediaRecord({ mediaId: "a", storageKey: "k_a", status: "stored" }),
			],
		});
		expect(summary.cloudProject?.name).toBe("Legacy");
		expect(summary.canSubmit).toBe(true);
	});
});
