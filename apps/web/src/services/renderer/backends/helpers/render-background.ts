import type { RenderBackground, RenderGraph } from "@/services/renderer/types";

export function clearRenderSurface({
	ctx,
	graph,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	graph: Pick<RenderGraph, "canvas" | "background">;
}): void {
	ctx.clearRect(0, 0, graph.canvas.width, graph.canvas.height);
	if (graph.background.type === "color" && graph.background.color !== "transparent") {
		ctx.fillStyle = graph.background.color;
		ctx.fillRect(0, 0, graph.canvas.width, graph.canvas.height);
	}
}

export function drawBlurBackground({
	targetCtx,
	source,
	blurIntensity,
	width,
	height,
}: {
	targetCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	source: OffscreenCanvas | HTMLCanvasElement;
	blurIntensity: number;
	width: number;
	height: number;
}): void {
	const zoomScale = 1.05;
	const scaledWidth = width * zoomScale;
	const scaledHeight = height * zoomScale;
	const offsetX = (width - scaledWidth) / 2;
	const offsetY = (height - scaledHeight) / 2;

	targetCtx.save();
	targetCtx.filter = `blur(${blurIntensity}px)`;
	targetCtx.drawImage(source, offsetX, offsetY, scaledWidth, scaledHeight);
	targetCtx.restore();
}
