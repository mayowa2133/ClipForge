/// <reference lib="webworker" />

import type { RenderAssetDescriptor } from "@/services/renderer/render-asset-registry";
import type { RenderGraph } from "@/services/renderer/types";
import { WorkerVideoFrameProvider } from "@/services/renderer/worker-video-frame-provider";
import {
	clearResolvedSourceCache,
	renderGraphToContext,
	type ResolvedRenderGraph,
} from "./helpers/render-graph-to-context";

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

type WorkerVideoLayer = Extract<RenderGraph["layers"][number], { kind: "video" }>;

export type WorkerRenderGraph = Omit<ResolvedRenderGraph, "layers"> & {
	layers: Array<WorkerVideoLayer | WorkerImageLayer | WorkerTextLayer>;
};

export type WorkerRenderAssetDescriptor = RenderAssetDescriptor;

export type RendererWorkerRequest =
	| { type: "init"; width: number; height: number }
	| { type: "set-assets"; assets: WorkerRenderAssetDescriptor[]; version: number }
	| { type: "render"; frame: number; time: number; graph: WorkerRenderGraph }
	| { type: "dispose" };

export type RendererWorkerResponse =
	| { type: "init-complete" }
	| { type: "assets-ready"; version: number }
	| { type: "render-complete"; frame: number; time: number; bitmap: ImageBitmap }
	| { type: "render-error"; frame: number; time: number; error: string };

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
const videoFrameProvider = new WorkerVideoFrameProvider();

self.onmessage = async (event: MessageEvent<RendererWorkerRequest>) => {
	const message = event.data;

	if (message.type === "init") {
		canvas = new OffscreenCanvas(message.width, message.height);
		ctx = canvas.getContext("2d");
		self.postMessage({ type: "init-complete" } satisfies RendererWorkerResponse);
		return;
	}

	if (message.type === "set-assets") {
		videoFrameProvider.setAssets(message.assets);
		clearResolvedSourceCache();
		self.postMessage({
			type: "assets-ready",
			version: message.version,
		} satisfies RendererWorkerResponse);
		return;
	}

	if (message.type === "dispose") {
		videoFrameProvider.dispose();
		clearResolvedSourceCache();
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
			if (!ctx) {
				throw new Error("Failed to get worker render context");
			}
		}

		await renderGraphToContext({
			graph: message.graph,
			time: message.time,
			ctx,
			videoFrameProvider,
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
