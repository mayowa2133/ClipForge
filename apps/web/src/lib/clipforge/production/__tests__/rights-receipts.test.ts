import { describe, expect, test } from "bun:test";
import {
	buildExportRightsReceiptDrafts,
	recordExportRightsReceipts,
} from "@/lib/clipforge/production/rights-receipts";
import type { MediaAsset } from "@/types/assets";

function makeAsset(overrides: Partial<MediaAsset>): MediaAsset {
	return {
		id: "asset-1",
		name: "track.mp3",
		type: "audio",
		duration: 60,
		file: new File([new Uint8Array()], "track.mp3"),
		...overrides,
	} as MediaAsset;
}

describe("buildExportRightsReceiptDrafts", () => {
	test("emits a bundled receipt for universal starter library music", () => {
		const drafts = buildExportRightsReceiptDrafts({
			mediaAssets: [
				makeAsset({
					id: "bundled-track",
					musicSourceType: "bundled",
					rightsProfile: "universal",
					sourceLabel: "ClipForge Starter",
					attributionText: null,
				}),
			],
			destination: "tiktok",
			exportContext: { format: "mp4" },
		});

		expect(drafts).toHaveLength(1);
		expect(drafts[0]!.assetId).toBe("bundled-track");
		expect(drafts[0]!.sourceKind).toBe("bundled");
		expect(drafts[0]!.licenseLabel).toBe("ClipForge Starter");
	});

	test("emits a licensed receipt for royalty-free external music", () => {
		const drafts = buildExportRightsReceiptDrafts({
			mediaAssets: [
				makeAsset({
					id: "rf-track",
					musicSourceType: "royalty-free-external",
					attributionText: "CC-BY 4.0",
				}),
			],
			destination: "youtube",
			exportContext: {},
		});

		expect(drafts).toHaveLength(1);
		expect(drafts[0]!.sourceKind).toBe("licensed");
		expect(drafts[0]!.licenseLabel).toBe("CC-BY 4.0");
	});

	test("ignores user-imported and trend-reference assets", () => {
		const drafts = buildExportRightsReceiptDrafts({
			mediaAssets: [
				makeAsset({ id: "user-imp", musicSourceType: "user-imported" }),
				makeAsset({ id: "trend-ref", musicSourceType: "trend-reference" }),
				makeAsset({ id: "no-music" }),
			],
			destination: "generic-export",
			exportContext: {},
		});

		expect(drafts).toHaveLength(0);
	});
});

describe("recordExportRightsReceipts", () => {
	test("returns zero attempts when there are no eligible assets", async () => {
		const result = await recordExportRightsReceipts({
			projectId: null,
			mediaAssets: [],
			destination: "generic-export",
			exportContext: {},
			fetchImpl: async () => new Response(null, { status: 200 }),
		});
		expect(result.attempted).toBe(0);
		expect(result.created).toBe(0);
		expect(result.skippedUnauthenticated).toBe(false);
	});

	test("short-circuits on 401 without recording errors", async () => {
		const calls: number[] = [];
		const result = await recordExportRightsReceipts({
			projectId: null,
			mediaAssets: [
				makeAsset({
					id: "a",
					musicSourceType: "bundled",
					rightsProfile: "universal",
				}),
				makeAsset({
					id: "b",
					musicSourceType: "bundled",
					rightsProfile: "universal",
				}),
			],
			destination: "tiktok",
			exportContext: {},
			fetchImpl: async () => {
				calls.push(1);
				return new Response(JSON.stringify({ error: "unauth" }), { status: 401 });
			},
		});

		expect(result.skippedUnauthenticated).toBe(true);
		expect(result.created).toBe(0);
		expect(result.errors).toEqual([]);
		expect(calls.length).toBe(1);
	});

	test("counts created receipts on 201", async () => {
		const result = await recordExportRightsReceipts({
			projectId: "proj",
			mediaAssets: [
				makeAsset({
					id: "a",
					musicSourceType: "bundled",
					rightsProfile: "universal",
				}),
				makeAsset({
					id: "b",
					musicSourceType: "royalty-free-external",
					attributionText: "Royalty Free",
				}),
			],
			destination: "instagram",
			exportContext: { format: "mp4" },
			fetchImpl: async () =>
				new Response(JSON.stringify({ receipt: { id: "r" } }), {
					status: 201,
				}),
		});

		expect(result.attempted).toBe(2);
		expect(result.created).toBe(2);
		expect(result.skippedUnauthenticated).toBe(false);
		expect(result.errors).toEqual([]);
	});
});
