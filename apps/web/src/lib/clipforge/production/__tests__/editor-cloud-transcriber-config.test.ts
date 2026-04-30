import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildEditorManagedCloudConfig } from "@/lib/clipforge/production/editor-cloud-transcriber-config";
import type {
	CloudMediaObjectRecord,
	CloudProjectListItem,
} from "@/types/production";
import type { TProject } from "@/types/project";
import type { MediaAsset } from "@/types/assets";

function makeProject(name: string): TProject {
	return {
		metadata: {
			id: "proj_local",
			name,
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

function makeAsset(id: string): MediaAsset {
	return {
		id,
		name: `${id}.wav`,
		type: "audio",
		duration: 4,
		file: new File([new Uint8Array([1])], `${id}.wav`, { type: "audio/wav" }),
	} as MediaAsset;
}

function makeCloudProject(name: string, id: string): CloudProjectListItem {
	return {
		id,
		name,
		mode: "cloud",
		projectVersion: 1,
		storageStatus: "synced",
		quotaBytesUsed: 0,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

function makeMediaRecord(
	overrides: Partial<CloudMediaObjectRecord>,
): CloudMediaObjectRecord {
	return {
		id: "media_x",
		projectId: "cp_1",
		ownerId: "owner_1",
		mediaId: "asset_x",
		storageKey: "key_x",
		bytes: 100,
		sha256: null,
		status: "stored",
		encrypted: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

let originalFetch: typeof fetch;
const fetchCalls: string[] = [];

beforeEach(() => {
	fetchCalls.length = 0;
	originalFetch = globalThis.fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function installFetch(handler: (url: string) => Response | Promise<Response>) {
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = typeof input === "string" ? input : input.toString();
		fetchCalls.push(url);
		return await handler(url);
	}) as typeof fetch;
}

describe("buildEditorManagedCloudConfig.resolveCloudProjectId", () => {
	test("returns null when no active project", async () => {
		installFetch(() => new Response(JSON.stringify({ projects: [] }), { status: 200 }));
		const config = buildEditorManagedCloudConfig({
			getActiveProject: () => null,
		});
		const id = await config.resolveCloudProjectId(makeAsset("a"));
		expect(id).toBeNull();
		expect(fetchCalls).toEqual([]);
	});

	test("matches by active project name and caches the project list", async () => {
		installFetch(() =>
			new Response(
				JSON.stringify({
					projects: [makeCloudProject("My Project", "cp_42")],
				}),
				{ status: 200 },
			),
		);
		const config = buildEditorManagedCloudConfig({
			getActiveProject: () => makeProject("My Project"),
		});
		const id1 = await config.resolveCloudProjectId(makeAsset("a"));
		const id2 = await config.resolveCloudProjectId(makeAsset("b"));
		expect(id1).toBe("cp_42");
		expect(id2).toBe("cp_42");
		// Cached: only one /cloud/projects fetch
		expect(fetchCalls.filter((u) => u === "/api/clipforge/cloud/projects")).toHaveLength(1);
	});

	test("returns null when no cloud project name matches active project", async () => {
		installFetch(() =>
			new Response(
				JSON.stringify({ projects: [makeCloudProject("Other", "cp_other")] }),
				{ status: 200 },
			),
		);
		const config = buildEditorManagedCloudConfig({
			getActiveProject: () => makeProject("Local Only"),
		});
		expect(await config.resolveCloudProjectId(makeAsset("a"))).toBeNull();
	});

	test("returns null when /cloud/projects fetch errors", async () => {
		installFetch(() => new Response("nope", { status: 500 }));
		const config = buildEditorManagedCloudConfig({
			getActiveProject: () => makeProject("Anything"),
		});
		expect(await config.resolveCloudProjectId(makeAsset("a"))).toBeNull();
	});
});

describe("buildEditorManagedCloudConfig.resolveExistingMedia", () => {
	test("returns the storage key for a stored cloud media match", async () => {
		installFetch((url) => {
			if (url.endsWith("/media")) {
				return new Response(
					JSON.stringify({
						mediaObjects: [
							makeMediaRecord({
								mediaId: "asset_x",
								storageKey: "key_xx",
								status: "stored",
							}),
						],
					}),
					{ status: 200 },
				);
			}
			return new Response("not handled", { status: 500 });
		});
		const config = buildEditorManagedCloudConfig({
			getActiveProject: () => makeProject("Any"),
		});
		const found = await config.resolveExistingMedia!({
			cloudProjectId: "cp_1",
			mediaAsset: makeAsset("asset_x"),
		});
		expect(found).toEqual({ mediaId: "asset_x", storageKey: "key_xx" });
	});

	test("returns null when cloud media is not in stored status", async () => {
		installFetch(() =>
			new Response(
				JSON.stringify({
					mediaObjects: [
						makeMediaRecord({
							mediaId: "asset_x",
							storageKey: "key_xx",
							status: "uploading",
						}),
					],
				}),
				{ status: 200 },
			),
		);
		const config = buildEditorManagedCloudConfig({
			getActiveProject: () => makeProject("Any"),
		});
		const found = await config.resolveExistingMedia!({
			cloudProjectId: "cp_1",
			mediaAsset: makeAsset("asset_x"),
		});
		expect(found).toBeNull();
	});

	test("caches per-project media list across calls", async () => {
		installFetch(() =>
			new Response(
				JSON.stringify({
					mediaObjects: [
						makeMediaRecord({
							mediaId: "asset_x",
							storageKey: "key_x",
							status: "stored",
						}),
						makeMediaRecord({
							id: "media_y",
							mediaId: "asset_y",
							storageKey: "key_y",
							status: "stored",
						}),
					],
				}),
				{ status: 200 },
			),
		);
		const config = buildEditorManagedCloudConfig({
			getActiveProject: () => makeProject("Any"),
		});
		await config.resolveExistingMedia!({
			cloudProjectId: "cp_1",
			mediaAsset: makeAsset("asset_x"),
		});
		await config.resolveExistingMedia!({
			cloudProjectId: "cp_1",
			mediaAsset: makeAsset("asset_y"),
		});
		expect(fetchCalls.filter((u) => u.endsWith("/media"))).toHaveLength(1);
	});
});
