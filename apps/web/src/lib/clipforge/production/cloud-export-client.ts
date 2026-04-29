import {
	buildRenderGraphInput,
	type RenderArtifactSummary,
} from "@/lib/clipforge/production/render-graph";
import type { ExportFormat, ExportQuality, PublishDestination } from "@/types/export";
import type { ClipForgeJobRecord } from "@/types/production";
import type { TProject } from "@/types/project";

export class CloudExportApiError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

export type FetchLike = (
	input: string,
	init?: {
		method?: string;
		credentials?: RequestCredentials;
		headers?: Record<string, string>;
		body?: string;
		cache?: RequestCache;
	},
) => Promise<Response>;

async function readJson<T>(response: Response): Promise<T> {
	if (!response.ok) {
		let message = `Request failed with status ${response.status}`;
		try {
			const body = (await response.json()) as { error?: string };
			if (body && typeof body.error === "string") message = body.error;
		} catch {}
		throw new CloudExportApiError(message, response.status);
	}
	return (await response.json()) as T;
}

export interface SubmitCloudExportArgs {
	project: TProject;
	cloudProjectId: string | null;
	format: ExportFormat;
	quality: ExportQuality;
	includeAudio: boolean;
	publishDestination: PublishDestination;
	fetchImpl?: FetchLike;
}

export async function submitCloudExportJob({
	project,
	cloudProjectId,
	format,
	quality,
	includeAudio,
	publishDestination,
	fetchImpl,
}: SubmitCloudExportArgs): Promise<ClipForgeJobRecord> {
	const input = buildRenderGraphInput({
		project,
		format,
		quality,
		includeAudio,
		publishDestination,
	});
	const callFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
	const response = await callFetch("/api/clipforge/jobs", {
		method: "POST",
		credentials: "include",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			projectId: cloudProjectId,
			kind: "export",
			provider: "stub",
			input,
		}),
	});
	const body = await readJson<{ job: ClipForgeJobRecord }>(response);
	return body.job;
}

export interface PollCloudExportJobArgs {
	jobId: string;
	pollIntervalMs?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
	onProgress?: (job: ClipForgeJobRecord) => void;
	fetchImpl?: FetchLike;
}

export interface CloudExportPollResult {
	job: ClipForgeJobRecord;
	download: { url: string; expiresAt: string } | null;
}

export async function pollCloudExportJob({
	jobId,
	pollIntervalMs = 2_000,
	timeoutMs = 5 * 60_000,
	signal,
	onProgress,
	fetchImpl,
}: PollCloudExportJobArgs): Promise<CloudExportPollResult> {
	const callFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
	const start = Date.now();
	while (true) {
		if (signal?.aborted) {
			throw new CloudExportApiError("Polling aborted.", 0);
		}
		const response = await callFetch(
			`/api/clipforge/jobs/${encodeURIComponent(jobId)}`,
			{ credentials: "include", cache: "no-store" },
		);
		const body = await readJson<CloudExportPollResult>(response);
		onProgress?.(body.job);

		if (
			body.job.status === "completed" ||
			body.job.status === "failed" ||
			body.job.status === "cancelled"
		) {
			return body;
		}
		if (Date.now() - start > timeoutMs) {
			throw new CloudExportApiError(
				`Cloud export job ${jobId} did not complete within ${Math.round(timeoutMs / 1000)}s.`,
				504,
			);
		}
		await sleep(pollIntervalMs, signal);
	}
}

export function getArtifactSummary(
	job: ClipForgeJobRecord,
): RenderArtifactSummary | null {
	const result = job.result;
	if (!result || typeof result !== "object") return null;
	if (
		typeof (result as Record<string, unknown>).storageKey !== "string" ||
		typeof (result as Record<string, unknown>).fileName !== "string"
	) {
		return null;
	}
	return result as unknown as RenderArtifactSummary;
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
