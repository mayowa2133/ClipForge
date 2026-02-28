import type { MediaAsset } from "@/types/assets";

export interface RenderAssetDescriptor {
	id: string;
	type: MediaAsset["type"];
	url?: string;
	file: File;
	width?: number;
	height?: number;
	duration?: number;
	thumbnailUrl?: string;
}

export class RenderAssetRegistry {
	private assets = new Map<string, RenderAssetDescriptor>();
	private version = 0;

	setAssets(mediaAssets: MediaAsset[]): void {
		const next = new Map<string, RenderAssetDescriptor>();
		for (const asset of mediaAssets) {
			next.set(asset.id, {
				id: asset.id,
				type: asset.type,
				url: asset.url,
				file: asset.file,
				width: asset.width,
				height: asset.height,
				duration: asset.duration,
				thumbnailUrl: asset.thumbnailUrl,
			});
		}
		this.assets = next;
		this.version += 1;
	}

	getAsset(mediaId: string): RenderAssetDescriptor | null {
		return this.assets.get(mediaId) ?? null;
	}

	getVersion(): number {
		return this.version;
	}
}
