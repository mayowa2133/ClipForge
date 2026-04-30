import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ManagedCloudTranscriber } from "@/lib/clipforge/transcribers/managed-cloud";
import type { CloudMediaObjectRecord } from "@/types/production";
import type { MediaAsset } from "@/types/assets";

function makeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
	return {
		id: "asset_voice",
		name: "voice.wav",
		type: "audio",
		duration: 6,
		file: new File([new Uint8Array([1, 2, 3, 4])], "voice.wav", {
			type: "audio/wav",
		}),
		...overrides,
	} as MediaAsset;
}

interface FetchCall {
	url: string;
	method: string;
	bodyText: string | null;
}

let originalFetch: typeof fetch;
const fetchCalls: FetchCall[] = [];

beforeEach(() => {
	fetchCalls.length = 0;
	originalFetch = globalThis.fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

interface InstallArgs {
	jobStatusSequence: Array<"queued" | "processing" | "completed" | "failed" | "cancelled">;
	jobResult?: Record<string, unknown> | null;
	jobErrorMessage?: string | null;
	uploadFails?: boolean;
}

function installFetchHandler({
	jobStatusSequence,
	jobResult,
	jobErrorMessage,
	uploadFails = false,
}: InstallArgs) {
	let pollIndex = 0;
	const fakeMediaRecord: CloudMediaObjectRecord = {
		id: "media_1",
		projectId: "cp_1",
		ownerId: "owner_1",
		mediaId: "asset_voice",
		storageKey: "clipforge/owner_1/cp_1/asset_voice",
		bytes: 4,
		sha256: null,
		status: "uploading",
		encrypted: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		const method = init?.method ?? "GET";
		fetchCalls.push({
			url,
			method,
			bodyText:
				typeof init?.body === "string" ? init.body : init?.body ? "[body]" : null,
		});

		if (method === "POST" && url.endsWith("/media")) {
			return new Response(
				JSON.stringify({
					mediaObject: fakeMediaRecord,
					upload: {
						url: "https://r2.example/upload?signed=1",
						method: "PUT",
						headers: {},
						expiresAt: new Date(Date.now() + 60_000).toISOString(),
					},
				}),
				{ status: 201, headers: { "content-type": "application/json" } },
			);
		}
		if (method === "PUT" && url.startsWith("https://r2.example/upload")) {
			return new Response(null, { status: uploadFails ? 500 : 200 });
		}
		if (method === "PATCH" && /media\/media_1$/.test(url)) {
			const status = uploadFails ? "failed" : "stored";
			return new Response(
				JSON.stringify({ mediaObject: { ...fakeMediaRecord, status } }),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (method === "POST" && url === "/api/clipforge/jobs") {
			return new Response(
				JSON.stringify({
					job: {
						id: "job_t1",
						ownerId: "owner_1",
						projectId: "cp_1",
						kind: "transcription",
						status: "queued",
						provider: "modal",
						input: {},
						result: null,
						errorMessage: null,
						progressPct: 0,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						startedAt: null,
						completedAt: null,
					},
				}),
				{ status: 201, headers: { "content-type": "application/json" } },
			);
		}
		if (method === "GET" && /\/api\/clipforge\/jobs\/job_t1/.test(url)) {
			const status =
				jobStatusSequence[pollIndex] ??
				jobStatusSequence[jobStatusSequence.length - 1];
			pollIndex += 1;
			return new Response(
				JSON.stringify({
					job: {
						id: "job_t1",
						ownerId: "owner_1",
						projectId: "cp_1",
						kind: "transcription",
						status,
						provider: "modal",
						input: {},
						result: jobResult ?? null,
						errorMessage: jobErrorMessage ?? null,
						progressPct: status === "completed" ? 100 : 30,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						startedAt: new Date().toISOString(),
						completedAt: status === "completed" ? new Date().toISOString() : null,
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}

		return new Response(
			JSON.stringify({ error: `Unhandled fetch ${method} ${url}` }),
			{ status: 501 },
		);
	}) as typeof fetch;
}

describe("ManagedCloudTranscriber", () => {
	test("happy path: uploads media, submits job, polls until completed, returns words+segments", async () => {
		installFetchHandler({
			jobStatusSequence: ["completed"],
			jobResult: {
				contractVersion: 1,
				mediaId: "asset_voice",
				language: "en",
				words: [
					{ text: "Hello", start_ms: 0, end_ms: 500 },
					{ text: "world", start_ms: 500, end_ms: 1000 },
				],
				segments: [{ text: "Hello world", start_ms: 0, end_ms: 1000 }],
				providerId: "clipforge-modal-transcriber",
				stub: false,
				transcribedAt: new Date().toISOString(),
			},
		});

		const transcriber = new ManagedCloudTranscriber({
			resolveCloudProjectId: async () => "cp_1",
			pollIntervalMs: 1,
			pollTimeoutMs: 1_000,
		});

		const result = await transcriber.transcribe({
			mediaAsset: makeAsset(),
			language: "en",
		});

		expect(result.provider).toBe("managed-cloud");
		expect(result.language).toBe("en");
		expect(result.words.map((w) => w.text)).toEqual(["Hello", "world"]);
		expect(result.segments).toHaveLength(1);
		const submittedJobBody = fetchCalls.find(
			(c) => c.method === "POST" && c.url === "/api/clipforge/jobs",
		);
		expect(submittedJobBody).toBeDefined();
		expect(submittedJobBody!.bodyText).toContain('"kind":"transcription"');
		expect(submittedJobBody!.bodyText).toContain('"projectId":"cp_1"');
	});

	test("throws when no cloud project resolves for the asset", async () => {
		installFetchHandler({ jobStatusSequence: ["completed"] });
		const transcriber = new ManagedCloudTranscriber({
			resolveCloudProjectId: async () => null,
			pollIntervalMs: 1,
			pollTimeoutMs: 1_000,
		});
		await expect(
			transcriber.transcribe({ mediaAsset: makeAsset() }),
		).rejects.toThrow(/no cloud project/i);
		expect(fetchCalls.some((c) => c.method === "POST")).toBe(false);
	});

	test("skips upload when resolveExistingMedia returns a record", async () => {
		installFetchHandler({
			jobStatusSequence: ["completed"],
			jobResult: {
				contractVersion: 1,
				mediaId: "asset_voice",
				language: "en",
				words: [],
				segments: [],
				providerId: "clipforge-modal-transcriber",
				stub: false,
				transcribedAt: new Date().toISOString(),
			},
		});
		const transcriber = new ManagedCloudTranscriber({
			resolveCloudProjectId: async () => "cp_1",
			resolveExistingMedia: async () => ({
				mediaId: "asset_voice",
				storageKey: "clipforge/owner_1/cp_1/asset_voice",
			}),
			pollIntervalMs: 1,
			pollTimeoutMs: 1_000,
		});
		await transcriber.transcribe({ mediaAsset: makeAsset() });
		const uploadCall = fetchCalls.find(
			(c) => c.method === "PUT" && c.url.startsWith("https://r2.example/upload"),
		);
		expect(uploadCall).toBeUndefined();
	});

	test("propagates server-side failure as a thrown error with the original message", async () => {
		installFetchHandler({
			jobStatusSequence: ["processing", "failed"],
			jobErrorMessage: "modal endpoint unreachable",
		});
		const transcriber = new ManagedCloudTranscriber({
			resolveCloudProjectId: async () => "cp_1",
			pollIntervalMs: 1,
			pollTimeoutMs: 1_000,
		});
		await expect(
			transcriber.transcribe({ mediaAsset: makeAsset() }),
		).rejects.toThrow(/modal endpoint unreachable/);
	});

	test("flags stub results in warnings but still returns parsed words+segments", async () => {
		installFetchHandler({
			jobStatusSequence: ["completed"],
			jobResult: {
				contractVersion: 1,
				mediaId: "asset_voice",
				language: "fr",
				words: [{ text: "Bonjour", start_ms: 0, end_ms: 600 }],
				segments: [{ text: "Bonjour", start_ms: 0, end_ms: 600 }],
				providerId: "clipforge-stub-transcriber",
				stub: true,
				transcribedAt: new Date().toISOString(),
			},
		});
		const transcriber = new ManagedCloudTranscriber({
			resolveCloudProjectId: async () => "cp_1",
			pollIntervalMs: 1,
			pollTimeoutMs: 1_000,
		});
		const result = await transcriber.transcribe({ mediaAsset: makeAsset() });
		expect(result.warnings?.some((w) => w.includes("stub"))).toBe(true);
		expect(result.language).toBe("fr");
		expect(result.words[0]!.text).toBe("Bonjour");
	});
});
