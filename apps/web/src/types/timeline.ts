import type { BlendMode, Transform } from "./rendering";

export interface Bookmark {
	time: number;
	note?: string;
	color?: string;
	duration?: number;
}

export interface TScene {
	id: string;
	name: string;
	isMain: boolean;
	tracks: TimelineTrack[];
	bookmarks: Bookmark[];
	createdAt: Date;
	updatedAt: Date;
}

export type TrackType = "video" | "text" | "audio" | "sticker";

export type TransitionPreset =
	| "cross-dissolve"
	| "fade-black"
	| "fade-white"
	| "slide";

export interface VisualAdjustments {
	exposure: number;
	contrast: number;
	saturation: number;
	temperature: number;
	tint: number;
	highlights: number;
	shadows: number;
}

export type VisualEffectKind = "blur" | "vignette" | "sharpen";

export type VisualEffect =
	| {
			id: string;
			kind: "blur";
			enabled: boolean;
			radius: number;
	  }
	| {
			id: string;
			kind: "vignette";
			enabled: boolean;
			intensity: number;
	  }
	| {
			id: string;
			kind: "sharpen";
			enabled: boolean;
			amount: number;
	  };

export interface ElementTransitionIn {
	preset: TransitionPreset;
	duration: number;
}

export interface AnimatedPropertyKeyframe {
	time: number;
	value: number;
}

export interface CaptionWordTiming {
	text: string;
	startTime: number;
	endTime: number;
}

export interface VisualKeyframeMap {
	positionX?: AnimatedPropertyKeyframe[];
	positionY?: AnimatedPropertyKeyframe[];
	scale?: AnimatedPropertyKeyframe[];
	rotate?: AnimatedPropertyKeyframe[];
	opacity?: AnimatedPropertyKeyframe[];
}

interface BaseTrack {
	id: string;
	name: string;
}

export interface VideoTrack extends BaseTrack {
	type: "video";
	elements: (VideoElement | ImageElement)[];
	isMain: boolean;
	muted: boolean;
	hidden: boolean;
}

export interface TextTrack extends BaseTrack {
	type: "text";
	elements: TextElement[];
	hidden: boolean;
}

export interface AudioTrack extends BaseTrack {
	type: "audio";
	elements: AudioElement[];
	muted: boolean;
}

export interface StickerTrack extends BaseTrack {
	type: "sticker";
	elements: StickerElement[];
	hidden: boolean;
}

export type TimelineTrack = VideoTrack | TextTrack | AudioTrack | StickerTrack;

export type { Transform } from "./rendering";

interface BaseAudioElement extends BaseTimelineElement {
	type: "audio";
	volume: number;
	muted?: boolean;
	buffer?: AudioBuffer;
	playbackRate?: number;
	fadeInDuration?: number;
	fadeOutDuration?: number;
	linkedGroupId?: string | null;
}

export interface UploadAudioElement extends BaseAudioElement {
	sourceType: "upload";
	mediaId: string;
}

export interface LibraryAudioElement extends BaseAudioElement {
	sourceType: "library";
	sourceUrl: string;
}

export type AudioElement = UploadAudioElement | LibraryAudioElement;

interface BaseTimelineElement {
	id: string;
	name: string;
	duration: number;
	startTime: number;
	trimStart: number;
	trimEnd: number;
}

export interface VideoElement extends BaseTimelineElement {
	type: "video";
	mediaId: string;
	muted?: boolean;
	hidden?: boolean;
	playbackRate?: number;
	linkedGroupId?: string | null;
	transitionIn?: ElementTransitionIn | null;
	keyframes?: VisualKeyframeMap | null;
	adjustments?: VisualAdjustments | null;
	effects?: VisualEffect[] | null;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
}

export interface ImageElement extends BaseTimelineElement {
	type: "image";
	mediaId: string;
	hidden?: boolean;
	linkedGroupId?: string | null;
	transitionIn?: ElementTransitionIn | null;
	keyframes?: VisualKeyframeMap | null;
	adjustments?: VisualAdjustments | null;
	effects?: VisualEffect[] | null;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
}

export interface TextElement extends BaseTimelineElement {
	type: "text";
	role?: "text" | "caption";
	captionTiming?: { words: CaptionWordTiming[] } | null;
	content: string;
	fontSize: number;
	fontFamily: string;
	color: string;
	background: {
		color: string;
		cornerRadius?: number;
		paddingX?: number;
		paddingY?: number;
		offsetX?: number;
		offsetY?: number;
	};
	textAlign: "left" | "center" | "right";
	fontWeight: "normal" | "bold";
	fontStyle: "normal" | "italic";
	textDecoration: "none" | "underline" | "line-through";
	letterSpacing?: number;
	lineHeight?: number;
	hidden?: boolean;
	linkedGroupId?: string | null;
	transitionIn?: ElementTransitionIn | null;
	keyframes?: VisualKeyframeMap | null;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
}

export interface StickerElement extends BaseTimelineElement {
	type: "sticker";
	stickerId: string;
	hidden?: boolean;
	linkedGroupId?: string | null;
	transitionIn?: ElementTransitionIn | null;
	keyframes?: VisualKeyframeMap | null;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
}

export type TimelineElement =
	| AudioElement
	| VideoElement
	| ImageElement
	| TextElement
	| StickerElement;

export type ElementType = TimelineElement["type"];

export type CreateUploadAudioElement = Omit<UploadAudioElement, "id">;
export type CreateLibraryAudioElement = Omit<LibraryAudioElement, "id">;
export type CreateAudioElement =
	| CreateUploadAudioElement
	| CreateLibraryAudioElement;
export type CreateVideoElement = Omit<VideoElement, "id">;
export type CreateImageElement = Omit<ImageElement, "id">;
export type CreateTextElement = Omit<TextElement, "id">;
export type CreateStickerElement = Omit<StickerElement, "id">;
export type CreateTimelineElement =
	| CreateAudioElement
	| CreateVideoElement
	| CreateImageElement
	| CreateTextElement
	| CreateStickerElement;

export interface ElementDragState {
	isDragging: boolean;
	elementId: string | null;
	trackId: string | null;
	startMouseX: number;
	startMouseY: number;
	startElementTime: number;
	clickOffsetTime: number;
	currentTime: number;
	currentMouseY: number;
}

export interface DropTarget {
	trackIndex: number;
	isNewTrack: boolean;
	insertPosition: "above" | "below" | null;
	xPosition: number;
}

export interface ComputeDropTargetParams {
	elementType: ElementType;
	mouseX: number;
	mouseY: number;
	tracks: TimelineTrack[];
	playheadTime: number;
	isExternalDrop: boolean;
	elementDuration: number;
	pixelsPerSecond: number;
	zoomLevel: number;
	verticalDragDirection?: "up" | "down" | null;
	startTimeOverride?: number;
	excludeElementId?: string;
}

export interface ClipboardItem {
	trackId: string;
	trackType: TrackType;
	element: CreateTimelineElement;
}
