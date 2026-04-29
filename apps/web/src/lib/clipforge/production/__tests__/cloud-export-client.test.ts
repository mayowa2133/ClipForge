import { describe, expect, test } from "bun:test";
import {
	CloudExportApiError,
	type FetchLike,
	getArtifactSummary,
	pollCloudExportJob,
	submitCloudExportJob,
} from "@/lib/clipforge/production/cloud-export-client";
import type { ClipForgeJobRecord } from "@/types/production";
import type { TProject } from "@/types/project";

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
