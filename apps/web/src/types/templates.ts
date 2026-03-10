import type { CaptionStyleTemplate } from "./clipforge";
import type {
	OverlayMotionPresetId,
	ProjectAudioSettings,
	ProjectBrandKit,
	ProjectOverlayDefaults,
} from "./project";
import type {
	ImageElement,
	StickerElement,
	TextElement,
	TrackType,
} from "./timeline";

export type TemplateKind = "component" | "scene-recipe" | "project-kit";

export type TemplateVisualElement = TextElement | ImageElement | StickerElement;

export interface ProjectMontageDefaults {
	beatDivision: 1 | 2 | 4;
	motionPresetId?: OverlayMotionPresetId | null;
}

export interface TemplateDefaultsPatch {
	captionStyleId?: string | null;
	montageDefaults?: ProjectMontageDefaults | null;
}

export interface ProjectKitPayload {
	brandKit?: ProjectBrandKit | null;
	overlayDefaults?: ProjectOverlayDefaults | null;
	audio?: ProjectAudioSettings | null;
	captionStyle?: CaptionStyleTemplate | null;
	captionStyleId?: string | null;
	montageDefaults?: ProjectMontageDefaults | null;
}

export interface TemplateElementSnapshot {
	trackType: Extract<TrackType, "text" | "video" | "sticker">;
	element: TemplateVisualElement;
}

export interface ComponentTemplatePayload {
	elements: TemplateElementSnapshot[];
	duration: number;
}

export type SceneRecipePresetId =
	| "intro-title"
	| "chapter-break"
	| "location-section"
	| "cta-outro"
	| "vlog-beat-section";

export interface SceneRecipePayload {
	presetId?: SceneRecipePresetId | null;
	elements: TemplateElementSnapshot[];
	duration: number;
	defaults?: TemplateDefaultsPatch | null;
}

interface BaseCreatorTemplate {
	id: string;
	name: string;
	kind: TemplateKind;
	version: 1;
	thumbnailAssetId?: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface ComponentTemplate extends BaseCreatorTemplate {
	kind: "component";
	payload: ComponentTemplatePayload;
}

export interface SceneRecipeTemplate extends BaseCreatorTemplate {
	kind: "scene-recipe";
	payload: SceneRecipePayload;
}

export interface ProjectKitTemplate extends BaseCreatorTemplate {
	kind: "project-kit";
	payload: ProjectKitPayload;
}

export type CreatorTemplate =
	| ComponentTemplate
	| SceneRecipeTemplate
	| ProjectKitTemplate;

export interface SerializedComponentTemplate
	extends Omit<ComponentTemplate, "createdAt" | "updatedAt"> {
	createdAt: string;
	updatedAt: string;
}

export interface SerializedSceneRecipeTemplate
	extends Omit<SceneRecipeTemplate, "createdAt" | "updatedAt"> {
	createdAt: string;
	updatedAt: string;
}

export interface SerializedProjectKitTemplate
	extends Omit<ProjectKitTemplate, "createdAt" | "updatedAt"> {
	createdAt: string;
	updatedAt: string;
}

export type SerializedCreatorTemplate =
	| SerializedComponentTemplate
	| SerializedSceneRecipeTemplate
	| SerializedProjectKitTemplate;
