import {
	DEFAULT_PROJECT_BRAND_KIT,
	DEFAULT_PROJECT_OVERLAY_DEFAULTS,
} from "@/constants/project-constants";
import { DEFAULT_TEXT_ELEMENT } from "@/constants/text-constants";
import type {
	OverlayMotionPresetId,
	OverlaySafeMarginPreset,
	ProjectBrandKit,
	ProjectOverlayDefaults,
	TProject,
} from "@/types/project";
import type {
	ImageElement,
	OverlayMeta,
	OverlayStyleVariantId,
	OverlayTextSlot,
	SocialOverlayPresetId,
	StickerElement,
	TextElement,
	VisualKeyframeMap,
} from "@/types/timeline";
import type { CreateImageElement, CreateTextElement } from "@/types/timeline";
import { clamp } from "@/utils/math";
import { buildImageElement, buildTextElement } from "./element-utils";
import {
	setPropertyKeyframeValue,
	type AnimatableVisualProperty,
	type VisualElement,
} from "./motion";

export type GraphicsPresetId =
	| "title-clean"
	| "title-bold"
	| "lower-third-clean"
	| "lower-third-brand"
	| "cta-subscribe"
	| "cta-follow"
	| "quote-card";

export type GraphicsMotionPresetId = OverlayMotionPresetId;

export interface GraphicsPreset {
	id: GraphicsPresetId;
	label: string;
	description: string;
	kind: "title" | "lower-third" | "cta" | "quote";
	defaultDuration: number;
	buildElements: (args: BuildGraphicsPresetArgs) => Array<CreateTextElement | CreateImageElement>;
}

export interface SocialOverlayPreset {
	id: SocialOverlayPresetId;
	label: string;
	description: string;
	defaultDuration: number;
	buildElements: (args: BuildSocialOverlayPresetArgs) => Array<CreateTextElement | CreateImageElement>;
}

interface BuildGraphicsPresetArgs {
	startTime: number;
	duration: number;
	brandKit: ProjectBrandKit;
	logoAsset?: { id: string; name: string } | null;
}

interface BuildSocialOverlayPresetArgs {
	startTime: number;
	duration: number;
	brandKit: ProjectBrandKit;
	variantId: OverlayStyleVariantId;
	safeMarginPreset: OverlaySafeMarginPreset;
	values?: Partial<Record<OverlayTextSlot, string>>;
}

interface OverlaySlotStyle {
	fontFamily: string;
	fontSize: number;
	color: string;
	fontWeight?: TextElement["fontWeight"];
	fontStyle?: TextElement["fontStyle"];
	textAlign?: TextElement["textAlign"];
	background?: TextElement["background"];
	position: { x: number; y: number };
	opacity?: number;
	lineHeight?: number;
}

interface OverlayVariantDefinition {
	primaryColor: string;
	secondaryColor: string;
	accentColor: string;
	titleFontFamily: string;
	bodyFontFamily: string;
}

const TITLE_Y = -0.18;
const SUBTITLE_Y = 0.02;
const LOWER_THIRD_Y = 0.34;
const CTA_Y = 0.34;
const STANDARD_LEFT = -0.34;
const TIGHT_LEFT = -0.42;

const DEFAULT_OVERLAY_VALUES: Record<SocialOverlayPresetId, Partial<Record<OverlayTextSlot, string>>> = {
	"timestamp-card": {
		time: "7:20 am",
		label: "Get loose",
	},
	"routine-label": {
		label: "Morning workout",
	},
	"location-tag": {
		primary: "Brooklyn, NY",
		secondary: "Friday",
	},
	"chapter-card": {
		primary: "Afternoon run",
		secondary: "Court session",
	},
	"stat-card": {
		primary: "10K",
		label: "Steps before lunch",
	},
	"quote-card-social": {
		primary: '"Build the habit first."',
		secondary: "Coach note",
	},
};

