import type { RenderGraph } from "@/services/renderer/types";

export interface RenderFrameRequest {
	graph: RenderGraph;
	time: number;
	targetSize: { width: number; height: number };
}

export interface RenderedFrame {
	kind: "image-bitmap" | "canvas";
	bitmap?: ImageBitmap;
	canvas?: OffscreenCanvas | HTMLCanvasElement;
	width: number;
	height: number;
}

export interface RenderBackend {
	renderFrame(request: RenderFrameRequest): Promise<RenderedFrame>;
	dispose(): Promise<void> | void;
}
