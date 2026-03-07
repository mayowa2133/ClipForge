import type { RenderAssetRegistry } from "@/services/renderer/render-asset-registry";
import type { RenderGraph } from "@/services/renderer/types";
import { BinaryCanvasBackend } from "./binary-canvas-backend";
import { LegacyCanvasBackend } from "./legacy-canvas-backend";
import type {
	RenderBackend,
	RenderBackendDiagnostics,
	RenderFrameRequest,
	RenderedFrame,
} from "./types";
import type {
	RendererWorkerRequest,
	RendererWorkerResponse,
	WorkerRenderGraph,
} from "./binary-preview-worker";

export class BinaryPreviewBackend implements RenderBackend {
	private readonly binaryFallback: BinaryCanvasBackend;
	private readonly legacyFallback: LegacyCanvasBackend;
	private worker: Worker | null = null;
	private initPromise: Promise<void> | null = null;
	private lastSyncedAssetVersion: number | null = null;
	private readonly diagnostics: RenderBackendDiagnostics = {
		backendKind: "binary-preview",
		usedBinaryFallback: false,
		usedLegacyFallback: false,
		unsupportedFeatures: [],
	};

	constructor(private readonly assetRegistry: RenderAssetRegistry) {
		this.binaryFallback = new BinaryCanvasBackend(assetRegistry);
		this.legacyFallback = new LegacyCanvasBackend(assetRegistry);
	}

	async renderFrame(request: RenderFrameRequest): Promise<RenderedFrame> {
		if (!this.canUseWorker()) {
			this.recordUnsupportedFeature({ feature: "worker-unavailable" });
			return this.renderWithFallbacks(request);
		}

		try {
			await this.ensureWorker({ graph: request.graph });
			await this.syncAssetsToWorker();
			if (!this.worker) {
				return this.renderWithFallbacks(request);
			}

			const graph = this.toWorkerGraph({ graph: request.graph });
			const frame = Math.floor(request.time * 1000);
			return await new Promise<RenderedFrame>((resolve) => {
				const worker = this.worker;
				if (!worker) {
					this.renderWithFallbacks(request).then(resolve);
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
						this.logFallback({
							message: `Worker render failed: ${response.error}`,
						});
						this.disposeWorker();
						this.renderWithFallbacks(request).then(resolve);
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
		} catch (error) {
			this.logFallback({
				message: `Worker backend failed: ${error instanceof Error ? error.message : "unknown error"}`,
			});
			this.disposeWorker();
			return this.renderWithFallbacks(request);
		}
	}

	dispose(): void {
		this.disposeWorker();
		this.binaryFallback.dispose();
		this.legacyFallback.dispose();
	}

	getDiagnostics(): RenderBackendDiagnostics {
		return {
			...this.diagnostics,
			unsupportedFeatures: [...this.diagnostics.unsupportedFeatures],
		};
	}

	resetDiagnostics(): void {
		this.diagnostics.usedBinaryFallback = false;
		this.diagnostics.usedLegacyFallback = false;
		this.diagnostics.unsupportedFeatures = [];
		this.binaryFallback.resetDiagnostics?.();
		this.legacyFallback.resetDiagnostics?.();
	}

	private canUseWorker(): boolean {
		return (
			typeof Worker !== "undefined" &&
			typeof OffscreenCanvas !== "undefined" &&
			typeof createImageBitmap !== "undefined"
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
		this.lastSyncedAssetVersion = null;
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

	private async syncAssetsToWorker(): Promise<void> {
		const worker = this.worker;
		if (!worker) return;

		const version = this.assetRegistry.getVersion();
		if (this.lastSyncedAssetVersion === version) {
			return;
		}

		await new Promise<void>((resolve) => {
			const handleMessage = (event: MessageEvent<RendererWorkerResponse>) => {
				if (event.data.type !== "assets-ready" || event.data.version !== version) {
					return;
				}
				worker.removeEventListener("message", handleMessage);
				resolve();
			};

			worker.addEventListener("message", handleMessage);
			worker.postMessage({
				type: "set-assets",
				version,
				assets: this.assetRegistry.getAssets(),
			} satisfies RendererWorkerRequest);
		});
		this.lastSyncedAssetVersion = version;
	}

	private toWorkerGraph({ graph }: { graph: RenderGraph }): WorkerRenderGraph {
		return {
			...graph,
			layers: graph.layers.map((layer) => {
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
		};
	}

	private async renderWithFallbacks(
		request: RenderFrameRequest,
	): Promise<RenderedFrame> {
		try {
			const frame = await this.binaryFallback.renderFrame(request);
			this.diagnostics.usedBinaryFallback = true;
			return frame;
		} catch (error) {
			this.logFallback({
				message: `Graph-native binary fallback failed: ${error instanceof Error ? error.message : "unknown error"}`,
			});
			this.recordUnsupportedFeature({ feature: "binary-fallback-render-failed" });
			this.diagnostics.usedLegacyFallback = true;
			return this.legacyFallback.renderFrame(request);
		}
	}

	private disposeWorker() {
		if (this.worker) {
			this.worker.postMessage({ type: "dispose" } satisfies RendererWorkerRequest);
			this.worker.terminate();
		}
		this.worker = null;
		this.initPromise = null;
		this.lastSyncedAssetVersion = null;
	}

	private logFallback({ message }: { message: string }) {
		if (process.env.NODE_ENV !== "production") {
			console.warn(`[BinaryPreviewBackend] ${message}`);
		}
	}

	private recordUnsupportedFeature({ feature }: { feature: string }) {
		if (!this.diagnostics.unsupportedFeatures.includes(feature)) {
			this.diagnostics.unsupportedFeatures.push(feature);
		}
	}
}
