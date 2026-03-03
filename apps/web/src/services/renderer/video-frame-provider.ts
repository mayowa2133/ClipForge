import type { RenderAssetRegistry } from "@/services/renderer/render-asset-registry";
import { videoCache } from "@/services/video-cache/service";

export interface RenderVideoFrameProvider {
	getFrameAt({
		mediaId,
		file,
		time,
	}: {
		mediaId: string;
		file?: File;
		time: number;
	}): Promise<CanvasImageSource | null>;
	clearVideo({ mediaId }: { mediaId: string }): void;
	clearAll(): void;
	dispose(): Promise<void> | void;
}

export class MainThreadVideoFrameProvider implements RenderVideoFrameProvider {
	constructor(private readonly assetRegistry: RenderAssetRegistry) {}

	async getFrameAt({
		mediaId,
		file,
		time,
	}: {
		mediaId: string;
		file?: File;
		time: number;
	}): Promise<CanvasImageSource | null> {
		const resolvedFile = file ?? this.assetRegistry.getAsset(mediaId)?.file;
		if (!resolvedFile) return null;
		const frame = await videoCache.getFrameAt({
			mediaId,
			file: resolvedFile,
			time,
		});
		return (frame as CanvasImageSource | null) ?? null;
	}

	clearVideo({ mediaId }: { mediaId: string }): void {
		videoCache.clearVideo({ mediaId });
	}

	clearAll(): void {
		videoCache.clearAll();
	}

	dispose(): void {
		this.clearAll();
	}
}
