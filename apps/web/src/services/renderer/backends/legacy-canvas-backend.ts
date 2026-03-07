import { BlurBackgroundNode } from "@/services/renderer/nodes/blur-background-node";
import { ColorNode } from "@/services/renderer/nodes/color-node";
import { ImageNode } from "@/services/renderer/nodes/image-node";
import { RootNode } from "@/services/renderer/nodes/root-node";
import { StickerNode } from "@/services/renderer/nodes/sticker-node";
import { TextNode } from "@/services/renderer/nodes/text-node";
import { VideoNode } from "@/services/renderer/nodes/video-node";
import { CanvasRenderer } from "@/services/renderer/canvas-renderer";
import type { RenderAssetRegistry } from "@/services/renderer/render-asset-registry";
import type { RenderGraph } from "@/services/renderer/types";
import type {
	RenderBackend,
	RenderBackendDiagnostics,
	RenderFrameRequest,
	RenderedFrame,
} from "./types";

export class LegacyCanvasBackend implements RenderBackend {
	private renderer: CanvasRenderer | null = null;
	private readonly diagnostics: RenderBackendDiagnostics = {
		backendKind: "legacy-canvas",
		usedBinaryFallback: false,
		usedLegacyFallback: false,
		unsupportedFeatures: [],
	};

	constructor(private readonly assetRegistry: RenderAssetRegistry) {}

	async renderFrame(request: RenderFrameRequest): Promise<RenderedFrame> {
		const { graph, time } = request;
		if (
			!this.renderer ||
			this.renderer.width !== graph.canvas.width ||
			this.renderer.height !== graph.canvas.height
		) {
			this.renderer = new CanvasRenderer({
				width: graph.canvas.width,
				height: graph.canvas.height,
				fps: 30,
			});
		}

		const rootNode = buildRootNodeFromGraph({
			graph,
			assetRegistry: this.assetRegistry,
		});
		await this.renderer.render({ node: rootNode, time });

		return {
			kind: "canvas",
			canvas: this.renderer.canvas,
			width: graph.canvas.width,
			height: graph.canvas.height,
		};
	}

	dispose(): void {}

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
}

function buildRootNodeFromGraph({
	graph,
	assetRegistry,
}: {
	graph: RenderGraph;
	assetRegistry: RenderAssetRegistry;
}): RootNode {
	const rootNode = new RootNode({ duration: graph.duration });
	const contentNodes: Array<
		VideoNode | ImageNode | TextNode | StickerNode
	> = [];

	for (const layer of graph.layers.slice().sort((a, b) => a.zIndex - b.zIndex)) {
		if (layer.hidden) continue;
		if (layer.kind === "video") {
			const asset = assetRegistry.getAsset(layer.payload.mediaId);
			if (!asset?.url || asset.type !== "video") continue;
			contentNodes.push(
				new VideoNode({
					mediaId: asset.id,
					url: asset.url,
					file: asset.file,
					duration: layer.duration,
					timeOffset: layer.startTime,
					trimStart: layer.trimStart,
					trimEnd: layer.trimEnd,
					transform: layer.payload.transform,
					opacity: layer.payload.opacity,
					blendMode: layer.payload.blendMode,
				}),
			);
			continue;
		}

		if (layer.kind === "image") {
			const asset = assetRegistry.getAsset(layer.payload.mediaId);
			if (!asset?.url || asset.type !== "image") continue;
			contentNodes.push(
				new ImageNode({
					url: asset.url,
					duration: layer.duration,
					timeOffset: layer.startTime,
					trimStart: layer.trimStart,
					trimEnd: layer.trimEnd,
					transform: layer.payload.transform,
					opacity: layer.payload.opacity,
					blendMode: layer.payload.blendMode,
					maxSourceSize: layer.payload.maxSourceSize,
				}),
			);
			continue;
		}

		if (layer.kind === "text") {
			contentNodes.push(new TextNode(layer.payload));
			continue;
		}

		contentNodes.push(
			new StickerNode({
				stickerId: layer.payload.stickerId,
				duration: layer.duration,
				timeOffset: layer.startTime,
				trimStart: layer.trimStart,
				trimEnd: layer.trimEnd,
				transform: layer.payload.transform,
				opacity: layer.payload.opacity,
				blendMode: layer.payload.blendMode,
			}),
		);
	}

	if (graph.background.type === "blur") {
		rootNode.add(
			new BlurBackgroundNode({
				blurIntensity: graph.background.blurIntensity,
				contentNodes,
			}),
		);
		for (const node of contentNodes) {
			rootNode.add(node);
		}
		return rootNode;
	}

	if (graph.background.type === "color" && graph.background.color !== "transparent") {
		rootNode.add(new ColorNode({ color: graph.background.color }));
	}
	for (const node of contentNodes) {
		rootNode.add(node);
	}
	return rootNode;
}
