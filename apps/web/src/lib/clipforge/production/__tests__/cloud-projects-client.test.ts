import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	CloudApiError,
	uploadMediaAssetToCloud,
	type UploadProgressEvent,
} from "@/lib/clipforge/production/cloud-projects-client";
import type { CloudMediaObjectRecord } from "@/types/production";

interface MockCall {
	url: string;
	method: string;
	body: BodyInit | null | undefined;
	headers: Record<string, string>;
}

function record(overrides: Partial<CloudMediaObjectRecord>): CloudMediaObjectRecord {
	return {
		id: "media_1",
		projectId: "proj_1",
		ownerId: "owner_1",
		mediaId: "asset_1",
		storageKey: "clipforge/owner_1/proj_1/asset_1",
		bytes: 0,
		sha256: null,
		status: "uploading",
		encrypted: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

const calls: MockCall[] = [];
let originalFetch: typeof fetch;

beforeEach(() => {
	calls.length = 0;
	originalFetch = globalThis.fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function installApiFetch(handler: (call: MockCall) => Response | Promise<Response>) {
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		const call: MockCall = {
			url,
			method: init?.method ?? "GET",
			body: (init?.body as BodyInit | null | undefined) ?? null,
			headers:
				typeof init?.headers === "object" && init.headers
					? Object.fromEntries(
							Object.entries(init.headers as Record<string, string>),
						)
					: {},
		};
		calls.push(call);
		return await handler(call);
	}) as typeof fetch;
}

describe("uploadMediaAssetToCloud", () => {
	test("happy path: creates record, PUTs to presigned URL, confirms stored", async () => {
		const file = new File([new Uint8Array([1, 2, 3, 4])], "clip.mp4", {
			type: "video/mp4",
		});

		installApiFetch((call) => {
			if (call.method === "POST" && call.url.endsWith("/media")) {
				return new Response(
					JSON.stringify({
						mediaObject: record({ status: "uploading" }),
						upload: {
							url: "https://r2.example/clipforge/x?signed=1",
							method: "PUT",
							headers: { "content-type": "video/mp4" },
							expiresAt: new Date(Date.now() + 60_000).toISOString(),
						},
					}),
					{ status: 201 },
				);
			}
			if (call.method === "PATCH" && /media\/media_1$/.test(call.url)) {
				const body = JSON.parse(call.body as string) as { status: string };
				return new Response(
					JSON.stringify({
						mediaObject: record({ status: body.status as "stored", bytes: 4 }),
					}),
					{ status: 200 },
				);
			}
			return new Response("not handled", { status: 500 });
		});

		const uploadCalls: MockCall[] = [];
		const upload = async (url: string, init?: RequestInit) => {
			uploadCalls.push({
				url,
				method: init?.method ?? "GET",
				body: (init?.body as BodyInit | null) ?? null,
				headers: (init?.headers as Record<string, string>) ?? {},
			});
			return new Response(null, { status: 200 });
		};

		const events: UploadProgressEvent["phase"][] = [];
		const final = await uploadMediaAssetToCloud({
			projectId: "proj_1",
			mediaId: "asset_1",
			file,
			uploadFetchImpl: upload,
			onProgress: (event) => events.push(event.phase),
		});

		expect(final.status).toBe("stored");
		expect(final.bytes).toBe(4);
		expect(events).toEqual(["creating", "uploading", "confirming", "done"]);
		expect(uploadCalls).toHaveLength(1);
		expect(uploadCalls[0]!.method).toBe("PUT");
		expect(uploadCalls[0]!.url).toBe("https://r2.example/clipforge/x?signed=1");
	});

	test("fails fast with 501 when storage is not configured", async () => {
		const file = new File([new Uint8Array([1])], "clip.mp4");

		installApiFetch((call) => {
			if (call.method === "POST" && call.url.endsWith("/media")) {
				return new Response(
					JSON.stringify({
						mediaObject: record({ status: "queued" }),
						upload: null,
					}),
					{ status: 201 },
				);
			}
			if (call.method === "PATCH") {
				return new Response(
					JSON.stringify({ mediaObject: record({ status: "failed" }) }),
					{ status: 200 },
				);
			}
			return new Response("not handled", { status: 500 });
		});

		const events: UploadProgressEvent[] = [];
		await expect(
			uploadMediaAssetToCloud({
				projectId: "proj_1",
				mediaId: "asset_1",
				file,
				onProgress: (event) => events.push(event),
			}),
		).rejects.toBeInstanceOf(CloudApiError);

		expect(events.at(-1)?.phase).toBe("error");
		expect(events.at(-1)?.mediaObject?.status).toBe("failed");
	});

	test("marks media object failed when presigned PUT fails", async () => {
		const file = new File([new Uint8Array([1])], "clip.mp4");

		installApiFetch((call) => {
			if (call.method === "POST" && call.url.endsWith("/media")) {
				return new Response(
					JSON.stringify({
						mediaObject: record({ status: "uploading" }),
						upload: {
							url: "https://r2.example/clip",
							method: "PUT",
							headers: {},
							expiresAt: new Date(Date.now() + 60_000).toISOString(),
						},
					}),
					{ status: 201 },
				);
			}
			if (call.method === "PATCH") {
				return new Response(
					JSON.stringify({ mediaObject: record({ status: "failed" }) }),
					{ status: 200 },
				);
			}
			return new Response("not handled", { status: 500 });
		});

		const events: UploadProgressEvent[] = [];
		await expect(
			uploadMediaAssetToCloud({
				projectId: "proj_1",
				mediaId: "asset_1",
				file,
				uploadFetchImpl: async () => new Response(null, { status: 500 }),
				onProgress: (event) => events.push(event),
			}),
		).rejects.toBeInstanceOf(CloudApiError);

		expect(events.at(-1)?.phase).toBe("error");
		expect(events.at(-1)?.mediaObject?.status).toBe("failed");
	});
});
