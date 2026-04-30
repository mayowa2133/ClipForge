import {
	isTranscriptionGraphInput,
	type TranscriptionGraphInput,
	type TranscriptionGraphResult,
	type TranscriptionSegment,
	type TranscriptionWord,
} from "@/lib/clipforge/production/transcription-graph";
import type { ClipForgeJobRecord } from "@/types/production";
import type { WorkerHttpClient } from "./export-worker";

export interface TranscriptionEngine {
	id: string;
	transcribe(args: {
		input: TranscriptionGraphInput;
		mediaDownloadUrl: string;
		onProgress: (pct: number) => Promise<void>;
	}): Promise<{
		words: TranscriptionWord[];
		segments: TranscriptionSegment[];
		language: string;
		stub: boolean;
	}>;
}

export class StubTranscriptionEngine implements TranscriptionEngine {
	readonly id = "clipforge-stub-transcriber";

	async transcribe({
		input,
		onProgress,
	}: {
		input: TranscriptionGraphInput;
		mediaDownloadUrl: string;
		onProgress: (pct: number) => Promise<void>;
	}): Promise<{
		words: TranscriptionWord[];
		segments: TranscriptionSegment[];
		language: string;
		stub: boolean;
	}> {
		await onProgress(20);
		const durationMs = Math.max(1, Math.round((input.durationSeconds ?? 5) * 1000));
		const placeholder = `Transcript stub for ${input.mediaId}`;
		const segments: TranscriptionSegment[] = [
			{ text: placeholder, start_ms: 0, end_ms: durationMs },
		];
		const words = synthesizeWordsFromSegments({ segments });
		await onProgress(80);
		return {
			words,
			segments,
			language: input.languageHint ?? "en",
			stub: true,
		};
	}
}

function synthesizeWordsFromSegments({
	segments,
}: {
	segments: TranscriptionSegment[];
}): TranscriptionWord[] {
	const words: TranscriptionWord[] = [];
	for (const segment of segments) {
		const tokens = segment.text.split(/\s+/).filter(Boolean);
		if (tokens.length === 0) continue;
		const totalMs = Math.max(1, segment.end_ms - segment.start_ms);
		const perWord = totalMs / tokens.length;
		for (let i = 0; i < tokens.length; i += 1) {
			words.push({
				text: tokens[i]!,
				start_ms: Math.round(segment.start_ms + i * perWord),
				end_ms: Math.round(segment.start_ms + (i + 1) * perWord),
			});
		}
	}
	return words;
}

export interface RunTranscriptionJobResult {
	status: "completed" | "failed" | "skipped-invalid-input";
	jobId: string | null;
	result?: TranscriptionGraphResult;
	errorMessage?: string;
}

export async function runTranscriptionJob({
	job,
	engine,
	http,
}: {
	job: ClipForgeJobRecord;
	engine: TranscriptionEngine;
	http: WorkerHttpClient;
}): Promise<RunTranscriptionJobResult> {
	if (!isTranscriptionGraphInput(job.input)) {
		const errorMessage =
			"Job input is not a valid transcription graph (contractVersion 1 expected).";
		await http.patchJob({
			jobId: job.id,
			status: "failed",
			errorMessage,
		});
		return { status: "skipped-invalid-input", jobId: job.id, errorMessage };
	}

	const input = job.input as unknown as TranscriptionGraphInput;

	try {
		await http.patchJob({
			jobId: job.id,
			status: "processing",
			progressPct: 5,
		});

		if (!http.presignMediaDownload) {
			throw new Error(
				"WorkerHttpClient does not implement presignMediaDownload (cannot fetch media for transcription).",
			);
		}
		const presigned = await http.presignMediaDownload({
			storageKey: input.mediaStorageKey,
		});

		const transcribed = await engine.transcribe({
			input,
			mediaDownloadUrl: presigned.url,
			onProgress: async (pct) => {
				await http.patchJob({
					jobId: job.id,
					status: "processing",
					progressPct: Math.max(5, Math.min(95, pct)),
				});
			},
		});

		const result: TranscriptionGraphResult = {
			contractVersion: 1,
			mediaId: input.mediaId,
			language: transcribed.language,
			words: transcribed.words,
			segments: transcribed.segments,
			providerId: engine.id,
			stub: transcribed.stub,
			transcribedAt: new Date().toISOString(),
		};

		await http.patchJob({
			jobId: job.id,
			status: "completed",
			progressPct: 100,
			result: result as unknown as Record<string, unknown>,
		});

		return { status: "completed", jobId: job.id, result };
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Transcription failed unexpectedly.";
		await http.patchJob({ jobId: job.id, status: "failed", errorMessage });
		return { status: "failed", jobId: job.id, errorMessage };
	}
}

export interface TranscriptionWorkerLoopOptions {
	http: WorkerHttpClient;
	engine: TranscriptionEngine;
	pollIntervalMs?: number;
	maxJobs?: number;
	signal?: AbortSignal;
	logger?: (message: string, meta?: Record<string, unknown>) => void;
}

export async function runTranscriptionWorkerLoop({
	http,
	engine,
	pollIntervalMs = 2_000,
	maxJobs = Infinity,
	signal,
	logger = (message) => console.log(`[transcription-worker] ${message}`),
}: TranscriptionWorkerLoopOptions): Promise<{ processed: number }> {
	let processed = 0;
	while (processed < maxJobs) {
		if (signal?.aborted) break;
		const claim = await http.claimNext({ kind: "transcription" });
		if (!claim.job) {
			if (signal?.aborted) break;
			await sleep(pollIntervalMs, signal);
			continue;
		}
		logger("claimed job", { jobId: claim.job.id });
		const result = await runTranscriptionJob({ job: claim.job, engine, http });
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
