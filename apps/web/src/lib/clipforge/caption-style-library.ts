import type { CaptionStyleTemplate } from "@/types/clipforge";

export interface BuiltInCaptionStyleDefinition {
	id: string;
	label: string;
	template: CaptionStyleTemplate;
}

export const BUILT_IN_CAPTION_STYLES: BuiltInCaptionStyleDefinition[] = [
	{
		id: "clean-bottom",
		label: "Clean Bottom",
		template: {
			style_id: "clean-bottom",
			font: "DM Sans",
			size: 56,
			position: "bottom",
			outline: false,
			highlight_mode: "none",
			reveal_preset_id: "fade-line",
			sound_sync_preset_id: "caption-pop-clean",
		},
	},
	{
		id: "bold-center",
		label: "Bold Center",
		template: {
			style_id: "bold-center",
			font: "Anton",
			size: 74,
			position: "center",
			outline: true,
			highlight_mode: "line",
			reveal_preset_id: "pop-line",
			sound_sync_preset_id: "caption-pop-bright",
		},
	},
	{
		id: "luxury-bottom",
		label: "Luxury Bottom",
		template: {
			style_id: "luxury-bottom",
			font: "Playfair Display",
			size: 52,
			position: "bottom",
			outline: false,
			highlight_mode: "none",
			reveal_preset_id: "luxury-rise",
			sound_sync_preset_id: "air-fahhh-soft",
		},
	},
	{
		id: "punchy-center",
		label: "Punchy Center",
		template: {
			style_id: "punchy-center",
			font: "Archivo Black",
			size: 70,
			position: "center",
			outline: true,
			highlight_mode: "word",
			reveal_preset_id: "type-on-bold",
			sound_sync_preset_id: "typing-clean",
		},
	},
	{
		id: "reference-word-pop",
		label: "Reference Word Pop",
		template: {
			style_id: "reference-word-pop",
			font: "Anton",
			size: 78,
			position: "bottom",
			outline: true,
			highlight_mode: "word",
			reveal_preset_id: "pop-line",
			sound_sync_preset_id: "caption-pop-bright",
		},
	},
	{
		id: "minimal-bottom",
		label: "Minimal Bottom",
		template: {
			style_id: "minimal-bottom",
			font: "Archivo",
			size: 50,
			position: "bottom",
			outline: false,
			highlight_mode: "line",
			reveal_preset_id: "lift-in",
			sound_sync_preset_id: "caption-pop-clean",
		},
	},
	{
		id: "social-pop",
		label: "Social Pop",
		template: {
			style_id: "social-pop",
			font: "Poppins",
			size: 64,
			position: "center",
			outline: true,
			highlight_mode: "word",
			reveal_preset_id: "type-on-soft",
			sound_sync_preset_id: "typing-soft",
		},
	},
];

export const BUILT_IN_CAPTION_STYLE_MAP: Record<string, CaptionStyleTemplate> =
	Object.fromEntries(
		BUILT_IN_CAPTION_STYLES.map((style) => [style.id, style.template]),
	);

export function getBuiltInCaptionStyleLabel({
	styleId,
}: {
	styleId: string;
}): string {
	return (
		BUILT_IN_CAPTION_STYLES.find((style) => style.id === styleId)?.label ??
		styleId
	);
}
