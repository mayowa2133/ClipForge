import type { RenderGraph } from "@/services/renderer/types";

export interface RenderFrameRequest {
	graph: RenderGraph;
	time: number;
	targetSize: { width: number; height: number };
}

export interface RenderBackendDiagnostics {
	backendKind: "binary-preview" | "binary-canvas" | "legacy-canvas";
	usedBinaryFallback: boolean;
	usedLegacyFallback: boolean;
	unsupportedFeatures: string[];
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
	getDiagnostics?(): RenderBackendDiagnostics;
	resetDiagnostics?(): void;
	dispose(): Promise<void> | void;
}
