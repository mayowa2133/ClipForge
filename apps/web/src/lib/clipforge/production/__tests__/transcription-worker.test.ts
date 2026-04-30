import { describe, expect, test } from "bun:test";
import {
	runTranscriptionJob,
	StubTranscriptionEngine,
	type TranscriptionEngine,
} from "@/lib/clipforge/production/worker/transcription-worker";
import { ModalTranscriptionEngine } from "@/lib/clipforge/production/worker/transcription-modal";
import { buildTranscriptionGraphInput } from "@/lib/clipforge/production/transcription-graph";
import type { WorkerHttpClient } from "@/lib/clipforge/production/worker/export-worker";
import type { ClipForgeJobRecord } from "@/types/production";

interface MockState {
	patches: Array<{
		jobId: string;
		status: string;
		progressPct?: number;
		errorMessage?: string | null;
		result?: Record<string, unknown> | null;
	}>;
	presignCalls: Array<{ storageKey: string }>;
}

function makeJob({
	overrides,
	withGraph = true,
}: {
	overrides?: Partial<ClipForgeJobRecord>;
	withGraph?: boolean;
}): ClipForgeJobRecord {
	const input = withGraph
		? (buildTranscriptionGraphInput({
				projectId: "proj_test",
				mediaId: "media_voice",
				mediaStorageKey: "clipforge/owner_1/proj_test/media_voice",
				mediaContentType: "audio/wav",
				durationSeconds: 4,
				languageHint: "en",
			}) as unknown as Record<string, unknown>)
		: { random: "junk" };

	return {
		id: "job_t1",
		ownerId: "owner_1",
		projectId: "proj_test",
		kind: "transcription",
		status: "queued",
		provider: null,
		input,
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

function makeHttpClient({
	state,
	withPresign = true,
}: {
	state: MockState;
	withPresign?: boolean;
}): WorkerHttpClient {
	return {
		async claimNext() {
			throw new Error("claimNext should not be called in runTranscriptionJob tests");
		},
		async requestArtifactUpload() {
			throw new Error("Transcription jobs do not upload artifacts");
		},
		async uploadArtifact() {
			throw new Error("Transcription jobs do not upload artifacts");
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
				job: makeJob({
					overrides: { id: args.jobId, status: args.status as ClipForgeJobRecord["status"] },
				}),
			};
		},
		...(withPresign
			? {
					async presignMediaDownload({ storageKey }: { storageKey: string }) {
						state.presignCalls.push({ storageKey });
						return {
							url: `https://r2.example/${encodeURIComponent(storageKey)}?signed=1`,
							expiresAt: new Date(Date.now() + 60_000).toISOString(),
						};
					},
				}
			: {}),
	};
}

describe("StubTranscriptionEngine", () => {
	test("emits a synthetic single segment with one or more words", async () => {
		const engine = new StubTranscriptionEngine();
		const result = await engine.transcribe({
			input: buildTranscriptionGraphInput({
				projectId: "proj_test",
				mediaId: "media_x",
				mediaStorageKey: "key_x",
				durationSeconds: 4,
				languageHint: "fr",
			}),
			mediaDownloadUrl: "https://r2.example/key_x?signed=1",
			onProgress: async () => undefined,
		});
		expect(result.stub).toBe(true);
		expect(result.language).toBe("fr");
		expect(result.segments).toHaveLength(1);
		expect(result.segments[0]!.start_ms).toBe(0);
		expect(result.segments[0]!.end_ms).toBe(4000);
		expect(result.words.length).toBeGreaterThan(0);
		const last = result.words[result.words.length - 1]!;
		expect(last.end_ms).toBeLessThanOrEqual(4000);
	});

	test("defaults language to en when no hint is provided", async () => {
		const engine = new StubTranscriptionEngine();
		const result = await engine.transcribe({
			input: buildTranscriptionGraphInput({
				projectId: null,
				mediaId: "m",
				mediaStorageKey: "k",
			}),
			mediaDownloadUrl: "https://r2.example/k?signed=1",
			onProgress: async () => undefined,
		});
		expect(result.language).toBe("en");
	});
});

describe("runTranscriptionJob", () => {
	test("happy path: presigns media, runs engine, completes job with result", async () => {
		const state: MockState = { patches: [], presignCalls: [] };
		const result = await runTranscriptionJob({
			job: makeJob({}),
			engine: new StubTranscriptionEngine(),
			http: makeHttpClient({ state }),
		});

		expect(result.status).toBe("completed");
		expect(result.result?.contractVersion).toBe(1);
		expect(result.result?.providerId).toBe("clipforge-stub-transcriber");
		expect(state.presignCalls).toEqual([
			{ storageKey: "clipforge/owner_1/proj_test/media_voice" },
		]);
		const statuses = state.patches.map((p) => p.status);
		expect(statuses[0]).toBe("processing");
		expect(statuses[statuses.length - 1]).toBe("completed");
		const completePatch = state.patches.find((p) => p.status === "completed");
		expect(completePatch?.progressPct).toBe(100);
	});

	test("invalid input fails fast without presigning or transcribing", async () => {
		const state: MockState = { patches: [], presignCalls: [] };
		const result = await runTranscriptionJob({
			job: makeJob({ withGraph: false }),
			engine: new StubTranscriptionEngine(),
			http: makeHttpClient({ state }),
		});
		expect(result.status).toBe("skipped-invalid-input");
		expect(state.presignCalls).toEqual([]);
		expect(state.patches.map((p) => p.status)).toEqual(["failed"]);
		expect(state.patches[0]!.errorMessage).toContain("contractVersion 1 expected");
	});

	test("missing presignMediaDownload causes a clear failure", async () => {
		const state: MockState = { patches: [], presignCalls: [] };
		const result = await runTranscriptionJob({
			job: makeJob({}),
			engine: new StubTranscriptionEngine(),
			http: makeHttpClient({ state, withPresign: false }),
		});
		expect(result.status).toBe("failed");
		expect(result.errorMessage).toContain("presignMediaDownload");
	});

	test("engine errors are recorded as failed status with the original message", async () => {
		const state: MockState = { patches: [], presignCalls: [] };
		const failingEngine: TranscriptionEngine = {
			id: "failing",
			async transcribe() {
				throw new Error("provider unavailable");
			},
		};
		const result = await runTranscriptionJob({
			job: makeJob({}),
			engine: failingEngine,
			http: makeHttpClient({ state }),
		});
		expect(result.status).toBe("failed");
		expect(result.errorMessage).toBe("provider unavailable");
		expect(state.patches.at(-1)?.status).toBe("failed");
	});
});

describe("ModalTranscriptionEngine", () => {
	test("posts mediaUrl + parses words/segments from response (start/end seconds)", async () => {
		let captured: { url: string; bodyParsed: unknown } | null = null;
		const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
			captured = {
				url: typeof url === "string" ? url : url.toString(),
				bodyParsed: init?.body ? JSON.parse(init.body as string) : null,
			};
			return new Response(
				JSON.stringify({
					language: "en",
					words: [
						{ text: "Hello", start: 0.1, end: 0.5 },
						{ text: "world", start: 0.5, end: 1.0 },
					],
					segments: [{ text: "Hello world", start: 0.0, end: 1.0 }],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as typeof fetch;

		const engine = new ModalTranscriptionEngine({
			endpoint: "https://modal.example/transcribe",
			apiKey: "secret",
			fetchImpl: fakeFetch,
		});
		const result = await engine.transcribe({
			input: buildTranscriptionGraphInput({
				projectId: "proj_test",
				mediaId: "m_voice",
				mediaStorageKey: "key_voice",
				mediaContentType: "audio/wav",
				durationSeconds: 1,
				languageHint: "en",
				diarization: false,
			}),
			mediaDownloadUrl: "https://r2.example/key_voice?signed=1",
			onProgress: async () => undefined,
		});

		expect(captured).not.toBeNull();
		expect(captured!.url).toBe("https://modal.example/transcribe");
		expect((captured!.bodyParsed as { mediaUrl: string }).mediaUrl).toBe(
			"https://r2.example/key_voice?signed=1",
		);
		expect(result.stub).toBe(false);
		expect(result.language).toBe("en");
		expect(result.words).toHaveLength(2);
		expect(result.words[0]!.start_ms).toBe(100);
		expect(result.words[1]!.end_ms).toBe(1000);
		expect(result.segments).toHaveLength(1);
		expect(result.segments[0]!.end_ms).toBe(1000);
	});

	test("non-OK response throws with status + truncated body", async () => {
		const fakeFetch = (async (_url: string | URL, _init?: RequestInit) =>
			new Response("internal boom", { status: 503 })) as typeof fetch;
		const engine = new ModalTranscriptionEngine({
			endpoint: "https://modal.example/transcribe",
			fetchImpl: fakeFetch,
		});
		await expect(
			engine.transcribe({
				input: buildTranscriptionGraphInput({
					projectId: null,
					mediaId: "m",
					mediaStorageKey: "k",
				}),
				mediaDownloadUrl: "https://r2.example/k?signed=1",
				onProgress: async () => undefined,
			}),
		).rejects.toThrow(/503/);
	});

	test("falls back to language hint when response omits language", async () => {
		const fakeFetch = (async (_url: string | URL, _init?: RequestInit) =>
			new Response(JSON.stringify({ words: [], segments: [] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as typeof fetch;
		const engine = new ModalTranscriptionEngine({
			endpoint: "https://modal.example/transcribe",
			fetchImpl: fakeFetch,
		});
		const result = await engine.transcribe({
			input: buildTranscriptionGraphInput({
				projectId: null,
				mediaId: "m",
				mediaStorageKey: "k",
				languageHint: "es",
			}),
			mediaDownloadUrl: "https://r2.example/k?signed=1",
			onProgress: async () => undefined,
		});
		expect(result.language).toBe("es");
	});
});
