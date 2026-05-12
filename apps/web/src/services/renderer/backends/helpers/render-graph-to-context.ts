import type { RenderGraph } from "@/services/renderer/types";
import type { RenderVideoFrameProvider } from "@/services/renderer/video-frame-provider";
import {
	getEffectiveVisualStateAtTime,
	getPreviousTransitionSampleTime,
	getTransitionProgress,
	transitionIsActiveAtTime,
	type VisualElement,
} from "@/lib/timeline";
import { clearRenderSurface, drawBlurBackground } from "./render-background";
import { renderTextLayer } from "./render-text-layer";
import { renderVideoLayer } from "./render-video-layer";
import { renderFinishedVisualLayer } from "@/services/renderer/visual-finishing";

type ResolvedImageLayer = {
	id: string;
	trackId: string;
	zIndex: number;
	kind: "image" | "sticker";
	startTime: number;
	duration: number;
	trimStart: number;
	trimEnd: number;
	hidden: boolean;
	payload: {
		sourceUrl: string;
		transform: {
			scale: number;
			position: { x: number; y: number };
			rotate: number;
		};
		adjustments?: import("@/types/timeline").VisualAdjustments | null;
		effects?: import("@/types/timeline").VisualEffect[] | null;
		opacity: number;
		blendMode?: string;
		maxSourceSize?: number;
		keyframes?: unknown;
		transitionIn?: {
			preset: "cross-dissolve" | "fade-black" | "fade-white" | "slide";
			duration: number;
		} | null;
	};
	previousVisualLayerId?: string | null;
};

type ResolvedTextLayer = Extract<
	RenderGraph["layers"][number],
	{ kind: "text" }
>;

type ResolvedVideoLayer = Extract<
	RenderGraph["layers"][number],
	{ kind: "video" }