function createText({
	startTime,
	duration,
	content,
	name,
	fontFamily,
	fontSize,
	color,
	fontWeight = "normal",
	fontStyle = "normal",
	textAlign = "center",
	background,
	position,
	opacity = 1,
	lineHeight,
	overlayMeta,
}: {
	startTime: number;
	duration: number;
	content: string;
	name: string;
	fontFamily: string;
	fontSize: number;
	color: string;
	fontWeight?: TextElement["fontWeight"];
	fontStyle?: TextElement["fontStyle"];
	textAlign?: TextElement["textAlign"];
	background?: TextElement["background"];
	position: { x: number; y: number };
	opacity?: number;
	lineHeight?: number;
	overlayMeta?: OverlayMeta | null;
}): CreateTextElement {
	return buildTextElement({
		startTime,
		raw: {
			name,
			content,
			duration,
			fontFamily,
			fontSize,
			color,
			fontWeight,
			fontStyle,
			textAlign,
			background,
			lineHeight,
			opacity,
			overlayMeta: overlayMeta ?? null,
			transform: {
				...DEFAULT_TEXT_ELEMENT.transform,
				position,
			},
		},
	}) as CreateTextElement;
}

function maybeCreateLogoElement({
	logoAsset,
	startTime,
	duration,
}: {
	logoAsset?: { id: string; name: string } | null;
	startTime: number;
	duration: number;
}): CreateImageElement[] {
	if (!logoAsset) {
		return [];
	}
	return [
		buildImageElement({
			mediaId: logoAsset.id,
			name: `${logoAsset.name} Logo`,
			duration,
			startTime,
		}),
	].map((element) => ({
		...element,
		transform: {
			...element.transform,
			scale: 0.18,
			position: { x: -0.58, y: LOWER_THIRD_Y },
		},
		opacity: 0.96,
	}));
}

export const GRAPHICS_PRESETS: GraphicsPreset[] = [
	{
		id: "title-clean",
		label: "Clean title",
		description: "Centered headline with a light subtitle.",
		kind: "title",
		defaultDuration: 3,
		buildElements: ({ startTime, duration, brandKit }) => [
			createText({
				startTime,
				duration,
				name: "Title",
				content: "Main title",
				fontFamily: brandKit.titleFontFamily,
				fontSize: 6.8,
				fontWeight: "bold",
				color: brandKit.primaryColor,
				position: { x: 0, y: TITLE_Y },
			}),
			createText({
				startTime,
				duration,
				name: "Subtitle",
				content: "Add a short supporting line",
				fontFamily: brandKit.bodyFontFamily,
				fontSize: 3.2,
				color: brandKit.secondaryColor,
				position: { x: 0, y: SUBTITLE_Y + 0.03 },
			}),
		],
	},
	{
		id: "title-bold",
		label: "Bold title",
		description: "Big branded title with a solid background plate.",
		kind: "title",
		defaultDuration: 3,
		buildElements: ({ startTime, duration, brandKit }) => [
			createText({
				startTime,
				duration,
				name: "Bold title",
				content: "Bold statement",
				fontFamily: brandKit.titleFontFamily,
				fontSize: 7.6,
				fontWeight: "bold",
				color: "#ffffff",
				background: {
					color: brandKit.accentColor,
					cornerRadius: 20,
					paddingX: 34,
					paddingY: 24,
				},
				position: { x: 0, y: -0.08 },
			}),
		],
	},
	{
		id: "lower-third-clean",
		label: "Clean lower third",
		description: "Simple name and subtitle anchored to the lower left.",
		kind: "lower-third",
		defaultDuration: 2.5,
		buildElements: ({ startTime, duration, brandKit }) => [
			createText({
				startTime,
				duration,
				name: "Name",
				content: "Name Surname",
				fontFamily: brandKit.titleFontFamily,
				fontSize: 5.2,
				fontWeight: "bold",
				color: brandKit.primaryColor,
				textAlign: "left",
				position: { x: -0.28, y: LOWER_THIRD_Y },
			}),
			createText({
				startTime,
				duration,
				name: "Role",
				content: "Role or description",
				fontFamily: brandKit.bodyFontFamily,
				fontSize: 3.6,
				color: brandKit.primaryColor,
				textAlign: "left",
				position: { x: -0.28, y: LOWER_THIRD_Y + 0.11 },
				opacity: 0.8,
			}),
		],
	},
	{
		id: "lower-third-brand",
		label: "Brand lower third",
		description: "Branded lower third with accent plate and optional logo.",
		kind: "lower-third",
		defaultDuration: 2.5,
		buildElements: ({ startTime, duration, brandKit, logoAsset }) => [
			...maybeCreateLogoElement({ logoAsset, startTime, duration }),
			createText({
				startTime,
				duration,
				name: "Brand name",
				content: "Speaker name",
				fontFamily: brandKit.titleFontFamily,
				fontSize: 5,
				fontWeight: "bold",
				color: "#ffffff",
				textAlign: "left",
				background: {
					color: brandKit.accentColor,
					cornerRadius: 18,
					paddingX: 22,
					paddingY: 16,
				},
				position: { x: logoAsset ? -0.14 : -0.26, y: LOWER_THIRD_Y },
			}),
			createText({
				startTime,
				duration,
				name: "Brand subtitle",
				content: "Add title or company",
				fontFamily: brandKit.bodyFontFamily,
				fontSize: 3.2,
				color: brandKit.primaryColor,
				textAlign: "left",
				position: { x: logoAsset ? -0.14 : -0.26, y: LOWER_THIRD_Y + 0.105 },
				opacity: 0.78,
			}),
		],
	},
	{
		id: "cta-subscribe",
		label: "Subscribe CTA",
		description: "Short subscribe prompt with branded pill styling.",
		kind: "cta",
		defaultDuration: 2.5,
		buildElements: ({ startTime, duration, brandKit }) => [
			createText({
				startTime,
				duration,
				name: "Subscribe CTA",
				content: "Subscribe for more",
				fontFamily: brandKit.titleFontFamily,
				fontSize: 4.6,
				fontWeight: "bold",
				color: "#ffffff",
				background: {
					color: brandKit.accentColor,
					cornerRadius: 999,
					paddingX: 30,
					paddingY: 18,
				},
				position: { x: 0, y: CTA_Y },
			}),
		],
	},
	{
		id: "cta-follow",
		label: "Follow CTA",
		description: "Social follow callout with softer framing.",
		kind: "cta",
		defaultDuration: 2.5,
		buildElements: ({ startTime, duration, brandKit }) => [
			createText({
				startTime,
				duration,
				name: "Follow CTA",
				content: "Follow for daily edits",
				fontFamily: brandKit.bodyFontFamily,
				fontSize: 4.2,
				fontWeight: "bold",
				color: brandKit.primaryColor,
				background: {
					color: brandKit.secondaryColor,
					cornerRadius: 20,
					paddingX: 28,
					paddingY: 18,
				},
				position: { x: 0, y: CTA_Y },
			}),
		],
	},
	{
		id: "quote-card",
		label: "Quote card",
		description: "Centered quote block with a soft card background.",
		kind: "quote",
		defaultDuration: 3,
		buildElements: ({ startTime, duration, brandKit }) => [
			createText({
				startTime,
				duration,
				name: "Quote",
				content: '"Add a short quote here"',
				fontFamily: brandKit.bodyFontFamily,
				fontSize: 5,
				fontStyle: "italic",
				color: brandKit.primaryColor,
				background: {
					color: `${brandKit.secondaryColor}CC`,
					cornerRadius: 28,
					paddingX: 38,
					paddingY: 26,
				},
				position: { x: 0, y: -0.02 },
				lineHeight: 1.3,
			}),
		],
	},
];

