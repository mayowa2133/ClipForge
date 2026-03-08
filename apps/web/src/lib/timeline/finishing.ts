import { generateUUID } from "@/utils/id";
import type {
	ImageElement,
	VideoElement,
	VisualAdjustments,
	VisualEffect,
	VisualEffectKind,
} from "@/types/timeline";

export type FinishableVisualElement = VideoElement | ImageElement;

export type FilterPresetId =
	| "clean"
	| "warm"
	| "cool"
	| "dramatic"
	| "mono"
	| "vintage";

export interface FilterPreset {
	id: FilterPresetId;
	label: string;
	description: string;
	adjustments: VisualAdjustments;
	effects?: VisualEffect[] | null;
}

export const DEFAULT_VISUAL_ADJUSTMENTS: VisualAdjustments = {
	exposure: 0,
	contrast: 0,
	saturation: 0,
	temperature: 0,
	tint: 0,
	highlights: 0,
	shadows: 0,
};

export const MAX_VISUAL_EFFECTS = 3;

export function createDefaultEffect({
	kind,
}: {
	kind: VisualEffectKind;
}): VisualEffect {
	switch (kind) {
		case "blur":
			return { id: generateUUID(), kind, enabled: true, radius: 12 };
		case "vignette":
			return { id: generateUUID(), kind, enabled: true, intensity: 0.45 };
		case "sharpen":
			return { id: generateUUID(), kind, enabled: true, amount: 0.35 };
	}
}

export const FILTER_PRESETS: FilterPreset[] = [
	{
		id: "clean",
		label: "Clean",
		description: "Balanced color with a subtle contrast lift.",
		adjustments: {
			...DEFAULT_VISUAL_ADJUSTMENTS,
			contrast: 0.12,
			saturation: 0.08,
			highlights: -0.08,
			shadows: 0.08,
		},
	},
	{
		id: "warm",
		label: "Warm",
		description: "Warmer skin tones and soft contrast for social clips.",
		adjustments: {
			...DEFAULT_VISUAL_ADJUSTMENTS,
			exposure: 0.04,
			contrast: 0.08,
			saturation: 0.12,
			temperature: 0.28,
			highlights: -0.06,
			shadows: 0.05,
		},
	},
	{
		id: "cool",
		label: "Cool",
		description: "Cooler tones with crisp highlights.",
		adjustments: {
			...DEFAULT_VISUAL_ADJUSTMENTS,
			contrast: 0.1,
			saturation: 0.06,
			temperature: -0.24,
			tint: -0.06,
			highlights: 0.05,
			shadows: -0.02,
		},
	},
	{
		id: "dramatic",
		label: "Dramatic",
		description: "Higher contrast with a stronger vignette.",
		adjustments: {
			...DEFAULT_VISUAL_ADJUSTMENTS,
			exposure: -0.04,
			contrast: 0.3,
			saturation: -0.05,
			highlights: -0.2,
			shadows: 0.12,
		},
		effects: [{ id: "preset-vignette", kind: "vignette", enabled: true, intensity: 0.6 }],
	},
	{
		id: "mono",
		label: "Mono",
		description: "Desaturated monochrome finish with sharpened detail.",
		adjustments: {
			...DEFAULT_VISUAL_ADJUSTMENTS,
			contrast: 0.18,
			saturation: -1,
			highlights: 0.06,
			shadows: 0.08,
		},
		effects: [{ id: "preset-sharpen", kind: "sharpen", enabled: true, amount: 0.3 }],
	},
	{
		id: "vintage",
		label: "Vintage",
		description: "Muted contrast with warm faded shadows.",
		adjustments: {
			...DEFAULT_VISUAL_ADJUSTMENTS,
			exposure: 0.05,
			contrast: -0.08,
			saturation: -0.18,
			temperature: 0.18,
			tint: 0.04,
			highlights: -0.05,
			shadows: 0.16,
		},
		effects: [{ id: "preset-vignette", kind: "vignette", enabled: true, intensity: 0.32 }],
	},
];

export function clampAdjustmentValue({ value }: { value: number }): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(-1, Math.min(1, value));
}

export function clampVisualAdjustments({
	adjustments,
}: {
	adjustments?: Partial<VisualAdjustments> | null;
}): VisualAdjustments {
	return {
		exposure: clampAdjustmentValue({ value: adjustments?.exposure ?? 0 }),
		contrast: clampAdjustmentValue({ value: adjustments?.contrast ?? 0 }),
		saturation: clampAdjustmentValue({ value: adjustments?.saturation ?? 0 }),
		temperature: clampAdjustmentValue({ value: adjustments?.temperature ?? 0 }),
		tint: clampAdjustmentValue({ value: adjustments?.tint ?? 0 }),
		highlights: clampAdjustmentValue({ value: adjustments?.highlights ?? 0 }),
		shadows: clampAdjustmentValue({ value: adjustments?.shadows ?? 0 }),
	};
}

