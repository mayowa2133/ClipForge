import {
	Input,
	ALL_FORMATS,
	BlobSource,
	CanvasSink,
	type WrappedCanvas,
} from "mediabunny";
import type { RenderAssetDescriptor } from "@/services/renderer/render-asset-registry";
import type { RenderVideoFrameProvider } from "@/services/renderer/video-frame-provider";

interface WorkerVideoSinkData {
	sink: CanvasSink;
	iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null;
	currentFrame: WrappedCanvas | null;
	nextFrame: WrappedCanvas | null;
	lastTime: number;
	prefetching: boolean;
	prefetchPromise: Promise<void> | null;
}

export class WorkerVideoFrameProvider implements RenderVideoFrameProvider {
	private assets = new Map<string, RenderAssetDescriptor>();
	private sinks = new Map<string, WorkerVideoSinkData>();
	private initPromises = new Map<string, Promise<void>>();

	setAssets(assets: RenderAssetDescriptor[]): void {
		const next = new Map<string, RenderAssetDescriptor>();
		for (const asset of assets) {
			next.set(asset.id, asset);
			const previous = this.assets.get(asset.id);
			if (
				previous?.type === "video" &&
				asset.type === "video" &&
				previous.file !== asset.file
			) {
				this.clearVideo({ mediaId: asset.id });
			}
		}

		for (const [mediaId, asset] of this.assets) {
			if (asset.type !== "video") continue;
			const nextAsset = next.get(mediaId);
			if (!nextAsset || nextAsset.type !== "video") {
				this.clearVideo({ mediaId });
			}
		}

		this.assets = next;
	}

	async getFrameAt({
		mediaId,
		file,
		time,
	}: {
		mediaId: string;
		file?: File;
		time: number;
	}): Promise<CanvasImageSource | null> {
		const resolvedFile = file ?? this.assets.get(mediaId)?.file;
		if (!resolvedFile) return null;

		await this.ensureSink({ mediaId, file: resolvedFile });
		const sinkData = this.sinks.get(mediaId);
		if (!sinkData) return null;

		if (sinkData.nextFrame && sinkData.nextFrame.timestamp <= time) {
			sinkData.currentFrame = sinkData.nextFrame;
			sinkData.nextFrame = null;
			this.startPrefetch({ sinkData });
		}

		if (
			sinkData.currentFrame &&
			this.isFrameValid({ frame: sinkData.currentFrame, time })
		) {
			if (!sinkData.nextFrame && !sinkData.prefetching) {
				this.startPrefetch({ sinkData });
			}
			return sinkData.currentFrame.canvas ?? null;
		}

		if (
			sinkData.iterator &&
			sinkData.currentFrame &&
			time >= sinkData.lastTime &&
			time < sinkData.lastTime + 2
		) {
			const frame = await this.iterateToTime({ sinkData, targetTime: time });
			if (frame) {
				if (!sinkData.nextFrame && !sinkData.prefetching) {
					this.startPrefetch({ sinkData });
				}
				return frame.canvas ?? null;
			}
		}

		const frame = await this.seekToTime({ sinkData, time });
		if (frame && !sinkData.nextFrame && !sinkData.prefetching) {
			this.startPrefetch({ sinkData });
		}
		return frame?.canvas ?? null;
	}

	clearVideo({ mediaId }: { mediaId: string }): void {
		const sinkData = this.sinks.get(mediaId);
		if (sinkData?.iterator) {
			void sinkData.iterator.return();
		}
		this.sinks.delete(mediaId);
		this.initPromises.delete(mediaId);
	}

	clearAll(): void {
		for (const [mediaId] of this.sinks) {
			this.clearVideo({ mediaId });
		}
	}

	dispose(): void {
		this.clearAll();
		this.assets.clear();
	}

	private isFrameValid({
		frame,
		time,
	}: {
		frame: WrappedCanvas;
		time: number;
	}): boolean {
		return time >= frame.timestamp && time < frame.timestamp + frame.duration;
	}

