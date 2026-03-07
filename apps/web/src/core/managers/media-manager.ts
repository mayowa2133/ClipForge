import type { EditorCore } from "@/core";
import type { MediaAsset } from "@/types/assets";
import { storageService } from "@/services/storage/service";
import type { MediaAssetData } from "@/services/storage/types";
import { generateUUID } from "@/utils/id";
import { videoCache } from "@/services/video-cache/service";
import { hasMediaId } from "@/lib/timeline/element-utils";
import {
	areMediaCompatibilitySnapshotsEqual,
	buildPendingMediaCompatibilitySnapshot,
	buildUnknownMediaCompatibilitySnapshot,
	probeAssetCompatibility,
} from "@/lib/media/media-compatibility";
import { generateFreezeFrameFile } from "@/lib/media/processing";

export class MediaManager {
	private assets: MediaAsset[] = [];
	private isLoading = false;
	private listeners = new Set<() => void>();
	private currentProjectId: string | null = null;
	private compatibilityProbeQueue = new Set<string>();
	private isCompatibilityProbeLoopRunning = false;

	constructor(private editor: EditorCore) {}

	async addMediaAsset({
		projectId,
		asset,
	}: {
		projectId: string;
		asset: Omit<MediaAsset, "id">;
	}): Promise<MediaAsset | null> {
		const newAsset: MediaAsset = {
			...asset,
			id: generateUUID(),
			mimeType: asset.mimeType ?? asset.file.type ?? "",
			compatibility: asset.compatibility ?? buildUnknownMediaCompatibilitySnapshot(),
		};
		this.currentProjectId = projectId;

		this.assets = [...this.assets, newAsset];
		this.notify();

		try {
			await storageService.saveMediaAsset({ projectId, mediaAsset: newAsset });
			this.scheduleMediaCompatibilityProbe({
				ids: [newAsset.id],
			});
			return newAsset;
		} catch (error) {
			console.error("Failed to save media asset:", error);
			this.assets = this.assets.filter((asset) => asset.id !== newAsset.id);
			this.notify();
			return null;
		}
	}

	async removeMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<void> {
		this.currentProjectId = projectId;
		const asset = this.assets.find((asset) => asset.id === id);

		videoCache.clearVideo({ mediaId: id });

		if (asset?.url) {
			URL.revokeObjectURL(asset.url);
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		}

		this.assets = this.assets.filter((asset) => asset.id !== id);
		this.notify();

		const tracks = this.editor.timeline.getTracks();
		const elementsToRemove: Array<{ trackId: string; elementId: string }> = [];

		for (const track of tracks) {
			for (const element of track.elements) {
				if (hasMediaId(element) && element.mediaId === id) {
					elementsToRemove.push({ trackId: track.id, elementId: element.id });
				}
			}
		}

		if (elementsToRemove.length > 0) {
			this.editor.timeline.deleteElements({ elements: elementsToRemove });
		}

		try {
			await storageService.deleteMediaAsset({ projectId, id });
		} catch (error) {
			console.error("Failed to delete media asset:", error);
		}
	}

	async relinkMediaAsset({
		projectId,
		id,
		asset,
	}: {
		projectId: string;
		id: string;
		asset: Omit<MediaAsset, "id">;
	}): Promise<MediaAsset | null> {
		const relinkedAsset: MediaAsset = {
			...asset,
			id,
			mimeType: asset.mimeType ?? asset.file.type ?? "",
			compatibility: buildUnknownMediaCompatibilitySnapshot(),
		};
		this.currentProjectId = projectId;
		const previousAssets = this.assets;
		const previousAsset = previousAssets.find((candidate) => candidate.id === id) ?? null;
		const nextAssets =
			previousAsset === null
				? [...previousAssets, relinkedAsset]
				: previousAssets.map((candidate) =>
						candidate.id === id ? relinkedAsset : candidate,
					);

		videoCache.clearVideo({ mediaId: id });

		this.assets = nextAssets;
		this.notify();

		try {
			await storageService.saveMediaAsset({
				projectId,
				mediaAsset: relinkedAsset,
			});
			this.scheduleMediaCompatibilityProbe({
				ids: [id],
			});
			if (previousAsset?.url) {
				URL.revokeObjectURL(previousAsset.url);
				if (previousAsset.thumbnailUrl) {
					URL.revokeObjectURL(previousAsset.thumbnailUrl);
				}
			}
			return relinkedAsset;
		} catch (error) {
			console.error("Failed to relink media asset:", error);
			this.assets = previousAssets;
			this.notify();
			return null;
		}
	}

