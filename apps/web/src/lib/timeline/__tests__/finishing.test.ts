import { describe, expect, test } from "bun:test";
import {
	FILTER_PRESETS,
	applyFilterPreset,
	clampVisualAdjustments,
	findMatchingFilterPreset,
	normalizeVisualEffects,
} from "@/lib/timeline";
import type { VisualEffect } from "@/types/timeline";

describe("finishing helpers", () => {
	test("clamps adjustments deterministically", () => {
		expect(
			clampVisualAdjustments({
				adjustments: {
					exposure: 2,
					contrast: -2,
					saturation: 0.5,
					temperature: 99,
					tint: -99,
					highlights: 1.2,
					shadows: -1.2,
				},
			}),
		).toEqual({
			exposure: 1,
			contrast: -1,
			saturation: 0.5,
			temperature: 1,
			tint: -1,
			highlights: 1,
			shadows: -1,
		});
	});

	test("normalizes effects to distinct kinds with deterministic clamping", () => {
		const effects: VisualEffect[] = [
			{ id: "blur-1", kind: "blur", enabled: true, radius: 55 },
			{ id: "blur-2", kind: "blur", enabled: true, radius: 10 },
			{ id: "vignette-1", kind: "vignette", enabled: true, intensity: 3 },
			{ id: "sharpen-1", kind: "sharpen", enabled: true, amount: -1 },
			{ id: "extra", kind: "sharpen", enabled: true, amount: 0.5 },
		];

		expect(normalizeVisualEffects({ effects })).toEqual([
			{ id: "blur-1", kind: "blur", enabled: true, radius: 40 },
			{ id: "vignette-1", kind: "vignette", enabled: true, intensity: 1 },
			{ id: "sharpen-1", kind: "sharpen", enabled: true, amount: 0 },
		]);
	});

	test("applying a preset writes concrete adjustments and effects", () => {
		const result = applyFilterPreset({ presetId: "dramatic" });
		const preset = FILTER_PRESETS.find((entry) => entry.id === "dramatic");

		expect(result.adjustments).toEqual(preset?.adjustments ?? null);
		expect(result.effects?.[0]?.kind).toBe("vignette");
		expect(result.effects?.[0]?.id).toBeDefined();
		expect(result.effects?.[0]?.id).not.toBe("preset-vignette");
	});

	test("preset matching requires exact adjustments and effects", () => {
		const preset = FILTER_PRESETS.find((entry) => entry.id === "warm");
		expect(preset).toBeDefined();
		expect(
			findMatchingFilterPreset({
				adjustments: preset?.adjustments ?? null,
				effects: preset?.effects ?? null,
			}),
		).toBe("warm");
		expect(
			findMatchingFilterPreset({
				adjustments: {
					...(preset?.adjustments ?? {
						exposure: 0,
						contrast: 0,
						saturation: 0,
						temperature: 0,
						tint: 0,
						highlights: 0,
						shadows: 0,
					}),
					temperature: 0,
				},
				effects: preset?.effects ?? null,
			}),
		).toBeNull();
	});
});