	private async iterateToTime({
		sinkData,
		targetTime,
	}: {
		sinkData: WorkerVideoSinkData;
		targetTime: number;
	}): Promise<WrappedCanvas | null> {
		if (!sinkData.iterator) return null;

		try {
			while (true) {
				if (sinkData.prefetching && sinkData.prefetchPromise) {
					await sinkData.prefetchPromise;
				}

				if (
					sinkData.nextFrame &&
					sinkData.nextFrame.timestamp <= targetTime + 0.05
				) {
					sinkData.currentFrame = sinkData.nextFrame;
					sinkData.nextFrame = null;
				} else {
					const { value: frame, done } = await sinkData.iterator.next();
					if (done || !frame) break;
					sinkData.currentFrame = frame;
				}

				const frame = sinkData.currentFrame;
				if (!frame) break;

				sinkData.lastTime = frame.timestamp;
				if (this.isFrameValid({ frame, time: targetTime })) {
					return frame;
				}

				if (frame.timestamp > targetTime + 1) break;
			}
		} catch {
			sinkData.iterator = null;
		}

		return null;
	}

	private async seekToTime({
		sinkData,
		time,
	}: {
		sinkData: WorkerVideoSinkData;
		time: number;
	}): Promise<WrappedCanvas | null> {
		try {
			if (sinkData.prefetching && sinkData.prefetchPromise) {
				await sinkData.prefetchPromise;
			}

			if (sinkData.iterator) {
				await sinkData.iterator.return();
				sinkData.iterator = null;
			}

			sinkData.nextFrame = null;
			sinkData.iterator = sinkData.sink.canvases(time);
			sinkData.lastTime = time;

			const { value: frame } = await sinkData.iterator.next();
			if (!frame) return null;

			sinkData.currentFrame = frame;
			try {
				const { value: next } = await sinkData.iterator.next();
				if (next) {
					sinkData.nextFrame = next;
				}
			} catch {
				// Ignore failed prefetch on initial seek.
			}

			return frame;
		} catch {
			return null;
		}
	}

	private startPrefetch({ sinkData }: { sinkData: WorkerVideoSinkData }): void {
		if (sinkData.prefetching || !sinkData.iterator || sinkData.nextFrame) {
			return;
		}

		sinkData.prefetching = true;
		sinkData.prefetchPromise = this.prefetchNextFrame({ sinkData });
	}

	private async prefetchNextFrame({
		sinkData,
	}: {
		sinkData: WorkerVideoSinkData;
	}): Promise<void> {
		if (!sinkData.iterator) {
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
			return;
		}

		try {
			const { value: frame, done } = await sinkData.iterator.next();
			if (done || !frame) {
				sinkData.prefetching = false;
				sinkData.prefetchPromise = null;
				return;
			}
			sinkData.nextFrame = frame;
		} catch {
			sinkData.iterator = null;
		} finally {
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
		}
	}

	private async ensureSink({
		mediaId,
		file,
	}: {
		mediaId: string;
		file: File;
	}): Promise<void> {
		if (this.sinks.has(mediaId)) return;

		const existing = this.initPromises.get(mediaId);
		if (existing) {
			await existing;
			return;
		}

		const initPromise = this.initializeSink({ mediaId, file });
		this.initPromises.set(mediaId, initPromise);
		try {
			await initPromise;
		} finally {
			this.initPromises.delete(mediaId);
		}
	}

	private async initializeSink({
		mediaId,
		file,
	}: {
		mediaId: string;
		file: File;
	}): Promise<void> {
		const input = new Input({
			source: new BlobSource(file),
			formats: ALL_FORMATS,
		});
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) {
			throw new Error("No video track found");
		}
		const canDecode = await videoTrack.canDecode();
		if (!canDecode) {
			throw new Error("Video codec not supported for decoding");
		}
		const sink = new CanvasSink(videoTrack, {
			poolSize: 3,
			fit: "contain",
		});
		this.sinks.set(mediaId, {
			sink,
			iterator: null,
			currentFrame: null,
			nextFrame: null,
			lastTime: -1,
			prefetching: false,
			prefetchPromise: null,
		});
	}
}
