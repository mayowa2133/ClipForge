import { describe, expect, test } from "bun:test";
import {
	StubRenderEngine,
	runExportJob,
	runExportWorkerLoop,
	type RenderEngine,
	type WorkerHttpClient,
} from "@/lib/clipforge/production/worker/export-worker";
import { buildRenderGraphInput } from "@/lib/clipforge/production/render-graph";
import type { ClipForgeJobRecord } from "@/types/production";
import type { TProject } from "@/types/project";

function makeProject(): TProject {
	return {
		metadata: {
			id: "proj_test",
			name: "Sample Project",
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

function makeJob({
	overrides,
	withRenderGraph = true,
}: {
	overrides?: Partial<ClipForgeJobRecord>;
	withRenderGraph?: boolean;
}): ClipForgeJobRecord {
	const renderInput = withRenderGraph
		? (buildRenderGraphInput({
				project: makeProject(),
				format: "mp4",
				quality: "high",
				includeAudio: true,
				publishDestination: "generic-export",
			}) as unknown as Record<string, unknown>)
		: { random: "junk" };

	return {
		id: "job_1",
		ownerId: "owner_1",
		projectId: "proj_test",
		kind: "export",
		status: "queued",
		provider: null,
		input: renderInput,
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

interface MockState {
	patches: Array<{
		jobId: string;
		status: string;
		progressPct?: number;
		errorMessage?: string | null;
		result?: Record<string, unknown> | null;
	}>;
	uploads: Array<{ url: string; method: string; bodyLength: number }>;
	artifactRequests: Array<{ jobId: string; fileName: string; contentType: string }>;
}

function makeHttpClient({
	state,
	uploadOk = true,
}: {
	state: MockState;
	uploadOk?: boolean;
}): WorkerHttpClient {
	return {
		async claimNext() {
			throw new Error("claimNext should not be called in runExportJob tests");
		},
		async requestArtifactUpload({ jobId, fileName, contentType }) {
			state.artifactRequests.push({ jobId, fileName, contentType });
			return {
				storageKey: `clipforge/owner_1/proj_test/job-${jobId}-${fileName}`,
				upload: {
					url: "https://r2.example/clipforge/x?signed=1",
					method: "PUT",
					headers: {},
				},
			};
		},
		async uploadArtifact({ url, method, body }) {
			const length = typeof body === "string"
				? body.length
				: body instanceof Uint8Array
					? body.byteLength
					: 0;
			state.uploads.push({ url, method, bodyLength: length });
			return { ok: uploadOk, status: uploadOk ? 200 : 500 };
		},
		async patchJob(args) {
			state.patches.push({
				jobId: args.jobId,
				status: args.status,
				progressPct: args.progressPct,
				errorMessage: args.errorMessage,
				result: args.result,
			});
			return {
				job: {
					...makeJob({ overrides: { id: args.jobId, status: args.status as ClipForgeJobRecord["status"] } }),
				},
			};
		},
	};
}

describe("runExportJob", () => {
	test("happy path uses stub renderer, uploads artifact, completes job", async () => {
		const state: MockState = { patches: [], uploads: [], artifactRequests: [] };
		const result = await runExportJob({
			job: makeJob({}),
			engine: new StubRenderEngine(),
			http: makeHttpClient({ state }),
		});

		expect(result.status).toBe("completed");
		expect(result.artifact?.stub).toBe(true);
		expect(result.artifact?.contentType).toBe("application/json");

		const statuses = state.patches.map((p) => p.status);
		expect(statuses[0]).toBe("processing");
		expect(statuses[statuses.length - 1]).toBe("completed");
		expect(state.uploads).toHaveLength(1);
		expect(state.uploads[0]!.method).toBe("PUT");
		expect(state.artifactRequests).toHaveLength(1);
		expect(state.artifactRequests[0]!.fileName).toMatch(/\.mp4$/);

		const completePatch = state.patches.find((p) => p.status === "completed");
		expect(completePatch?.progressPct).toBe(100);
		expect(completePatch?.result).toBeDefined();
	});

	test("invalid render graph fails the job without uploading", async () => {
		const state: MockState = { patches: [], uploads: [], artifactRequests: [] };
		const result = await runExportJob({
			job: makeJob({ withRenderGraph: false }),
			engine: new StubRenderEngine(),
			http: makeHttpClient({ state }),
		});

		expect(result.status).toBe("skipped-invalid-input");
		expect(state.uploads).toHaveLength(0);
		expect(state.patches).toHaveLength(1);
		expect(state.patches[0]!.status).toBe("failed");
		expect(state.patches[0]!.errorMessage).toContain("contractVersion 1");
	});

	test("upload failure marks job failed", async () => {
		const state: MockState = { patches: [], uploads: [], artifactRequests: [] };
		const result = await runExportJob({
			job: makeJob({}),
			engine: new StubRenderEngine(),
			http: makeHttpClient({ state, uploadOk: false }),
		});

		expect(result.status).toBe("failed");
		expect(result.errorMessage).toContain("HTTP 500");
		expect(state.patches.at(-1)?.status).toBe("failed");
	});

	test("renderer throw is caught and reported as failure", async () => {
		const state: MockState = { patches: [], uploads: [], artifactRequests: [] };
		const throwingEngine: RenderEngine = {
			id: "throwing-renderer",
			async render() {
				throw new Error("renderer crashed");
			},
		};
		const result = await runExportJob({
			job: makeJob({}),
			engine: throwingEngine,
			http: makeHttpClient({ state }),
		});

		expect(result.status).toBe("failed");
		expect(result.errorMessage).toBe("renderer crashed");
		expect(state.uploads).toHaveLength(0);
	});
});

describe("runExportWorkerLoop", () => {
	test("processes a single job then exits with maxJobs=1", async () => {
		const state: MockState = { patches: [], uploads: [], artifactRequests: [] };
		const baseClient = makeHttpClient({ state });
		const queue: Array<ClipForgeJobRecord | null> = [makeJob({})];
		const http: WorkerHttpClient = {
			...baseClient,
			async claimNext() {
				return { job: queue.shift() ?? null };
			},
		};

		const result = await runExportWorkerLoop({
			http,
			engine: new StubRenderEngine(),
			pollIntervalMs: 0,
			maxJobs: 1,
			logger: () => undefined,
		});

		expect(result.processed).toBe(1);
		expect(state.patches.at(-1)?.status).toBe("completed");
	});

	test("respects abort signal when no jobs are queued", async () => {
		const state: MockState = { patches: [], uploads: [], artifactRequests: [] };
		const baseClient = makeHttpClient({ state });
		const controller = new AbortController();
		const http: WorkerHttpClient = {
			...baseClient,
			async claimNext() {
				return { job: null };
			},
		};

		setTimeout(() => controller.abort(), 5);
		const result = await runExportWorkerLoop({
			http,
			engine: new StubRenderEngine(),
			pollIntervalMs: 10,
			signal: controller.signal,
			logger: () => undefined,
		});
		expect(result.processed).toBe(0);
	});
});
