import type { RenderGraph } from "@/services/renderer/types";
import type { RenderVideoFrameProvider } from "@/services/renderer/video-frame-provider";
import { clearRenderSurface, drawBlurBackground } from "./render-background";
import { renderTextLayer } from "./render-text-layer";
import { drawVisualToContext } from "./render-visual";
import { renderVideoLayer } from "./render-video-layer";

type ResolvedImageLayer = {
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

type ResolvedTextLayer = Extract<RenderGraph["layers"][number], { kind: "text" }>;

type ResolvedVideoLayer = Extract<RenderGraph["layers"][number], { kind: "video" }> & {
	payload: Extract<RenderGraph["layers"][number], { kind: "video" }>["payload"] & {
		file?: File;
	};
};

export type ResolvedRenderGraph = Omit<RenderGraph, "layers"> & {
	layers: Array<ResolvedVideoLayer | ResolvedImageLayer | ResolvedTextLayer>;
};

const sourceCache = new Map<
	string,
	Promise<{ source: CanvasImageSource; width: number; height: number }>
>();

export function clearResolvedSourceCache(): void {
	sourceCache.clear();
}

export async function renderGraphToContext({
	graph,
	time,
	ctx,
	videoFrameProvider,
}: {
	graph: ResolvedRenderGraph;
	time: number;
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	videoFrameProvider: RenderVideoFrameProvider;
}): Promise<void> {
	clearRenderSurface({ ctx, graph });
	const visibleLayers = graph.layers
		.filter((layer) => !layer.hidden)
		.sort((a, b) => a.zIndex - b.zIndex);

	if (graph.background.type === "blur") {
		const contentCanvas = createScratchCanvas({
			width: graph.canvas.width,
			height: graph.canvas.height,
		});
		const contentCtx = getScratchContext({ canvas: contentCanvas });
		await renderLayers({
			ctx: contentCtx,
			layers: visibleLayers,
			time,
			width: graph.canvas.width,
			height: graph.canvas.height,
			videoFrameProvider,
		});
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

	await renderLayers({
		ctx,
		layers: visibleLayers,
		time,
		width: graph.canvas.width,
		height: graph.canvas.height,
		videoFrameProvider,
	});
}

async function renderLayers({
	ctx,
	layers,
	time,
	width,
	height,
	videoFrameProvider,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	layers: Array<ResolvedVideoLayer | ResolvedImageLayer | ResolvedTextLayer>;
	time: number;
	width: number;
	height: number;
	videoFrameProvider: RenderVideoFrameProvider;
}): Promise<void> {
	for (const layer of layers) {
		if (time < layer.startTime || time >= layer.startTime + layer.duration) {
			continue;
		}

		if (layer.kind === "text") {
			renderTextLayer({ ctx, payload: layer.payload, time });
			continue;
		}

		if (layer.kind === "video") {
			await renderVideoLayer({
				ctx,
				layer,
				time,
				canvasWidth: width,
				canvasHeight: height,
				videoFrameProvider,
			});
			continue;
		}

		const source = await loadResolvedSource({
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

async function loadResolvedSource({
	url,
	maxSourceSize,
}: {
	url: string;
	maxSourceSize?: number;
}): Promise<{ source: CanvasImageSource; width: number; height: number }> {
	const key = `${url}::${maxSourceSize ?? "full"}`;
	const cached = sourceCache.get(key);
	if (cached) return cached;

	const promise = (async () => {
		if (typeof fetch === "undefined" || typeof createImageBitmap === "undefined") {
			throw new Error("Binary image rendering is unavailable in this environment");
		}

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
			const offscreen = createScratchCanvas({
				width: scaledWidth,
				height: scaledHeight,
			});
			const offscreenCtx = getScratchContext({ canvas: offscreen });
			offscreenCtx.drawImage(bitmap, 0, 0, scaledWidth, scaledHeight);
			return { source: offscreen, width: scaledWidth, height: scaledHeight };
		}

		return { source: bitmap, width: bitmap.width, height: bitmap.height };
	})();

	sourceCache.set(key, promise);
	return promise;
}

function createScratchCanvas({
	width,
	height,
}: {
	width: number;
	height: number;
}): OffscreenCanvas | HTMLCanvasElement {
	if (typeof OffscreenCanvas !== "undefined") {
		return new OffscreenCanvas(width, height);
	}
	if (typeof document !== "undefined") {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
	throw new Error("No canvas implementation is available");
}

function getScratchContext({
	canvas,
}: {
	canvas: OffscreenCanvas | HTMLCanvasElement;
}): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Failed to get render context");
	}
	return ctx;
}