export const SOCIAL_OVERLAY_PRESETS: SocialOverlayPreset[] = [
	{
		id: "timestamp-card",
		label: "Timestamp",
		description: "Time on top with the routine label underneath.",
		defaultDuration: 2,
		buildElements: ({ startTime, duration, brandKit, variantId, safeMarginPreset, values }) => {
			const offsetX = getLeftMargin({ safeMarginPreset });
			return [
				createOverlayText({
					startTime,
					duration,
					brandKit,
					variantId,
					kind: "timestamp-card",
					slot: "time",
					content: values?.time ?? DEFAULT_OVERLAY_VALUES["timestamp-card"].time ?? "7:20 am",
					name: "Timestamp",
					style: buildOverlaySlotStyle({
						kind: "timestamp-card",
						slot: "time",
						variantId,
						brandKit,
						position: { x: offsetX, y: 0.32 },
					}),
				}),
				createOverlayText({
					startTime,
					duration,
					brandKit,
					variantId,
					kind: "timestamp-card",
					slot: "label",
					content: values?.label ?? DEFAULT_OVERLAY_VALUES["timestamp-card"].label ?? "Get loose",
					name: "Label",
					style: buildOverlaySlotStyle({
						kind: "timestamp-card",
						slot: "label",
						variantId,
						brandKit,
						position: { x: offsetX, y: 0.41 },
					}),
				}),
			];
		},
	},
	{
		id: "routine-label",
		label: "Routine",
		description: "Single pill label for habits, errands, or moments.",
		defaultDuration: 2,
		buildElements: ({ startTime, duration, brandKit, variantId, safeMarginPreset, values }) => [
			createOverlayText({
				startTime,
				duration,
				brandKit,
				variantId,
				kind: "routine-label",
				slot: "label",
				content: values?.label ?? DEFAULT_OVERLAY_VALUES["routine-label"].label ?? "Morning workout",
				name: "Routine",
				style: buildOverlaySlotStyle({
					kind: "routine-label",
					slot: "label",
					variantId,
					brandKit,
					position: { x: getLeftMargin({ safeMarginPreset }), y: 0.36 },
				}),
			}),
		],
	},
	{
		id: "location-tag",
		label: "Location",
		description: "Place name with an optional context line.",
		defaultDuration: 2,
		buildElements: ({ startTime, duration, brandKit, variantId, safeMarginPreset, values }) => {
			const offsetX = getLeftMargin({ safeMarginPreset });
			return [
				createOverlayText({
					startTime,
					duration,
					brandKit,
					variantId,
					kind: "location-tag",
					slot: "primary",
					content: values?.primary ?? DEFAULT_OVERLAY_VALUES["location-tag"].primary ?? "Brooklyn, NY",
					name: "Location",
					style: buildOverlaySlotStyle({
						kind: "location-tag",
						slot: "primary",
						variantId,
						brandKit,
						position: { x: offsetX, y: 0.18 },
					}),
				}),
				createOverlayText({
					startTime,
					duration,
					brandKit,
					variantId,
					kind: "location-tag",
					slot: "secondary",
					content: values?.secondary ?? DEFAULT_OVERLAY_VALUES["location-tag"].secondary ?? "Friday",
					name: "Location context",
					style: buildOverlaySlotStyle({
						kind: "location-tag",
						slot: "secondary",
						variantId,
						brandKit,
						position: { x: offsetX, y: 0.255 },
					}),
				}),
			];
		},
	},
	{
		id: "chapter-card",
		label: "Chapter",
		description: "Scene section card with headline and subline.",
		defaultDuration: 3,
		buildElements: ({ startTime, duration, brandKit, variantId, values }) => [
			createOverlayText({
				startTime,
				duration,
				brandKit,
				variantId,
				kind: "chapter-card",
				slot: "primary",
				content: values?.primary ?? DEFAULT_OVERLAY_VALUES["chapter-card"].primary ?? "Afternoon run",
				name: "Chapter",
				style: buildOverlaySlotStyle({
					kind: "chapter-card",
					slot: "primary",
					variantId,
					brandKit,
					position: { x: 0, y: -0.08 },
				}),
			}),
			createOverlayText({
				startTime,
				duration,
				brandKit,
				variantId,
				kind: "chapter-card",
				slot: "secondary",
				content: values?.secondary ?? DEFAULT_OVERLAY_VALUES["chapter-card"].secondary ?? "Court session",
				name: "Chapter detail",
				style: buildOverlaySlotStyle({
					kind: "chapter-card",
					slot: "secondary",
					variantId,
					brandKit,
					position: { x: 0, y: 0.03 },
				}),
			}),
		],
	},
	{
		id: "stat-card",
		label: "Stat",
		description: "Big stat with a supporting label.",
		defaultDuration: 2,
		buildElements: ({ startTime, duration, brandKit, variantId, safeMarginPreset, values }) => {
			const offsetX = getLeftMargin({ safeMarginPreset });
			return [
				createOverlayText({
					startTime,
					duration,
					brandKit,
					variantId,
					kind: "stat-card",
					slot: "primary",
					content: values?.primary ?? DEFAULT_OVERLAY_VALUES["stat-card"].primary ?? "10K",
					name: "Stat value",
					style: buildOverlaySlotStyle({
						kind: "stat-card",
						slot: "primary",
						variantId,
						brandKit,
						position: { x: offsetX, y: 0.18 },
					}),
				}),
				createOverlayText({
					startTime,
					duration,
					brandKit,
					variantId,
					kind: "stat-card",
					slot: "label",
					content: values?.label ?? DEFAULT_OVERLAY_VALUES["stat-card"].label ?? "Steps before lunch",
					name: "Stat label",
					style: buildOverlaySlotStyle({
						kind: "stat-card",
						slot: "label",
						variantId,
						brandKit,
						position: { x: offsetX, y: 0.305 },
					}),
				}),
			];
		},
	},
	{
		id: "quote-card-social",
		label: "Quote",
		description: "Short quote with an attribution line.",
		defaultDuration: 3,
		buildElements: ({ startTime, duration, brandKit, variantId, values }) => [
			createOverlayText({
				startTime,
				duration,
				brandKit,
				variantId,
				kind: "quote-card-social",
				slot: "primary",
				content: values?.primary ?? DEFAULT_OVERLAY_VALUES["quote-card-social"].primary ?? '"Build the habit first."',
				name: "Quote",
				style: buildOverlaySlotStyle({
					kind: "quote-card-social",
					slot: "primary",
					variantId,
					brandKit,
					position: { x: 0, y: -0.02 },
				}),
			}),
			createOverlayText({
				startTime,
				duration,
				brandKit,
				variantId,
				kind: "quote-card-social",
				slot: "secondary",
				content: values?.secondary ?? DEFAULT_OVERLAY_VALUES["quote-card-social"].secondary ?? "Coach note",
				name: "Attribution",
				style: buildOverlaySlotStyle({
					kind: "quote-card-social",
					slot: "secondary",
					variantId,
					brandKit,
					position: { x: 0, y: 0.12 },
				}),
			}),
		],
	},
];

