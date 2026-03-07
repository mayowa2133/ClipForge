import type { RenderAssetRegistry } from "@/services/renderer/render-asset-registry";
import { MainThreadVideoFrameProvider } from "@/services/renderer/video-frame-provider";
import type { RenderGraph } from "@/services/renderer/types";
import {
	renderGraphToContext,
	type ResolvedRenderGraph,
} from "./helpers/render-graph-to-context";
import type {
	RenderBackend,
	RenderBackendDiagnostics,
	RenderFrameRequest,
	RenderedFrame,
} from "./types";

export class BinaryCanvasBackend implements RenderBackend {
	private surface: OffscreenCanvas | HTMLCanvasElement | null = null;
	private readonly videoFrameProvider: MainThreadVideoFrameProvider;
	private readonly diagnostics: RenderBackendDiagnostics = {
		backendKind: "binary-canvas",
		usedBinaryFallback: false,
		usedLegacyFallback: false,
		unsupportedFeatures: [],
	};

	constructor(private readonly assetRegistry: RenderAssetRegistry) {
		this.videoFrameProvider = new MainThreadVideoFrameProvider(assetRegistry);
	}

	async renderFrame(request: RenderFrameRequest): Promise<RenderedFrame> {
		const { graph, time } = request;
		const surface = this.ensureSurface({
			width: graph.canvas.width,
			height: graph.canvas.height,
		});
		const ctx = surface.getContext("2d");
		if (!ctx) {
			throw new Error("Failed to get binary render context");
		}

		await renderGraphToContext({
			graph: this.toResolvedGraph({ graph }),
			time,
			ctx,
			videoFrameProvider: this.videoFrameProvider,
		});

		return {
			kind: "canvas",
			canvas: surface,
			width: graph.canvas.width,
			height: graph.canvas.height,
		};
	}

	dispose(): void {
		this.videoFrameProvider.dispose();
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
	}

	private ensureSurface({
		width,
		height,
	}: {
		width: number;
		height: number;
	}): OffscreenCanvas | HTMLCanvasElement {
		if (
			!this.surface ||
			this.surface.width !== width ||
			this.surface.height !== height
		) {
			if (typeof OffscreenCanvas !== "undefined") {
				this.surface = new OffscreenCanvas(width, height);
			} else if (typeof document !== "undefined") {
				const canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = height;
				this.surface = canvas;
			} else {
				throw new Error("No canvas implementation is available");
			}
		}

		return this.surface;
	}

	private toResolvedGraph({ graph }: { graph: RenderGraph }): ResolvedRenderGraph {
		return {
			...graph,
			layers: graph.layers.map((layer) => {
				if (layer.kind === "image") {
					const asset = this.assetRegistry.getAsset(layer.payload.mediaId);
					return {
						...layer,
						payload: {
							sourceUrl: asset?.url ?? "",
							keyframes: layer.payload.keyframes,
							transitionIn: layer.payload.transitionIn,
							transform: layer.payload.transform,
							opacity: layer.payload.opacity,
							blendMode: layer.payload.blendMode,
							maxSourceSize: layer.payload.maxSourceSize,
						},
					};
				}

				if (layer.kind === "video") {
					const asset = this.assetRegistry.getAsset(layer.payload.mediaId);
					return {
						...layer,
						payload: {
							...layer.payload,
							file: asset?.file,
						},
					};
				}

				if (layer.kind === "sticker") {
					return {
						...layer,
						payload: {
							sourceUrl: layer.payload.sourceUrl,
							keyframes: layer.payload.keyframes,
							transitionIn: layer.payload.transitionIn,
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
}
