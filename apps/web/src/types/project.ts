import type { OverlayStyleVariantId, TScene } from "./timeline";
import type {
	AudioPolishPresetId,
	ClipForgeProjectData,
	PolishProfileId,
} from "./clipforge";
import type { ProjectMontageDefaults } from "./templates";

export type TBackground =
	| {
			type: "color";
			color: string;
	  }
	| {
			type: "blur";
			blurIntensity: number;
	  };

export interface TCanvasSize {
	width: number;
	height: number;
}

export interface ProjectAudioSettings {
	masterVolume: number;
	duckingEnabled: boolean;
	duckingAmount: number;
	duckingAttackMs: number;
	duckingReleaseMs: number;
	audioPolishPresetId?: AudioPolishPresetId;
	softLimiterEnabled?: boolean;
}

export interface ProjectBrandKit {
	primaryColor: string;
	secondaryColor: string;
	accentColor: string;
	titleFontFamily: string;
	bodyFontFamily: string;
	logoMediaId?: string | null;
}

export interface ProjectLibraryDefaults {
	captionStyleId: string;
	titlePresetId: string;
	musicMood: "clean" | "luxury" | "upbeat" | "energetic" | "minimal";
}

export type OverlayMotionPresetId =
	| "fade-up"
	| "slide-up"
	| "pop-in"
	| "drift-in"
	| "none";

export type OverlaySafeMarginPreset = "tight" | "standard";

export interface ProjectOverlayDefaults {
	variantId: OverlayStyleVariantId;
	motionPresetId: OverlayMotionPresetId;
	safeMarginPreset?: OverlaySafeMarginPreset;
}

export type ProjectVersionTarget = "9:16" | "1:1" | "16:9";

export interface ProjectVersionTargetConfig {
	id: ProjectVersionTarget;
	enabled: boolean;
	canvasSize: TCanvasSize;
}

export interface ProjectVersionPack {
	targets: ProjectVersionTargetConfig[];
	activeTargetId: ProjectVersionTarget | null;
}

export interface TProjectMetadata {
	id: string;
	name: string;
	thumbnail?: string;
	duration: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface TProjectSettings {
	fps: number;
	canvasSize: TCanvasSize;
	originalCanvasSize?: TCanvasSize | null;
	background: TBackground;
	audio?: ProjectAudioSettings;
	brandKit?: ProjectBrandKit;
	libraryDefaults?: ProjectLibraryDefaults;
	overlayDefaults?: ProjectOverlayDefaults;
	montageDefaults?: ProjectMontageDefaults;
	versionPack?: ProjectVersionPack;
	polishProfileId?: PolishProfileId | null;
}

export interface TTimelineViewState {
	zoomLevel: number;
	scrollLeft: number;
	playheadTime: number;
}

export interface ProjectAssemblyScene {
	sceneId: string;
	name: string;
	projectStartTime: number;
	duration: number;
	projectEndTime: number;
}

export interface TProject {
	metadata: TProjectMetadata;
	scenes: TScene[];
	currentSceneId: string;
	settings: TProjectSettings;
	version: number;
	timelineViewState?: TTimelineViewState;
	clipforge?: ClipForgeProjectData;
}

export type TProjectSortKey = "createdAt" | "updatedAt" | "name" | "duration";
export type TSortOrder = "asc" | "desc";
export type TProjectSortOption = `${TProjectSortKey}-${TSortOrder}`;