> & {
	payload: Extract<
		RenderGraph["layers"][number],
		{ kind: "video" }
	>["payload"] & {
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
	const layersById = new Map(layers.map((layer) => [layer.id, layer]));

	for (const layer of layers) {
		if (layer.kind === "text") {
			if (!isLayerVisibleAtTime({ layer, time })) continue;
			const animatedState = sampleTextAnimatedState({ layer, time });
			renderTextLayer({
				ctx,
				payload: {
					...layer.payload,
					transform: animatedState.transform,
					opacity: animatedState.opacity,
				},
				time,
			});
			continue;
		}

		const previousLayer = layer.previousVisualLayerId
			? layersById.get(layer.previousVisualLayerId)
			: null;
		if (
			(layer.kind === "video" || layer.kind === "image") &&
			previousLayer &&
			(previousLayer.kind === "video" || previousLayer.kind === "image") &&
			isTransitionRenderable({ current: layer, previous: previousLayer, time })
		) {
			await renderTransitionPair({
				ctx,
				current: layer,
				previous: previousLayer,
				time,
				canvasWidth: width,
				canvasHeight: height,
				videoFrameProvider,
			});
			continue;
		}

		if (!isLayerVisibleAtTime({ layer, time })) {
			continue;
		}

		if (layer.kind === "video") {
			await renderVideoVisualLayer({
				ctx,
				layer,
				time,
				canvasWidth: width,
				canvasHeight: height,
				videoFrameProvider,
			});
			continue;
		}

		await renderImageLikeLayer({
			ctx,
			layer,
			time,
			canvasWidth: width,
			canvasHeight: height,
		});
	}
}

function isLayerVisibleAtTime({
	layer,
	time,
}: {
	layer: Pick<ResolvedRenderGraph["layers"][number], "startTime" | "duration">;
	time: number;
}): boolean {
	return time >= layer.startTime && time < layer.startTime + layer.duration;
}

function sampleAnimatedVisualState({
	layer,
	time,
}: {
	layer: Pick<
		VisualElement,
		"type" | "startTime" | "duration" | "transform" | "opacity" | "keyframes"
	>;
	time: number;
}) {
	return getEffectiveVisualStateAtTime({
		element: layer as VisualElement,
		time,
	});
}

function toVisualMotionElement({
	layer,
}: {
	layer: ResolvedVideoLayer | ResolvedImageLayer;
}): VisualElement {
	if (layer.kind === "video") {
		return {
			id: layer.id,
			type: "video",
			name: layer.id,
			mediaId: layer.payload.mediaId,
			startTime: layer.startTime,
			duration: layer.duration,
			trimStart: layer.trimStart,
			trimEnd: layer.trimEnd,
			fit: layer.payload.fit,
			muted: layer.payload.muted,
			hidden: layer.hidden,
			playbackRate: layer.payload.playbackRate,
			linkedGroupId: null,
			transitionIn: layer.payload.transitionIn ?? null,
			keyframes: layer.payload.keyframes ?? null,
			adjustments: layer.payload.adjustments ?? null,
			effects: layer.payload.effects ?? null,
			transform: layer.payload.transform,
			opacity: layer.payload.opacity,
			blendMode: layer.payload.blendMode,
		};
	}

	if (layer.kind === "image") {
		return {
			id: layer.id,
			type: "image",
			name: layer.id,
			mediaId: layer.payload.sourceUrl,
			startTime: layer.startTime,
			duration: layer.duration,
			trimStart: layer.trimStart,
			trimEnd: layer.trimEnd,
			hidden: layer.hidden,
			linkedGroupId: null,
			transitionIn: layer.payload.transitionIn ?? null,
			keyframes:
				(layer.payload.keyframes as VisualElement["keyframes"]) ?? null,
			adjustments: layer.payload.adjustments ?? null,
			effects: layer.payload.effects ?? null,
			transform: layer.payload.transform,
			opacity: layer.payload.opacity,
			blendMode: layer.payload.blendMode as VisualElement["blendMode"],
		};
	}

	return {
		id: layer.id,
		type: "sticker",
		name: layer.id,
		stickerId: layer.id,
		startTime: layer.startTime,
		duration: layer.duration,
		trimStart: layer.trimStart,
		trimEnd: layer.trimEnd,
		hidden: layer.hidden,
		linkedGroupId: null,
		transitionIn: layer.payload.transitionIn ?? null,
		keyframes: (layer.payload.keyframes as VisualElement["keyframes"]) ?? null,
		transform: layer.payload.transform,
		opacity: layer.payload.opacity,
		blendMode: layer.payload.blendMode as VisualElement["blendMode"],
	};
}

function sampleTextAnimatedState({
	layer,
	time,
}: {
	layer: ResolvedTextLayer;
	time: number;
}) {
	return sampleAnimatedVisualState({
		layer: {
			type: "text",
			startTime: layer.startTime,
			duration: layer.duration,
			transform: layer.payload.transform,
			opacity: layer.payload.opacity,
			keyframes: layer.payload.keyframes ?? null,
		},
		time,
	});
}

function isTransitionRenderable({
	current,
	previous,
	time,
}: {
	current: ResolvedVideoLayer | ResolvedImageLayer;
	previous: ResolvedVideoLayer | ResolvedImageLayer;
	time: number;
}): boolean {
	if (!current.payload.transitionIn) return false;
	const previousEnd = previous.startTime + previous.duration;
	if (Math.abs(previousEnd - current.startTime) > 0.001) {
		return false;
	}
	return transitionIsActiveAtTime({
		element: {
			startTime: current.startTime,
			transitionIn: current.payload.transitionIn,
		},
		time,
	});
}

async function renderTransitionPair({
	ctx,
	current,
	previous,
	time,
	canvasWidth,
	canvasHeight,
	videoFrameProvider,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	current: ResolvedVideoLayer | ResolvedImageLayer;
	previous: ResolvedVideoLayer | ResolvedImageLayer;
	time: number;
	canvasWidth: number;
	canvasHeight: number;
	videoFrameProvider: RenderVideoFrameProvider;
}): Promise<void> {
	const transition = current.payload.transitionIn;
	if (!transition) return;

	const progress = getTransitionProgress({
		element: { startTime: current.startTime, transitionIn: transition },
		time,
	});
	const previousSampleTime = getPreviousTransitionSampleTime({
		previous,
		current: { startTime: current.startTime, transitionIn: transition },
		time,
	});
	const currentState = sampleAnimatedVisualState({
		layer: toVisualMotionElement({ layer: current }),
		time,
	});
	const previousState = sampleAnimatedVisualState({
		layer: toVisualMotionElement({ layer: previous }),
		time: previousSampleTime,
	});

	if (transition.preset === "cross-dissolve") {
		await renderTransitionLayerWithState({
			ctx,
			layer: previous,
			time: previousSampleTime,
			canvasWidth,
			canvasHeight,
			videoFrameProvider,
			transform: previousState.transform,
			opacity: previousState.opacity * (1 - progress),
		});
		await renderTransitionLayerWithState({
			ctx,
			layer: current,
			time,
			canvasWidth,
			canvasHeight,
			videoFrameProvider,
			transform: currentState.transform,
			opacity: currentState.opacity * progress,
		});
		return;
	}

	if (transition.preset === "slide") {
		const offset = canvasWidth * 0.18;
		await renderTransitionLayerWithState({
			ctx,
			layer: previous,
			time: previousSampleTime,
			canvasWidth,
			canvasHeight,
			videoFrameProvider,
			transform: {
				...previousState.transform,
				position: {
					x: previousState.transform.position.x - offset * progress,
					y: previousState.transform.position.y,
				},
			},
			opacity: previousState.opacity * (1 - progress),
		});
		await renderTransitionLayerWithState({
			ctx,
			layer: current,
			time,
			canvasWidth,
			canvasHeight,
			videoFrameProvider,
			transform: {
				...currentState.transform,
				position: {
					x: currentState.transform.position.x + offset * (1 - progress),
					y: currentState.transform.position.y,
				},
			},
			opacity: currentState.opacity * progress,
		});
		return;
	}

	const midpoint = progress < 0.5;
	if (midpoint) {
		await renderTransitionLayerWithState({
			ctx,
			layer: previous,
			time: previousSampleTime,
			canvasWidth,
			canvasHeight,
			videoFrameProvider,
			transform: previousState.transform,
			opacity: previousState.opacity,
		});
	} else {
		await renderTransitionLayerWithState({
			ctx,
			layer: current,
			time,
			canvasWidth,
			canvasHeight,
			videoFrameProvider,
			transform: currentState.transform,
			opacity: currentState.opacity,
		});
	}

	const overlayAlpha = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
	ctx.save();
	ctx.globalAlpha = overlayAlpha;
	ctx.fillStyle = transition.preset === "fade-white" ? "#FFFFFF" : "#000000";
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
	ctx.restore();
}

async function renderTransitionLayerWithState({
	ctx,
	layer,
	time,
	canvasWidth,
	canvasHeight,
	videoFrameProvider,
	transform,
	opacity,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	layer: ResolvedVideoLayer | ResolvedImageLayer;
	time: number;
	canvasWidth: number;
	canvasHeight: number;
	videoFrameProvider: RenderVideoFrameProvider;
	transform: {
		scale: number;
		position: { x: number; y: number };
		rotate: number;
	};
	opacity: number;
}): Promise<void> {
	if (layer.kind === "video") {
		await renderVideoVisualLayer({
			ctx,
			layer,
			time,
			canvasWidth,
			canvasHeight,
			videoFrameProvider,
			transformOverride: transform,
			opacityOverride: opacity,
			sampleTimeOverride: time,
		});
		return;
	}

	await renderImageLikeLayer({
		ctx,
		layer,
		time,
		canvasWidth,
		canvasHeight,
		transformOverride: transform,
		opacityOverride: opacity,
	});
}

async function renderVideoVisualLayer({
	ctx,
	layer,
	time,
	canvasWidth,
	canvasHeight,
	videoFrameProvider,
	transformOverride,
	opacityOverride,
	sampleTimeOverride,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	layer: ResolvedVideoLayer;
	time: number;
	canvasWidth: number;
	canvasHeight: number;
	videoFrameProvider: RenderVideoFrameProvider;
	transformOverride?: {
		scale: number;
		position: { x: number; y: number };
		rotate: number;
	};
	opacityOverride?: number;
	sampleTimeOverride?: number;
}): Promise<void> {
	const state = sampleAnimatedVisualState({
		layer: toVisualMotionElement({ layer }),
		time,
	});
	await renderVideoLayer({
		ctx,
		layer,
		time,
		canvasWidth,
		canvasHeight,
		videoFrameProvider,
		transformOverride: transformOverride ?? state.transform,
		opacityOverride: opacityOverride ?? state.opacity,
		sampleTimeOverride,
	});
}

async function renderImageLikeLayer({
	ctx,
	layer,
	time,
	canvasWidth,
	canvasHeight,
	transformOverride,
	opacityOverride,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	layer: ResolvedImageLayer;
	time: number;
	canvasWidth: number;
	canvasHeight: number;
	transformOverride?: {
		scale: number;
		position: { x: number; y: number };
		rotate: number;
	};
	opacityOverride?: number;
}): Promise<void> {
	const source = await loadResolvedSource({
		url: layer.payload.sourceUrl,
		maxSourceSize: layer.payload.maxSourceSize,
	});
	const state = sampleAnimatedVisualState({
		layer: {
			type: layer.kind === "image" ? "image" : "sticker",
			startTime: layer.startTime,
			duration: layer.duration,
			transform: layer.payload.transform,
			opacity: layer.payload.opacity,
			keyframes:
				(layer.payload.keyframes as VisualElement["keyframes"]) ?? null,
		} as VisualElement,
		time,
	});
	const transform = transformOverride ?? state.transform;
	const opacity = opacityOverride ?? state.opacity;
	if (opacity <= 0) return;
	const sourceWidth =
		("width" in source.source && typeof source.source.width === "number"
			? source.source.width
			: source.width) || source.width;
	const sourceHeight =
		("height" in source.source && typeof source.source.height === "number"
			? source.source.height
			: source.height) || source.height;
	renderFinishedVisualLayer({
		ctx,
		canvasWidth,
		canvasHeight,
		source: source.source,
		sourceWidth,
		sourceHeight,
		transform,
		opacity,
		blendMode: (layer.payload.blendMode as never) ?? undefined,
		adjustments: layer.payload.adjustments ?? null,
		effects: layer.payload.effects ?? null,
	});
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
		if (
			typeof fetch === "undefined" ||
			typeof createImageBitmap === "undefined"
		) {
			throw new Error(
				"Binary image rendering is unavailable in this environment",
			);
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
