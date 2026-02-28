import type { TBackground } from "@/types/project";
import type { BlendMode, Transform } from "@/types/rendering";
import type { TextElement } from "@/types/timeline";

export type RenderBackground = TBackground;

interface BaseRenderLayer {
	id: string;
	zIndex: number;
	startTime: number;
	duration: number;
	trimStart: number;
	trimEnd: number;
	hidden: boolean;
}

export interface RenderVideoPayload {
	mediaId: string;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
	muted?: boolean;
}

export interface RenderImagePayload {
	mediaId: string;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
	maxSourceSize?: number;
}

export interface RenderTextPayload extends TextElement {
	canvasCenter: { x: number; y: number };
	canvasHeight: number;
	textBaseline: CanvasTextBaseline;
}

export interface RenderStickerPayload {
	stickerId: string;
	sourceUrl: string;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
}

export type RenderLayer =
	| (BaseRenderLayer & {
			kind: "video";
			payload: RenderVideoPayload;
	  })
	| (BaseRenderLayer & {
			kind: "image";
			payload: RenderImagePayload;
	  })
	| (BaseRenderLayer & {
			kind: "text";
			payload: RenderTextPayload;
	  })
	| (BaseRenderLayer & {
			kind: "sticker";
			payload: RenderStickerPayload;
	  });

export interface RenderGraph {
	duration: number;
	canvas: { width: number; height: number };
	background: RenderBackground;
	layers: RenderLayer[];
}