	async createDerivedFreezeFrameAsset({
		sourceMediaId,
		sourceTime,
	}: {
		sourceMediaId: string;
		sourceTime: number;
	}): Promise<MediaAsset | null> {
		const activeProject = this.editor.project.getActive();
		const sourceAsset = this.assets.find((asset) => asset.id === sourceMediaId);
		if (!activeProject || !sourceAsset || sourceAsset.type !== "video") {
			return null;
		}

		const freezeFrame = await generateFreezeFrameFile({
			videoFile: sourceAsset.file,
			timeInSeconds: sourceTime,
			fileName: `${sourceAsset.name.replace(/\.[^.]+$/, "")}-freeze-${Math.round(
				sourceTime * 1000,
			)}.png`,
		});

		return this.addMediaAsset({
			projectId: activeProject.metadata.id,
			asset: {
				name: freezeFrame.file.name,
				type: "image",
				file: freezeFrame.file,
				url: URL.createObjectURL(freezeFrame.file),
				thumbnailUrl: freezeFrame.thumbnailUrl,
				width: freezeFrame.width,
				height: freezeFrame.height,
				duration: undefined,
				fps: undefined,
				mimeType: freezeFrame.file.type,
				compatibility: buildUnknownMediaCompatibilitySnapshot(),
				derived: {
					kind: "freeze-frame",
					sourceMediaId,
					sourceTime,
				},
			},
		});
	}

	async loadProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		this.isLoading = true;
		this.currentProjectId = projectId;
		this.notify();

