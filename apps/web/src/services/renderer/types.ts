import type { TBackground } from "@/types/project";
import type { BlendMode, Transform } from "@/types/rendering";
import type {
	ElementTransitionIn,
	TextElement,
	VisualKeyframeMap,
} from "@/types/timeline";

export type RenderBackground = TBackground;

interface BaseRenderLayer {
	id: string;
	trackId: string;
	zIndex: number;
	startTime: number;
	duration: number;
	trimStart: number;
	trimEnd: number;
	hidden: boolean;
}

export interface RenderVideoPayload {
	mediaId: string;
	playbackRate: number;
	keyframes?: VisualKeyframeMap | null;
	transitionIn?: ElementTransitionIn | null;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
	muted?: boolean;
}

export interface RenderImagePayload {
	mediaId: string;
	keyframes?: VisualKeyframeMap | null;
	transitionIn?: ElementTransitionIn | null;
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
	keyframes?: VisualKeyframeMap | null;
	transitionIn?: ElementTransitionIn | null;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
}

export type RenderLayer =
	| (BaseRenderLayer & {
			kind: "video";
			previousVisualLayerId?: string | null;
			payload: RenderVideoPayload;
	  })
	| (BaseRenderLayer & {
			kind: "image";
			previousVisualLayerId?: string | null;
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

export type PreviewFidelityStatus =
	| "checking"
	| "exact"
	| "approximate"
	| "unsupported";

export type PreviewFidelityIssueCode =
	| "preview-worker-unavailable"
	| "feature-not-supported-by-primary-preview"
	| "preview-used-binary-fallback"
	| "preview-used-legacy-fallback"
	| "export-used-legacy-fallback"
	| "preview-export-parity-mismatch"
	| "parity-check-failed";

export interface PreviewFidelityIssue {
	code: PreviewFidelityIssueCode;
	message: string;
	severity: "warning" | "error";
	time?: number | null;
}

export interface PreviewParitySample {
	time: number;
	previewHash: string;
	exportHash: string;
	match: boolean;
}

export interface PreviewFidelityReport {
	status: PreviewFidelityStatus;
	checkedAt: string;
	graphFingerprint: string;
	previewBackend: "binary-preview" | "binary-canvas" | "legacy-canvas";
	exportBackend: "binary-canvas" | "legacy-canvas" | null;
	issues: PreviewFidelityIssue[];
	samples: PreviewParitySample[];
}
