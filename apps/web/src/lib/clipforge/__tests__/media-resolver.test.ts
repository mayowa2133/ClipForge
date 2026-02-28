import { describe, expect, test } from "bun:test";
import { resolveMediaAssetByName } from "@/lib/clipforge";

const mediaAssets = [
	{ id: "a", name: "beach.mp4" },
	{ id: "b", name: "city cutaway.mov" },
];

describe("resolveMediaAssetByName", () => {
	test("matches exact filename", () => {
		expect(
			resolveMediaAssetByName({
				query: "beach.mp4",
				mediaAssets,
			}),
		).toEqual({
			assetId: "a",
			matchedName: "beach.mp4",
		});
	});

	test("matches filename without extension", () => {
		expect(
			resolveMediaAssetByName({
				query: "beach",
				mediaAssets,
			}),
		).toEqual({
			assetId: "a",
			matchedName: "beach.mp4",
		});
	});

	test("returns null for ambiguous names", () => {
		expect(
			resolveMediaAssetByName({
				query: "same",
				mediaAssets: [
					{ id: "x", name: "same.mp4" },
					{ id: "y", name: "same.mov" },
				],
			}),
		).toBeNull();
	});

	test("returns null when no match exists", () => {
		expect(
			resolveMediaAssetByName({
				query: "missing.mp4",
				mediaAssets,
			}),
		).toBeNull();
	});
});
