import { graphHasVideo } from "@/services/renderer/render-graph";
import type { RenderAssetRegistry } from "@/services/renderer/render-asset-registry";
import type { RenderGraph } from "@/services/renderer/types";
import { LegacyCanvasBackend } from "./legacy-canvas-backend";
import type { RenderBackend, RenderFrameRequest, RenderedFrame } from "./types";
import type {
	RendererWorkerRequest,
	RendererWorkerResponse,
} from "./binary-preview-worker";

export class BinaryPreviewBackend implements RenderBackend {
	private readonly fallback: LegacyCanvasBackend;
	private worker: Worker | null = null;
	private initPromise: Promise<void> | null = null;

	constructor(private readonly assetRegistry: RenderAssetRegistry) {
		this.fallback = new LegacyCanvasBackend(assetRegistry);
	}

	async renderFrame(request: RenderFrameRequest): Promise<RenderedFrame> {
		if (!this.canUseWorker({ graph: request.graph })) {
			return this.fallback.renderFrame(request);
		}

		await this.ensureWorker({ graph: request.graph });
		if (!this.worker) {
			return this.fallback.renderFrame(request);
		}

		const graph = this.toWorkerGraph({ graph: request.graph });
		const frame = Math.floor(request.time * 1000);
		return new Promise<RenderedFrame>((resolve) => {
			const worker = this.worker;
			if (!worker) {
				this.fallback.renderFrame(request).then(resolve);
				return;
			}

			const handleMessage = (event: MessageEvent<RendererWorkerResponse>) => {
				const response = event.data;
				if (response.type === "render-complete" && response.frame === frame) {
					worker.removeEventListener("message", handleMessage);
					resolve({
						kind: "image-bitmap",
						bitmap: response.bitmap,
						width: request.graph.canvas.width,
						height: request.graph.canvas.height,
					});
					return;
				}

				if (response.type === "render-error" && response.frame === frame) {
					worker.removeEventListener("message", handleMessage);
					this.disposeWorker();
					this.fallback.renderFrame(request).then(resolve);
				}
			};

			worker.addEventListener("message", handleMessage);
			worker.postMessage({
				type: "render",
				frame,
				time: request.time,
				graph,
			} satisfies RendererWorkerRequest);
		});
	}

	dispose(): void {
		this.disposeWorker();
		this.fallback.dispose();
	}

	private canUseWorker({ graph }: { graph: RenderGraph }): boolean {
		return (
			typeof Worker !== "undefined" &&
			typeof OffscreenCanvas !== "undefined" &&
			typeof createImageBitmap !== "undefined" &&
			!graphHasVideo({ graph })
		);
	}

	private async ensureWorker({ graph }: { graph: RenderGraph }): Promise<void> {
		if (this.worker && this.initPromise) {
			await this.initPromise;
			return;
		}

		this.worker = new Worker(
			new URL("./binary-preview-worker.ts", import.meta.url),
			{ type: "module" },
		);
		this.initPromise = new Promise((resolve) => {
			const handleMessage = (event: MessageEvent<RendererWorkerResponse>) => {
				if (event.data.type !== "init-complete") return;
				this.worker?.removeEventListener("message", handleMessage);
				resolve();
			};
			this.worker?.addEventListener("message", handleMessage);
			this.worker?.postMessage({
				type: "init",
				width: graph.canvas.width,
				height: graph.canvas.height,
			} satisfies RendererWorkerRequest);
		});
		await this.initPromise;
	}

	private toWorkerGraph({ graph }: { graph: RenderGraph }) {
		return {
			...graph,
			layers: graph.layers
				.filter((layer) => layer.kind !== "video")
				.map((layer) => {
					if (layer.kind === "image") {
						const asset = this.assetRegistry.getAsset(layer.payload.mediaId);
						return {
							...layer,
							payload: {
								sourceUrl: asset?.url ?? "",
								transform: layer.payload.transform,
								opacity: layer.payload.opacity,
								blendMode: layer.payload.blendMode,
								maxSourceSize: layer.payload.maxSourceSize,
							},
						};
					}

					if (layer.kind === "sticker") {
						return {
							...layer,
							payload: {
								sourceUrl: layer.payload.sourceUrl,
								transform: layer.payload.transform,
								opacity: layer.payload.opacity,
								blendMode: layer.payload.blendMode,
							},
						};
					}

					return layer;
				}),
		} satisfies Extract<RendererWorkerRequest, { type: "render" }>["graph"];
	}

	private disposeWorker() {
		if (this.worker) {
			this.worker.postMessage({ type: "dispose" } satisfies RendererWorkerRequest);
			this.worker.terminate();
		}
		this.worker = null;
		this.initPromise = null;
	}
}
