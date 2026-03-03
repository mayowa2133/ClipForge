import type {
	AddTextOverlayOp,
	OverlayTextPosition,
	TextOverlayStyleId,
} from "@/types/clipforge";

type TextOverlayPreset = Pick<
	AddTextOverlayOp,
	"style_id" | "position" | "font" | "size" | "color" | "outline" | "background"
>;

const OVERLAY_PRESETS: Record<TextOverlayStyleId, TextOverlayPreset> = {
	"clean-bottom": {
		style_id: "clean-bottom",
		position: "bottom",
		font: "Arial",
		size: 56,
		color: "#FFFFFF",
		outline: false,
		background: false,
	},
	"bold-center": {
		style_id: "bold-center",
		position: "center",
		font: "Arial",
		size: 74,
		color: "#FFFFFF",
		outline: true,
		background: false,
	},
	"overlay-top": {
		style_id: "overlay-top",
		position: "top",
		font: "Arial",
		size: 64,
		color: "#FFFFFF",
		outline: true,
		background: false,
	},
	"overlay-center": {
		style_id: "overlay-center",
		position: "center",
		font: "Arial",
		size: 72,
		color: "#FFFFFF",
		outline: true,
		background: false,
	},
};

export function getTextOverlayPresetForPosition({
	position,
}: {
	position: OverlayTextPosition;
}): TextOverlayPreset {
	if (position === "bottom") {
		return OVERLAY_PRESETS["clean-bottom"];
	}
	if (position === "center") {
		return OVERLAY_PRESETS["overlay-center"];
	}
	return OVERLAY_PRESETS["overlay-top"];
}

export function getTextOverlayPresetById({
	styleId,
}: {
	styleId: TextOverlayStyleId;
}): TextOverlayPreset {
	return OVERLAY_PRESETS[styleId];
}
