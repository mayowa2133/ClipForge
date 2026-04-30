import type { ClipForgeJobRecord } from "@/types/production";
import type { WorkerHttpClient } from "./export-worker";

export interface HttpWorkerClientArgs {
	baseUrl: string;
	bearerSecret: string;
	workerId: string;
	fetchImpl?: typeof fetch;
}

export class HttpWorkerClient implements WorkerHttpClient {
	private readonly baseUrl: string;
	private readonly bearerSecret: string;
	private readonly workerId: string;
	private readonly fetchImpl: typeof fetch;

	constructor({
		baseUrl,
		bearerSecret,
		workerId,
		fetchImpl = fetch,
	}: HttpWorkerClientArgs) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
		this.bearerSecret = bearerSecret;
		this.workerId = workerId;
		this.fetchImpl = fetchImpl;
	}

	private headers(): Record<string, string> {
		return {
			authorization: `Bearer ${this.bearerSecret}`,
			"content-type": "application/json",
			"x-clipforge-worker-id": this.workerId,
		};
	}

	private url(path: string): string {
		return `${this.baseUrl}${path}`;
	}

	async claimNext({
		kind,
	}: {
		kind: "export" | "transcription";
	}): Promise<{ job: ClipForgeJobRecord | null }> {
		const response = await this.fetchImpl(this.url("/api/clipforge/internal/jobs/claim"), {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({ kind }),
		});
		if (!response.ok) {
			throw new Error(
				`Worker claim failed: ${response.status} ${await response.text().catch(() => "")}`,
			);
		}
		return (await response.json()) as { job: ClipForgeJobRecord | null };
	}

	async requestArtifactUpload({
		jobId,
		fileName,
		contentType,
	}: {
		jobId: string;
		fileName: string;
		contentType: string;
	}): Promise<{
		storageKey: string;
		upload: { url: string; method: "PUT"; headers: Record<string, string> };
	}> {
		const response = await this.fetchImpl(
			this.url(`/api/clipforge/internal/jobs/${encodeURIComponent(jobId)}/artifact`),
			{
				method: "POST",
				headers: this.headers(),
				body: JSON.stringify({ fileName, contentType }),
			},
		);
		if (!response.ok) {
			throw new Error(
				`Worker artifact-upload request failed: ${response.status} ${await response.text().catch(() => "")}`,
			);
		}
		return (await response.json()) as {
			storageKey: string;
			upload: { url: string; method: "PUT"; headers: Record<string, string> };
		};
	}

	async uploadArtifact({
		url,
		method,
		headers,
		body,
	}: {
		url: string;
		method: "PUT";
		headers: Record<string, string>;
		body: BodyInit;
	}): Promise<{ ok: boolean; status: number }> {
		const response = await this.fetchImpl(url, {
			method,
			headers,
			body,
		});
		return { ok: response.ok, status: response.status };
	}

	async presignMediaDownload({
		storageKey,
	}: {
		storageKey: string;
	}): Promise<{ url: string; expiresAt: string }> {
		const response = await this.fetchImpl(
			this.url("/api/clipforge/internal/media/download-url"),
			{
				method: "POST",
				headers: this.headers(),
				body: JSON.stringify({ storageKey }),
			},
		);
		if (!response.ok) {
			throw new Error(
				`Worker media download presign failed: ${response.status} ${await response.text().catch(() => "")}`,
			);
		}
		const body = (await response.json()) as {
			download: { url: string; expiresAt: string };
		};
		return body.download;
	}

	async patchJob({
		jobId,
		status,
		progressPct,
		result,
		errorMessage,
	}: {
		jobId: string;
		status: "processing" | "completed" | "failed";
		progressPct?: number;
		result?: Record<string, unknown> | null;
		errorMessage?: string | null;
	}): Promise<{ job: ClipForgeJobRecord }> {
		const response = await this.fetchImpl(
			this.url(`/api/clipforge/internal/jobs/${encodeURIComponent(jobId)}`),
			{
				method: "PATCH",
				headers: this.headers(),
				body: JSON.stringify({ status, progressPct, result, errorMessage }),
			},
		);
		if (!response.ok) {
			throw new Error(
				`Worker job patch failed: ${response.status} ${await response.text().catch(() => "")}`,
			);
		}
		return (await response.json()) as { job: ClipForgeJobRecord };
	}
}
