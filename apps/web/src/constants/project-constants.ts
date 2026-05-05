import type {
	ProjectAudioSettings,
	ProjectBrandKit,
	ProjectLibraryDefaults,
	ProjectOverlayDefaults,
	ProjectVersionPack,
	ProjectVersionTarget,
	TCanvasSize,
} from "@/types/project";
import type { ProjectMontageDefaults } from "@/types/templates";

export const DEFAULT_CANVAS_PRESETS: TCanvasSize[] = [
	{ width: 1920, height: 1080 },
	{ width: 1080, height: 1920 },
	{ width: 1080, height: 1080 },
	{ width: 1440, height: 1080 },
];

export const FPS_PRESETS = [
	{ value: "24", label: "24 fps" },
	{ value: "25", label: "25 fps" },
	{ value: "30", label: "30 fps" },
	{ value: "60", label: "60 fps" },
	{ value: "120", label: "120 fps" },
] as const;

export const BLUR_INTENSITY_PRESETS: { label: string; value: number }[] = [
	{ label: "Light", value: 4 },
	{ label: "Medium", value: 8 },
	{ label: "Heavy", value: 18 },
] as const;

export const DEFAULT_CANVAS_SIZE: TCanvasSize = { width: 1920, height: 1080 };
export const DEFAULT_FPS = 30;
export const DEFAULT_BLUR_INTENSITY = 8;
export const DEFAULT_COLOR = "#000000";
export const DEFAULT_PROJECT_AUDIO_SETTINGS: ProjectAudioSettings = {
	masterVolume: 1,
	duckingEnabled: true,
	duckingAmount: 0.45,
	duckingAttackMs: 120,
	duckingReleaseMs: 280,
	audioPolishPresetId: "none",
	softLimiterEnabled: false,
	noiseReductionEnabled: false,
	noiseReductionStrength: 0,
	windReductionEnabled: false,
};

export const DEFAULT_PROJECT_BRAND_KIT: ProjectBrandKit = {
	primaryColor: "#FFFFFF",
	secondaryColor: "#D7D9E0",
	accentColor: "#1EA7FF",
	titleFontFamily: "Archivo Black",
	bodyFontFamily: "DM Sans",
	logoMediaId: null,
};

export const DEFAULT_PROJECT_LIBRARY_DEFAULTS: ProjectLibraryDefaults = {
	captionStyleId: "clean-bottom",
	titlePresetId: "title-clean",
	musicMood: "clean",
};

export const DEFAULT_PROJECT_OVERLAY_DEFAULTS: ProjectOverlayDefaults = {
	variantId: "clean-vlog",
	motionPresetId: "fade-up",
	safeMarginPreset: "standard",
};

export const DEFAULT_PROJECT_MONTAGE_DEFAULTS: ProjectMontageDefaults = {
	beatDivision: 2,
	motionPresetId: "fade-up",
};

export const PROJECT_VERSION_TARGET_ORDER: ProjectVersionTarget[] = [
	"9:16",
	"1:1",
	"16:9",
];

export function getCanvasSizeForVersionTarget({
	baseCanvasSize,
	targetId,
}: {
	baseCanvasSize: TCanvasSize;
	targetId: ProjectVersionTarget;
}): TCanvasSize {
	const shortSide = Math.min(baseCanvasSize.width, baseCanvasSize.height);
	switch (targetId) {
		case "9:16":
			return {
				width: shortSide,
				height: Math.round((shortSide * 16) / 9),
			};
		case "1:1":
			return {
				width: shortSide,
				height: shortSide,
			};
		case "16:9":
			return {
				width: Math.round((shortSide * 16) / 9),
				height: shortSide,
			};
	}
}

export function getVersionTargetLabel({
	targetId,
}: {
	targetId: ProjectVersionTarget;
}): string {
	return targetId;
}

export function detectVersionTargetFromCanvasSize({
	canvasSize,
}: {
	canvasSize: TCanvasSize;
}): ProjectVersionTarget {
	const ratio = canvasSize.width / canvasSize.height;
	if (Math.abs(ratio - 1) <= 0.01) {
		return "1:1";
	}
	return ratio > 1 ? "16:9" : "9:16";
}

export function buildDefaultProjectVersionPack({
	canvasSize,
}: {
	canvasSize: TCanvasSize;
}): ProjectVersionPack {
	const currentTargetId = detectVersionTargetFromCanvasSize({ canvasSize });
	return {
		targets: PROJECT_VERSION_TARGET_ORDER.map((targetId) => ({
			id: targetId,
			enabled: targetId === currentTargetId,
			canvasSize:
				targetId === currentTargetId
					? canvasSize
					: getCanvasSizeForVersionTarget({
							baseCanvasSize: canvasSize,
							targetId,
						}),
		})),
		activeTargetId: currentTargetId,
	};
}