		try {
			const mediaAssets = await storageService.loadAllMediaAssets({
				projectId,
			});
			this.assets = mediaAssets.map((asset) => ({
				...asset,
				mimeType: asset.mimeType ?? asset.file.type ?? "",
				compatibility:
					asset.compatibility ?? buildUnknownMediaCompatibilitySnapshot(),
			}));
			this.notify();
			this.scheduleMediaCompatibilityProbe({
				ids: this.assets
					.filter(
						(asset) =>
							!asset.compatibility ||
							asset.compatibility.status === "unknown" ||
							asset.compatibility.status === "pending",
					)
					.map((asset) => asset.id),
			});
		} catch (error) {
			console.error("Failed to load media assets:", error);
		} finally {
			this.isLoading = false;
			this.notify();
		}
	}

	async clearProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		this.currentProjectId = projectId;
		this.assets.forEach((asset) => {
			if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		const mediaIds = this.assets.map((asset) => asset.id);
		this.assets = [];
		this.notify();

		try {
			await Promise.all(
				mediaIds.map((id) =>
					storageService.deleteMediaAsset({ projectId, id }),
				),
			);
		} catch (error) {
			console.error("Failed to clear media assets from storage:", error);
		}
	}

	clearAllAssets(): void {
		videoCache.clearAll();

		this.assets.forEach((asset) => {
			if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		this.assets = [];
		this.notify();
		this.currentProjectId = null;
		this.compatibilityProbeQueue.clear();
		this.isCompatibilityProbeLoopRunning = false;
	}

	getAssets(): MediaAsset[] {
		return this.assets;
	}

	setAssets({ assets }: { assets: MediaAsset[] }): void {
		this.assets = assets.map((asset) => ({
			...asset,
			mimeType: asset.mimeType ?? asset.file.type ?? "",
			compatibility:
				asset.compatibility ?? buildUnknownMediaCompatibilitySnapshot(),
		}));
		this.notify();
	}

	async probeMediaCompatibility({
		ids,
	}: {
		ids?: string[];
	} = {}): Promise<{ scanned: number; updated: number; failed: number }> {
		const targetIds = [
			...new Set((ids ?? this.assets.map((asset) => asset.id)).filter(Boolean)),
		];
		if (targetIds.length === 0) {
			return { scanned: 0, updated: 0, failed: 0 };
		}

		const projectId =
			this.currentProjectId ?? this.editor.project.getActive()?.metadata.id ?? null;
		if (!projectId) {
			return {
				scanned: targetIds.length,
				updated: 0,
				failed: targetIds.length,
			};
		}

		let scanned = 0;
		let updated = 0;
		let failed = 0;

		for (const id of targetIds) {
			const index = this.assets.findIndex((asset) => asset.id === id);
			if (index < 0) continue;

			scanned += 1;
			const asset = this.assets[index] as MediaAsset;
			const pendingAsset: MediaAsset = {
				...asset,
				compatibility: buildPendingMediaCompatibilitySnapshot(),
			};
			this.assets[index] = pendingAsset;
			this.notify();

			const compatibility = await probeAssetCompatibility({ asset: pendingAsset });
			if (compatibility.status === "error") {
				failed += 1;
			}

			const nextAsset: MediaAsset = {
				...pendingAsset,
				compatibility,
			};
			const wasChanged = !areMediaCompatibilitySnapshotsEqual({
				a: asset.compatibility,
				b: compatibility,
			});
			this.assets[index] = nextAsset;
			this.notify();

			try {
				const metadata: MediaAssetData = {
					id: nextAsset.id,
					name: nextAsset.name,
					type: nextAsset.type,
					size: nextAsset.file.size,
					lastModified: nextAsset.file.lastModified,
					width: nextAsset.width,
					height: nextAsset.height,
					duration: nextAsset.duration,
					fps: nextAsset.fps,
					thumbnailUrl: nextAsset.thumbnailUrl,
					ephemeral: nextAsset.ephemeral,
					mimeType: nextAsset.mimeType ?? nextAsset.file.type ?? "",
					compatibility: nextAsset.compatibility,
					derived: nextAsset.derived,
				};
				await storageService.saveMediaAssetMetadata({
					projectId,
					metadata,
				});
				if (wasChanged) {
					updated += 1;
				}
			} catch (error) {
				console.error("Failed to persist compatibility snapshot:", error);
				failed += 1;
			}
		}

		return {
			scanned,
			updated,
			failed,
		};
	}

	scheduleMediaCompatibilityProbe({
		ids,
	}: {
		ids?: string[];
	} = {}): void {
		const targetIds = ids ?? this.assets.map((asset) => asset.id);
		for (const id of targetIds) {
			if (id) {
				this.compatibilityProbeQueue.add(id);
			}
		}
		if (this.compatibilityProbeQueue.size === 0 || this.isCompatibilityProbeLoopRunning) {
			return;
		}
		this.isCompatibilityProbeLoopRunning = true;
		queueMicrotask(() => {
			void this.flushCompatibilityProbeQueue();
		});
	}

	isLoadingMedia(): boolean {
		return this.isLoading;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => fn());
	}

	private async flushCompatibilityProbeQueue(): Promise<void> {
		try {
			while (this.compatibilityProbeQueue.size > 0) {
				const batch = [...this.compatibilityProbeQueue];
				this.compatibilityProbeQueue.clear();
				await this.probeMediaCompatibility({ ids: batch });
			}
		} finally {
			this.isCompatibilityProbeLoopRunning = false;
			if (this.compatibilityProbeQueue.size > 0) {
				this.scheduleMediaCompatibilityProbe();
			}
		}
	}
}