function clampEffect(effect: VisualEffect): VisualEffect {
	switch (effect.kind) {
		case "blur":
			return {
				...effect,
				radius: Math.max(0, Math.min(40, Number.isFinite(effect.radius) ? effect.radius : 0)),
			};
		case "vignette":
			return {
				...effect,
				intensity: Math.max(
					0,
					Math.min(1, Number.isFinite(effect.intensity) ? effect.intensity : 0),
				),
			};
		case "sharpen":
			return {
				...effect,
				amount: Math.max(0, Math.min(1, Number.isFinite(effect.amount) ? effect.amount : 0)),
			};
	}
}

export function normalizeVisualEffects({
	effects,
}: {
	effects?: VisualEffect[] | null;
}): VisualEffect[] | null {
	if (!effects?.length) return null;

	const normalized: VisualEffect[] = [];
	const seen = new Set<VisualEffectKind>();

	for (const effect of effects) {
		if (!effect || seen.has(effect.kind)) continue;
		seen.add(effect.kind);
		normalized.push(clampEffect(effect));
		if (normalized.length >= MAX_VISUAL_EFFECTS) break;
	}

	return normalized.length > 0 ? normalized : null;
}

export function normalizeFinishableElement<T extends FinishableVisualElement>({
	element,
}: {
	element: T;
}): T {
	const adjustments = clampVisualAdjustments({ adjustments: element.adjustments });
	const effects = normalizeVisualEffects({ effects: element.effects });
	return {
		...element,
		adjustments: adjustmentsAreDefault({ adjustments }) ? null : adjustments,
		effects,
	};
}

export function adjustmentsAreDefault({
	adjustments,
}: {
	adjustments?: VisualAdjustments | null;
}): boolean {
	if (!adjustments) return true;
	return Object.values(adjustments).every((value) => Math.abs(value) < 1e-6);
}

export function getFilterPresetById({
	presetId,
}: {
	presetId: FilterPresetId;
}): FilterPreset | null {
	return FILTER_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

export function applyFilterPreset({
	presetId,
}: {
	presetId: FilterPresetId;
}): {
	adjustments: VisualAdjustments | null;
	effects: VisualEffect[] | null;
} {
	const preset = getFilterPresetById({ presetId });
	if (!preset) {
		return { adjustments: null, effects: null };
	}

	return {
		adjustments: adjustmentsAreDefault({ adjustments: preset.adjustments })
			? null
			: clampVisualAdjustments({ adjustments: preset.adjustments }),
		effects: normalizeVisualEffects({
			effects: preset.effects?.map((effect) => ({
				...effect,
				id: generateUUID(),
			})) ?? null,
		}),
	};
}

function areEffectsExactlyEqual({
	left,
	right,
}: {
	left?: VisualEffect[] | null;
	right?: VisualEffect[] | null;
}): boolean {
	const normalizedLeft = normalizeVisualEffects({ effects: left });
	const normalizedRight = normalizeVisualEffects({ effects: right });
	if (!normalizedLeft && !normalizedRight) return true;
	if (!normalizedLeft || !normalizedRight) return false;
	if (normalizedLeft.length !== normalizedRight.length) return false;

	return normalizedLeft.every((effect, index) => {
		const other = normalizedRight[index];
		if (!other || effect.kind !== other.kind || effect.enabled !== other.enabled) {
			return false;
		}
		switch (effect.kind) {
			case "blur":
				return other.kind === "blur" && Math.abs(effect.radius - other.radius) < 1e-6;
			case "vignette":
				return (
					other.kind === "vignette" &&
					Math.abs(effect.intensity - other.intensity) < 1e-6
				);
			case "sharpen":
				return other.kind === "sharpen" && Math.abs(effect.amount - other.amount) < 1e-6;
		}
	});
}

export function findMatchingFilterPreset({
	adjustments,
	effects,
}: {
	adjustments?: VisualAdjustments | null;
	effects?: VisualEffect[] | null;
}): FilterPresetId | null {
	const normalizedAdjustments = clampVisualAdjustments({ adjustments });
	for (const preset of FILTER_PRESETS) {
		if (
			Object.entries(normalizedAdjustments).every(
				([key, value]) =>
					Math.abs(value - preset.adjustments[key as keyof VisualAdjustments]) < 1e-6,
			) &&
			areEffectsExactlyEqual({ left: effects, right: preset.effects ?? null })
		) {
			return preset.id;
		}
	}
	return null;
}

export function hasVisualFinishing({
	element,
}: {
	element: Pick<FinishableVisualElement, "adjustments" | "effects">;
}): boolean {
	return hasVisualAdjustments({ element }) || Boolean(normalizeVisualEffects({ effects: element.effects })?.length);
}

export function hasVisualAdjustments({
	element,
}: {
	element: Pick<FinishableVisualElement, "adjustments">;
}): boolean {
	return !adjustmentsAreDefault({
		adjustments: clampVisualAdjustments({ adjustments: element.adjustments }),
	});
}

