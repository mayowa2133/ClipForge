import {
	buildTranscriptionGraphInput,
	type TranscriptionGraphResult,
} from "@/lib/clipforge/production/transcription-graph";
import type { ClipForgeJobRecord } from "@/types/production";

export class TranscriptionJobApiError extends Error {
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
		throw new TranscriptionJobApiError(message, response.status);
	}
	return (await response.json()) as T;
}

export interface SubmitTranscriptionJobArgs {
	cloudProjectId: string | null;
	mediaId: string;
	mediaStorageKey: string;
	mediaContentType?: string | null;
	durationSeconds?: number | null;
	languageHint?: string | null;
	diarization?: boolean;
	provider?: string;
	fetchImpl?: FetchLike;
}

export async function submitTranscriptionJob({
	cloudProjectId,
	mediaId,
	mediaStorageKey,
	mediaContentType,
	durationSeconds,
	languageHint,
	diarization,
	provider = "modal",
	fetchImpl,
}: SubmitTranscriptionJobArgs): Promise<ClipForgeJobRecord> {
	const input = buildTranscriptionGraphInput({
		projectId: cloudProjectId,
		mediaId,
		mediaStorageKey,
		mediaContentType: mediaContentType ?? null,
		durationSeconds: durationSeconds ?? null,
		languageHint: languageHint ?? null,
		diarization: diarization ?? false,
	});
	const callFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
	const response = await callFetch("/api/clipforge/jobs", {
		method: "POST",
		credentials: "include",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			projectId: cloudProjectId,
			kind: "transcription",
			provider,
			input,
		}),
	});
	const body = await readJson<{ job: ClipForgeJobRecord }>(response);
	return body.job;
}

export interface PollTranscriptionJobArgs {
	jobId: string;
	pollIntervalMs?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
	onProgress?: (job: ClipForgeJobRecord) => void;
	fetchImpl?: FetchLike;
}

export interface PollTranscriptionJobResult {
	job: ClipForgeJobRecord;
	result: TranscriptionGraphResult | null;
}

export async function pollTranscriptionJob({
	jobId,
	pollIntervalMs = 2_000,
	timeoutMs = 5 * 60_000,
	signal,
	onProgress,
	fetchImpl,
}: PollTranscriptionJobArgs): Promise<PollTranscriptionJobResult> {
	const callFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
	const start = Date.now();
	while (true) {
		if (signal?.aborted) {
			throw new TranscriptionJobApiError("Polling aborted.", 0);
		}
		const response = await callFetch(
			`/api/clipforge/jobs/${encodeURIComponent(jobId)}`,
			{ credentials: "include", cache: "no-store" },
		);
		const body = await readJson<{ job: ClipForgeJobRecord }>(response);
		onProgress?.(body.job);

		if (
			body.job.status === "completed" ||
			body.job.status === "failed" ||
			body.job.status === "cancelled"
		) {
			return {
				job: body.job,
				result: extractTranscriptionResult(body.job),
			};
		}
		if (Date.now() - start > timeoutMs) {
			throw new TranscriptionJobApiError(
				`Transcription job ${jobId} did not complete within ${Math.round(timeoutMs / 1000)}s.`,
				504,
			);
		}
		await sleep(pollIntervalMs, signal);
	}
}

export function extractTranscriptionResult(
	job: ClipForgeJobRecord,
): TranscriptionGraphResult | null {
	const result = job.result;
	if (!result || typeof result !== "object") return null;
	const candidate = result as Record<string, unknown>;
	if (candidate.contractVersion !== 1) return null;
	if (typeof candidate.mediaId !== "string") return null;
	if (!Array.isArray(candidate.words) || !Array.isArray(candidate.segments)) return null;
	return result as unknown as TranscriptionGraphResult;
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
