import { describe, expect, test } from "bun:test";
import { RenderAssetRegistry } from "@/services/renderer/render-asset-registry";
import type { MediaAsset } from "@/types/assets";

function buildMediaAsset({
	id,
	name,
	type,
	url,
}: {
	id: string;
	name: string;
	type: MediaAsset["type"];
	url: string;
}): MediaAsset {
	return {
		id,
		name,
		type,
		file: new File(["x"], name, { type: "application/octet-stream" }),
		url,
		width: 1920,
		height: 1080,
		duration: 5,
		thumbnailUrl: `${url}.thumb`,
	};
}

describe("RenderAssetRegistry", () => {
	test("stores renderer-safe asset descriptors and bumps version on updates", () => {
		const registry = new RenderAssetRegistry();
		expect(registry.getVersion()).toBe(0);

		registry.setAssets([
			buildMediaAsset({
				id: "media-1",
				name: "clip.mp4",
				type: "video",
				url: "blob:clip",
			}),
		]);

		expect(registry.getVersion()).toBe(1);
		expect(registry.getAsset("media-1")).toEqual({
			id: "media-1",
			type: "video",
			url: "blob:clip",
			file: expect.any(File),
			width: 1920,
			height: 1080,
			duration: 5,
			thumbnailUrl: "blob:clip.thumb",
		});
		expect(registry.getAssets()).toHaveLength(1);

		registry.setAssets([
			buildMediaAsset({
				id: "media-2",
				name: "still.png",
				type: "image",
				url: "blob:image",
			}),
		]);

		expect(registry.getVersion()).toBe(2);
		expect(registry.getAsset("media-1")).toBeNull();
		expect(registry.getAsset("media-2")?.type).toBe("image");
		expect(registry.getAssets().map((asset) => asset.id)).toEqual(["media-2"]);
	});
});
