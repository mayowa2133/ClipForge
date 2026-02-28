/// <reference lib="webworker" />

import { clearRenderSurface, drawBlurBackground } from "./helpers/render-background";
import { renderTextLayer } from "./helpers/render-text-layer";
import { drawVisualToContext } from "./helpers/render-visual";
import type { RenderGraph } from "@/services/renderer/types";

type WorkerImageLayer = {
	id: string;
	zIndex: number;
	kind: "image" | "sticker";
	startTime: number;
	duration: number;
	trimStart: number;
	trimEnd: number;
	hidden: boolean;
	payload: {
		sourceUrl: string;
		transform: { scale: number; position: { x: number; y: number }; rotate: number };
		opacity: number;
		blendMode?: string;
		maxSourceSize?: number;
	};
};

type WorkerTextLayer = Extract<RenderGraph["layers"][number], { kind: "text" }>;

type WorkerRenderGraph = Omit<RenderGraph, "layers"> & {
	layers: Array<WorkerImageLayer | WorkerTextLayer>;
};

export type RendererWorkerRequest =
	| { type: "init"; width: number; height: number }
	| { type: "render"; frame: number; time: number; graph: WorkerRenderGraph }
	| { type: "dispose" };

export type RendererWorkerResponse =
	| { type: "init-complete" }
	| { type: "render-complete"; frame: number; time: number; bitmap: ImageBitmap }
	| { type: "render-error"; frame: number; time: number; error: string };

const imageCache = new Map<string, Promise<{ source: CanvasImageSource; width: number; height: number }>>();
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

self.onmessage = async (event: MessageEvent<RendererWorkerRequest>) => {
	const message = event.data;
	if (message.type === "init") {
		canvas = new OffscreenCanvas(message.width, message.height);
		ctx = canvas.getContext("2d");
		self.postMessage({ type: "init-complete" } satisfies RendererWorkerResponse);
		return;
	}

	if (message.type === "dispose") {
		imageCache.clear();
		canvas = null;
		ctx = null;
		return;
	}

	if (!canvas || !ctx) {
		self.postMessage({
			type: "render-error",
			frame: message.frame,
			time: message.time,
			error: "Worker not initialized",
		} satisfies RendererWorkerResponse);
		return;
	}

	try {
		if (
			canvas.width !== message.graph.canvas.width ||
			canvas.height !== message.graph.canvas.height
		) {
			canvas = new OffscreenCanvas(
				message.graph.canvas.width,
				message.graph.canvas.height,
			);
			ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("Failed to get worker render context");
		}

		await renderGraphToCanvas({
			graph: message.graph,
			time: message.time,
			canvas,
			ctx,
		});
		const bitmap = canvas.transferToImageBitmap();
		self.postMessage(
			{
				type: "render-complete",
				frame: message.frame,
				time: message.time,
				bitmap,
			} satisfies RendererWorkerResponse,
			[bitmap],
		);
	} catch (error) {
		self.postMessage({
			type: "render-error",
			frame: message.frame,
			time: message.time,
			error: error instanceof Error ? error.message : "Binary render failed",
		} satisfies RendererWorkerResponse);
	}
};

async function renderGraphToCanvas({
	graph,
	time,
	canvas,
	ctx,
}: {
	graph: WorkerRenderGraph;
	time: number;
	canvas: OffscreenCanvas;
	ctx: OffscreenCanvasRenderingContext2D;
}) {
	clearRenderSurface({ ctx, graph });
	const visibleLayers = graph.layers
		.filter((layer) => !layer.hidden)
		.sort((a, b) => a.zIndex - b.zIndex);

	if (graph.background.type === "blur") {
		const contentCanvas = new OffscreenCanvas(graph.canvas.width, graph.canvas.height);
		const contentCtx = contentCanvas.getContext("2d");
		if (!contentCtx) throw new Error("Failed to get offscreen content context");
		await renderLayers({ ctx: contentCtx, layers: visibleLayers, time, width: graph.canvas.width, height: graph.canvas.height });
		drawBlurBackground({
			targetCtx: ctx,
			source: contentCanvas,
			blurIntensity: graph.background.blurIntensity,
			width: graph.canvas.width,
			height: graph.canvas.height,
		});
		ctx.drawImage(contentCanvas, 0, 0);
		return;
	}

	await renderLayers({ ctx, layers: visibleLayers, time, width: graph.canvas.width, height: graph.canvas.height });
}

async function renderLayers({
	ctx,
	layers,
	time,
	width,
	height,
}: {
	ctx: OffscreenCanvasRenderingContext2D;
	layers: Array<WorkerImageLayer | WorkerTextLayer>;
	time: number;
	width: number;
	height: number;
}) {
	for (const layer of layers) {
		if (time < layer.startTime || time >= layer.startTime + layer.duration) {
			continue;
		}

		if (layer.kind === "text") {
			renderTextLayer({ ctx, payload: layer.payload, time });
			continue;
		}

		const source = await loadSource({
			url: layer.payload.sourceUrl,
			maxSourceSize: layer.payload.maxSourceSize,
		});
		drawVisualToContext({
			ctx,
			canvasWidth: width,
			canvasHeight: height,
			source: source.source,
			sourceWidth: source.width,
			sourceHeight: source.height,
			transform: layer.payload.transform,
			opacity: layer.payload.opacity,
			blendMode: (layer.payload.blendMode as never) ?? undefined,
		});
	}
}

function loadSource({
	url,
	maxSourceSize,
}: {
	url: string;
	maxSourceSize?: number;
}) {
	const key = `${url}::${maxSourceSize ?? "full"}`;
	const cached = imageCache.get(key);
	if (cached) return cached;

	const promise = (async () => {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to load source: ${response.status}`);
		}
		const blob = await response.blob();
		const bitmap = await createImageBitmap(blob);

		if (
			maxSourceSize &&
			(bitmap.width > maxSourceSize || bitmap.height > maxSourceSize)
		) {
			const scale = Math.min(
				maxSourceSize / bitmap.width,
				maxSourceSize / bitmap.height,
			);
			const scaledWidth = Math.max(1, Math.round(bitmap.width * scale));
			const scaledHeight = Math.max(1, Math.round(bitmap.height * scale));
			const offscreen = new OffscreenCanvas(scaledWidth, scaledHeight);
			const offscreenCtx = offscreen.getContext("2d");
			if (offscreenCtx) {
				offscreenCtx.drawImage(bitmap, 0, 0, scaledWidth, scaledHeight);
				return { source: offscreen, width: scaledWidth, height: scaledHeight };
			}
		}

		return { source: bitmap, width: bitmap.width, height: bitmap.height };
	})();

	imageCache.set(key, promise);
	return promise;
}
