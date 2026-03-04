import { afterEach, describe, expect, mock, test } from "bun:test";
import { RenderAssetRegistry } from "@/services/renderer/render-asset-registry";
import { MainThreadVideoFrameProvider } from "@/services/renderer/video-frame-provider";
import { videoCache } from "@/services/video-cache/service";

const originalGetFrameAt = videoCache.getFrameAt;
const originalClearVideo = videoCache.clearVideo;
const originalClearAll = videoCache.clearAll;

afterEach(() => {
	videoCache.getFrameAt = originalGetFrameAt;
	videoCache.clearVideo = originalClearVideo;
	videoCache.clearAll = originalClearAll;
});

describe("MainThreadVideoFrameProvider", () => {
	test("delegates to videoCache with the resolved media file", async () => {
		const registry = new RenderAssetRegistry();
		const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
		registry.setAssets([
			{
				id: "media-1",
				name: "clip.mp4",
				type: "video",
				file,
				url: "blob:clip",
			},
		]);

		const canvas = {
			width: 320,
			height: 180,
		} as unknown as HTMLCanvasElement;
		const getFrameAtMock = mock(
			async () =>
				({
					canvas,
					timestamp: 0,
					duration: 1 / 30,
				}) as Awaited<ReturnType<typeof videoCache.getFrameAt>>,
		);
		videoCache.getFrameAt = getFrameAtMock as unknown as typeof videoCache.getFrameAt;

		const provider = new MainThreadVideoFrameProvider(registry);
		const result = await provider.getFrameAt({
			mediaId: "media-1",
			time: 1.25,
		});

		expect(result).toBe(canvas);
		expect(getFrameAtMock).toHaveBeenCalledWith({
			mediaId: "media-1",
			file,
			time: 1.25,
		});
	});

	test("forwards cache clearing methods", () => {
		const registry = new RenderAssetRegistry();
		const clearVideoMock = mock(() => {});
		const clearAllMock = mock(() => {});
		videoCache.clearVideo = clearVideoMock as typeof videoCache.clearVideo;
		videoCache.clearAll = clearAllMock as typeof videoCache.clearAll;

		const provider = new MainThreadVideoFrameProvider(registry);
		provider.clearVideo({ mediaId: "media-9" });
		provider.clearAll();

		expect(clearVideoMock).toHaveBeenCalledWith({ mediaId: "media-9" });
		expect(clearAllMock).toHaveBeenCalledTimes(1);
	});
});