export const OVERLAY_STYLE_VARIANTS: Array<{
	id: OverlayStyleVariantId;
	label: string;
	description: string;
}> = [
	{ id: "clean-vlog", label: "Clean vlog", description: "Lightweight vlog overlays with high readability." },
	{ id: "bold-social", label: "Bold social", description: "High-contrast plates and louder hierarchy." },
	{ id: "luxury", label: "Luxury", description: "Muted neutrals and elegant typography." },
	{ id: "minimal", label: "Minimal", description: "Low-noise overlays with soft supporting copy." },
];

export function getGraphicsPresetById({ presetId }: { presetId: GraphicsPresetId }): GraphicsPreset | null {
	return GRAPHICS_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

export function getSocialOverlayPresetById({
	presetId,
}: {
	presetId: SocialOverlayPresetId;
}): SocialOverlayPreset | null {
	return SOCIAL_OVERLAY_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

export function resolveProjectBrandKit({ project }: { project: TProject | null }): ProjectBrandKit {
	return {
		...DEFAULT_PROJECT_BRAND_KIT,
		...(project?.settings.brandKit ?? {}),
	};
}

export function resolveProjectOverlayDefaults({
	project,
}: {
	project: TProject | null;
}): ProjectOverlayDefaults {
	return {
		...DEFAULT_PROJECT_OVERLAY_DEFAULTS,
		...(project?.settings.overlayDefaults ?? {}),
	};
}

export function buildGraphicsPresetElements({
	project,
	presetId,
	motionPresetId,
	startTime,
	duration,
	logoAsset,
}: {
	project: TProject | null;
	presetId: GraphicsPresetId;
	motionPresetId: GraphicsMotionPresetId;
	startTime: number;
	duration?: number;
	logoAsset?: { id: string; name: string } | null;
}): Array<CreateTextElement | CreateImageElement> {
	const preset = getGraphicsPresetById({ presetId });
	if (!preset) {
		throw new Error("Unknown graphics preset.");
	}
	const brandKit = resolveProjectBrandKit({ project });
	const nextDuration = duration ?? preset.defaultDuration;
	return preset.buildElements({
		startTime,
		duration: nextDuration,
		brandKit,
		logoAsset,
	}).map((element) => withMotionPreset({ element, motionPresetId }));
}

export function buildSocialOverlayPresetElements({
	project,
	presetId,
	variantId,
	motionPresetId,
	startTime,
	duration,
	values,
}: {
	project: TProject | null;
	presetId: SocialOverlayPresetId;
	variantId?: OverlayStyleVariantId;
	motionPresetId?: GraphicsMotionPresetId;
	startTime: number;
	duration?: number;
	values?: Partial<Record<OverlayTextSlot, string>>;
}): Array<CreateTextElement | CreateImageElement> {
	const preset = getSocialOverlayPresetById({ presetId });
	if (!preset) {
		throw new Error("Unknown social overlay preset.");
	}
	const brandKit = resolveProjectBrandKit({ project });
	const overlayDefaults = resolveProjectOverlayDefaults({ project });
	const nextDuration = duration ?? preset.defaultDuration;
	const nextVariantId = variantId ?? overlayDefaults.variantId;
	const nextMotionPresetId = motionPresetId ?? overlayDefaults.motionPresetId;
	const safeMarginPreset = overlayDefaults.safeMarginPreset ?? "standard";

	return preset
		.buildElements({
			startTime,
			duration: nextDuration,
			brandKit,
			variantId: nextVariantId,
			safeMarginPreset,
			values,
		})
		.map((element) => withMotionPreset({ element, motionPresetId: nextMotionPresetId }));
}

export function applyOverlayStyleVariantToElements({
	project,
	kind,
	variantId,
	elements,
}: {
	project: TProject | null;
	kind: SocialOverlayPresetId;
	variantId: OverlayStyleVariantId;
	elements: Array<TextElement | ImageElement>;
}): Array<{ elementId: string; updates: Partial<TextElement | ImageElement> }> {
	const brandKit = resolveProjectBrandKit({ project });
	const overlayDefaults = resolveProjectOverlayDefaults({ project });
	const anchor = elements[0];
	if (!anchor) return [];
	const duration = Math.max(...elements.map((element) => element.duration));
	const startTime = Math.min(...elements.map((element) => element.startTime));
	const slotValues = Object.fromEntries(
		elements
			.filter((element): element is TextElement => element.type === "text")
			.map((element) => [element.overlayMeta?.slot ?? "primary", element.content]),
	) as Partial<Record<OverlayTextSlot, string>>;
	const rebuilt = buildSocialOverlayPresetElements({
		project: {
			...(project ?? null),
			settings: {
				...(project?.settings ?? {}),
				brandKit,
				overlayDefaults: {
					...overlayDefaults,
					variantId,
					motionPresetId: "none",
				},
			},
		} as TProject | null,
		presetId: kind,
		variantId,
		motionPresetId: "none",
		startTime,
		duration,
		values: slotValues,
	});
	const rebuiltBySlot = new Map<OverlayTextSlot | "image", CreateTextElement | CreateImageElement>();
	for (const element of rebuilt) {
		if (element.type === "text") {
			rebuiltBySlot.set(element.overlayMeta?.slot ?? "primary", element);
		} else {
			rebuiltBySlot.set("image", element);
		}
	}
	return elements.map((element) => {
		const key = element.type === "text" ? element.overlayMeta?.slot ?? "primary" : "image";
		const replacement = rebuiltBySlot.get(key as OverlayTextSlot | "image");
		if (!replacement) {
			return { elementId: element.id, updates: {} };
		}
		if (element.type === "text" && replacement.type === "text") {
			return {
				elementId: element.id,
				updates: {
					fontFamily: replacement.fontFamily,
					fontSize: replacement.fontSize,
					color: replacement.color,
					fontWeight: replacement.fontWeight,
					fontStyle: replacement.fontStyle,
					textAlign: replacement.textAlign,
					background: replacement.background,
					lineHeight: replacement.lineHeight,
					opacity: replacement.opacity,
					transform: replacement.transform,
					overlayMeta: replacement.overlayMeta,
				},
			};
		}
		if (element.type === "image" && replacement.type === "image") {
			return {
				elementId: element.id,
				updates: {
					transform: replacement.transform,
					opacity: replacement.opacity,
					overlayMeta: replacement.overlayMeta,
				},
			};
		}
		return { elementId: element.id, updates: {} };
	});
}

function withMotionPreset({
	element,
	motionPresetId,
}: {
	element: CreateTextElement | CreateImageElement;
	motionPresetId: GraphicsMotionPresetId;
}): CreateTextElement | CreateImageElement {
	return {
		...element,
		keyframes: applyGraphicsMotionPresetToCreateElement({
			element,
			motionPresetId,
		}).keyframes,
	};
}

function applyGraphicsMotionPresetToCreateElement({
	element,
	motionPresetId,
}: {
	element: Pick<VisualElement, "type" | "duration" | "transform" | "opacity" | "keyframes">;
	motionPresetId: GraphicsMotionPresetId;
}): { keyframes: VisualKeyframeMap | null } {
	if (motionPresetId === "none") {
		return { keyframes: null };
	}

	const baseElement: VisualElement = {
		...(element as TextElement | ImageElement | StickerElement),
		id: "graphics-motion-preview",
		keyframes: null,
	};
	let keyframes: VisualKeyframeMap | null = null;

	const withKeyframe = (
		property: AnimatableVisualProperty,
		localTime: number,
		value: number,
	) => {
		keyframes = {
			...(keyframes ?? {}),
			[property]:
				setPropertyKeyframeValue({
					element: { ...baseElement, keyframes },
					property,
					localTime,
					value,
				})[property] ?? [],
		};
	};

	const fadeInStartOpacity = 0;
	const finalOpacity = element.opacity ?? 1;
	const baseX = element.transform.position.x;
	const baseY = element.transform.position.y;
	const baseScale = element.transform.scale;
	const introEnd = clamp({ value: element.duration * 0.35, min: 0.18, max: 0.8 });

	withKeyframe("opacity", 0, fadeInStartOpacity);
	withKeyframe("opacity", introEnd, finalOpacity);

	switch (motionPresetId) {
		case "fade-up":
			withKeyframe("positionY", 0, baseY + 0.08);
			withKeyframe("positionY", introEnd, baseY);
			break;
		case "slide-up":
			withKeyframe("positionY", 0, baseY + 0.14);
			withKeyframe("positionY", introEnd, baseY);
			break;
		case "pop-in":
			withKeyframe("scale", 0, Math.max(0.7, baseScale * 0.78));
			withKeyframe("scale", introEnd, baseScale);
			break;
		case "drift-in":
			withKeyframe("positionX", 0, baseX - 0.08);
			withKeyframe("positionY", 0, baseY + 0.04);
			withKeyframe("positionX", introEnd, baseX);
			withKeyframe("positionY", introEnd, baseY);
			break;
	}

	return { keyframes };
}

export function applyGraphicsMotionPreset({
	element,
	motionPresetId,
}: {
	element: TextElement | StickerElement;
	motionPresetId: GraphicsMotionPresetId;
}): VisualKeyframeMap | null {
	return applyGraphicsMotionPresetToCreateElement({
		element: { ...element },
		motionPresetId,
	}).keyframes;
}

function getLeftMargin({
	safeMarginPreset,
}: {
	safeMarginPreset: OverlaySafeMarginPreset;
}): number {
	return safeMarginPreset === "tight" ? TIGHT_LEFT : STANDARD_LEFT;
}

function getOverlayVariantDefinition({
	brandKit,
	variantId,
}: {
	brandKit: ProjectBrandKit;
	variantId: OverlayStyleVariantId;
}): OverlayVariantDefinition {
	switch (variantId) {
		case "bold-social":
			return {
				primaryColor: "#FFFFFF",
				secondaryColor: brandKit.secondaryColor,
				accentColor: brandKit.accentColor,
				titleFontFamily: brandKit.titleFontFamily,
				bodyFontFamily: brandKit.bodyFontFamily,
			};
		case "luxury":
			return {
				primaryColor: "#F5EFE4",
				secondaryColor: "#D8CFC1",
				accentColor: "#A97C50",
				titleFontFamily: brandKit.titleFontFamily,
				bodyFontFamily: brandKit.bodyFontFamily,
			};
		case "minimal":
			return {
				primaryColor: brandKit.primaryColor,
				secondaryColor: `${brandKit.secondaryColor}CC`,
				accentColor: "#1B1B1BDD",
				titleFontFamily: brandKit.titleFontFamily,
				bodyFontFamily: brandKit.bodyFontFamily,
			};
		case "clean-vlog":
		default:
			return {
				primaryColor: brandKit.primaryColor,
				secondaryColor: brandKit.secondaryColor,
				accentColor: brandKit.accentColor,
				titleFontFamily: brandKit.titleFontFamily,
				bodyFontFamily: brandKit.bodyFontFamily,
			};
	}
}

function createOverlayText({
	startTime,
	duration,
	brandKit,
	variantId,
	kind,
	slot,
	content,
	name,
	style,
}: {
	startTime: number;
	duration: number;
	brandKit: ProjectBrandKit;
	variantId: OverlayStyleVariantId;
	kind: SocialOverlayPresetId;
	slot: OverlayTextSlot;
	content: string;
	name: string;
	style: OverlaySlotStyle;
}): CreateTextElement {
	return createText({
		startTime,
		duration,
		content,
		name,
		fontFamily: style.fontFamily,
		fontSize: style.fontSize,
		color: style.color,
		fontWeight: style.fontWeight,
		fontStyle: style.fontStyle,
		textAlign: style.textAlign,
		background: style.background,
		position: style.position,
		opacity: style.opacity,
		lineHeight: style.lineHeight,
		overlayMeta: {
			kind,
			variantId,
			slot,
		},
	});
}

function buildOverlaySlotStyle({
	kind,
	slot,
	variantId,
	brandKit,
	position,
}: {
	kind: SocialOverlayPresetId;
	slot: OverlayTextSlot;
	variantId: OverlayStyleVariantId;
	brandKit: ProjectBrandKit;
	position: { x: number; y: number };
}): OverlaySlotStyle {
	const variant = getOverlayVariantDefinition({ brandKit, variantId });
	const isMinimal = variantId === "minimal";
	const isLuxury = variantId === "luxury";
	const isBold = variantId === "bold-social";

	switch (kind) {
		case "timestamp-card":
			if (slot === "time") {
				return {
					fontFamily: variant.titleFontFamily,
					fontSize: isBold ? 4.9 : 4.4,
					fontWeight: "bold",
					color: "#FFFFFF",
					background: {
						color: isMinimal ? "#111111DD" : variant.accentColor,
						cornerRadius: 16,
						paddingX: 18,
						paddingY: 12,
					},
					textAlign: "left",
					position,
				};
			}
			return {
				fontFamily: variant.bodyFontFamily,
				fontSize: isBold ? 4.6 : 4.1,
				fontWeight: isBold ? "bold" : "normal",
				color: variant.primaryColor,
				textAlign: "left",
				position,
				opacity: 0.94,
			};
		case "routine-label":
			return {
				fontFamily: variant.titleFontFamily,
				fontSize: isLuxury ? 4.2 : 4.4,
				fontWeight: "bold",
				color: isMinimal ? variant.primaryColor : "#FFFFFF",
				background: {
					color: isMinimal ? "#111111BB" : variant.accentColor,
					cornerRadius: 999,
					paddingX: 20,
					paddingY: 12,
				},
				textAlign: "left",
				position,
			};
		case "location-tag":
			if (slot === "primary") {
				return {
					fontFamily: variant.titleFontFamily,
					fontSize: isBold ? 4.8 : 4.4,
					fontWeight: "bold",
					color: variant.primaryColor,
					textAlign: "left",
					position,
					background: isMinimal
						? undefined
						: {
							color: "#1111118C",
							cornerRadius: 16,
							paddingX: 16,
							paddingY: 12,
						},
				};
			}
			return {
				fontFamily: variant.bodyFontFamily,
				fontSize: 3.2,
				color: variant.secondaryColor,
				textAlign: "left",
				position,
				opacity: 0.9,
			};
		case "chapter-card":
			if (slot === "primary") {
				return {
					fontFamily: variant.titleFontFamily,
					fontSize: isBold ? 7 : 6.4,
					fontWeight: "bold",
					color: variant.primaryColor,
					textAlign: "center",
					position,
					background: isMinimal
						? undefined
						: {
							color: isLuxury ? "#1B1712D9" : "#111111A8",
							cornerRadius: 22,
							paddingX: 26,
							paddingY: 18,
						},
				};
			}
			return {
				fontFamily: variant.bodyFontFamily,
				fontSize: 3.2,
				color: variant.secondaryColor,
				textAlign: "center",
				position,
				opacity: 0.92,
			};
		case "stat-card":
			if (slot === "primary") {
				return {
					fontFamily: variant.titleFontFamily,
					fontSize: isBold ? 7.2 : 6.5,
					fontWeight: "bold",
					color: variant.primaryColor,
					textAlign: "left",
					position,
				};
			}
			return {
				fontFamily: variant.bodyFontFamily,
				fontSize: 3.1,
				color: variant.secondaryColor,
				textAlign: "left",
				position,
				opacity: 0.94,
			};
		case "quote-card-social":
			if (slot === "primary") {
				return {
					fontFamily: variant.bodyFontFamily,
					fontSize: isBold ? 5.4 : 5,
					fontStyle: "italic",
					fontWeight: isBold ? "bold" : "normal",
					color: variant.primaryColor,
					textAlign: "center",
					position,
					lineHeight: 1.25,
					background: isMinimal
						? undefined
						: {
							color: isLuxury ? "#2E251BD6" : `${variant.accentColor}33`,
							cornerRadius: 24,
							paddingX: 30,
							paddingY: 24,
						},
				};
			}
			return {
				fontFamily: variant.bodyFontFamily,
				fontSize: 2.8,
				color: variant.secondaryColor,
				textAlign: "center",
				position,
				opacity: 0.88,
			};
	}
}
