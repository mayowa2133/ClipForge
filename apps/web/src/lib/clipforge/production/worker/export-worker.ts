import {
	defaultArtifactFileName,
	isRenderGraphInput,
	type RenderArtifactSummary,
	type RenderGraphInput,
} from "@/lib/clipforge/production/render-graph";
import type { ClipForgeJobRecord } from "@/types/production";

export type WorkerJobKind = "export" | "transcription";

export interface WorkerHttpClient {
	claimNext(args: {
		kind: WorkerJobKind;
	}): Promise<{ job: ClipForgeJobRecord | null }>;
	requestArtifactUpload(args: {
		jobId: string;
		fileName: string;
		contentType: string;
	}): Promise<{
		storageKey: string;
		upload: { url: string; method: "PUT"; headers: Record<string, string> };
	}>;
	uploadArtifact(args: {
		url: string;
		method: "PUT";
		headers: Record<string, string>;
		body: BodyInit;
	}): Promise<{ ok: boolean; status: number }>;
	patchJob(args: {
		jobId: string;
		status: "processing" | "completed" | "failed";
		progressPct?: number;
		result?: Record<string, unknown> | null;
		errorMessage?: string | null;
	}): Promise<{ job: ClipForgeJobRecord }>;
	presignMediaDownload?(args: {
		storageKey: string;
	}): Promise<{ url: string; expiresAt: string }>;
}

export interface RenderEngine {
	id: string;
	render({
		input,
		onProgress,
	}: {
		input: RenderGraphInput;
		onProgress: (pct: number) => Promise<void>;
	}): Promise<{
		body: BodyInit;
		bytes: number;
		contentType: string;
		stub: boolean;
		durationSeconds: number;
	}>;
}

export class StubRenderEngine implements RenderEngine {
	readonly id = "clipforge-stub-renderer";

	async render({
		input,
		onProgress,
	}: {
		input: RenderGraphInput;
		onProgress: (pct: number) => Promise<void>;
	}): Promise<{
		body: BodyInit;
		bytes: number;
		contentType: string;
		stub: boolean;
		durationSeconds: number;
	}> {
		await onProgress(10);
		const payload = JSON.stringify(
			{
				kind: "clipforge-cloud-render-stub",
				message:
					"This is a placeholder artifact produced by the stub renderer. " +
					"Replace with a real ffmpeg/Mediabunny worker to produce playable video.",
				input: {
					projectId: input.projectId,
					projectName: input.projectName,
					projectVersion: input.projectVersion,
					format: input.format,
					quality: input.quality,
					includeAudio: input.includeAudio,
					publishDestination: input.publishDestination,
					canvasSize: input.canvasSize,
					durationSeconds: input.durationSeconds,
					sceneCount: input.sceneCount,
				},
				generatedAt: new Date().toISOString(),
			},
			null,
			2,
		);
		await onProgress(80);
		const bytes = new TextEncoder().encode(payload);
		return {
			body: bytes,
			bytes: bytes.byteLength,
			contentType: "application/json",
			stub: true,
			durationSeconds: input.durationSeconds,
		};
	}
}

export interface RunExportJobResult {
	status: "completed" | "failed" | "skipped-invalid-input";
	jobId: string | null;
	artifact?: RenderArtifactSummary;
	errorMessage?: string;
}

export async function runExportJob({
	job,
	engine,
	http,
}: {
	job: ClipForgeJobRecord;
	engine: RenderEngine;
	http: WorkerHttpClient;
}): Promise<RunExportJobResult> {
	if (!isRenderGraphInput(job.input)) {
		const errorMessage =
			"Job input is not a valid render graph (contractVersion 1 expected).";
		await http.patchJob({
			jobId: job.id,
			status: "failed",
			errorMessage,
		});
		return { status: "skipped-invalid-input", jobId: job.id, errorMessage };
	}

	const input = job.input as unknown as RenderGraphInput;
	const fileName = defaultArtifactFileName({ input });

	try {
		await http.patchJob({
			jobId: job.id,
			status: "processing",
			progressPct: 5,
		});

		const rendered = await engine.render({
			input,
			onProgress: async (pct) => {
				await http.patchJob({
					jobId: job.id,
					status: "processing",
					progressPct: Math.max(5, Math.min(90, pct)),
				});
			},
		});

		const upload = await http.requestArtifactUpload({
			jobId: job.id,
			fileName,
			contentType: rendered.contentType,
		});

		const putResult = await http.uploadArtifact({
			url: upload.upload.url,
			method: upload.upload.method,
			headers: { ...upload.upload.headers, "content-type": rendered.contentType },
			body: rendered.body,
		});

		if (!putResult.ok) {
			const errorMessage = `Artifact upload failed with HTTP ${putResult.status}.`;
			await http.patchJob({ jobId: job.id, status: "failed", errorMessage });
			return { status: "failed", jobId: job.id, errorMessage };
		}

		const artifact: RenderArtifactSummary = {
			storageKey: upload.storageKey,
			contentType: rendered.contentType,
			fileName,
			bytes: rendered.bytes,
			durationSeconds: rendered.durationSeconds,
			contractVersion: 1,
			stub: rendered.stub,
			rendererId: engine.id,
			completedAt: new Date().toISOString(),
		};

		await http.patchJob({
			jobId: job.id,
			status: "completed",
			progressPct: 100,
			result: artifact as unknown as Record<string, unknown>,
		});

		return { status: "completed", jobId: job.id, artifact };
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Render failed unexpectedly.";
		await http.patchJob({ jobId: job.id, status: "failed", errorMessage });
		return { status: "failed", jobId: job.id, errorMessage };
	}
}

export interface ExportWorkerLoopOptions {
	http: WorkerHttpClient;
	engine: RenderEngine;
	pollIntervalMs?: number;
	maxJobs?: number;
	signal?: AbortSignal;
	logger?: (message: string, meta?: Record<string, unknown>) => void;
}

export async function runExportWorkerLoop({
	http,
	engine,
	pollIntervalMs = 2_000,
	maxJobs = Infinity,
	signal,
	logger = (message) => console.log(`[export-worker] ${message}`),
}: ExportWorkerLoopOptions): Promise<{ processed: number }> {
	let processed = 0;
	while (processed < maxJobs) {
		if (signal?.aborted) break;
		const claim = await http.claimNext({ kind: "export" });
		if (!claim.job) {
			if (signal?.aborted) break;
			await sleep(pollIntervalMs, signal);
			continue;
		}
		logger("claimed job", { jobId: claim.job.id });
		const result = await runExportJob({ job: claim.job, engine, http });
		processed += 1;
		logger("finished job", {
			jobId: result.jobId,
			status: result.status,
			error: result.errorMessage,
		});
	}
	return { processed };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timeout);
			resolve();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
