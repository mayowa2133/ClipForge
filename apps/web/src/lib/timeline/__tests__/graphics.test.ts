import { describe, expect, test } from "bun:test";
import {
	buildGraphicsPresetElements,
	buildSocialOverlayPresetElements,
	getGraphicsPresetById,
	getSocialOverlayPresetById,
	resolveProjectBrandKit,
	resolveProjectOverlayDefaults,
} from "@/lib/timeline";
import {
	DEFAULT_PROJECT_BRAND_KIT,
	DEFAULT_PROJECT_OVERLAY_DEFAULTS,
} from "@/constants/project-constants";

const baseProject = {
	metadata: {
		id: "project-1",
		name: "Project",
		duration: 5,
		createdAt: new Date("2026-03-09T00:00:00.000Z"),
		updatedAt: new Date("2026-03-09T00:00:00.000Z"),
	},
	scenes: [],
	currentSceneId: "scene-1",
	settings: {
		fps: 30,
		canvasSize: { width: 1920, height: 1080 },
		background: { type: "color" as const, color: "#000000" },
		audio: {
			masterVolume: 1,
			duckingEnabled: true,
			duckingAmount: 0.45,
			duckingAttackMs: 120,
			duckingReleaseMs: 280,
		},
	},
	version: 15,
};

describe("graphics presets", () => {
	test("brand kit resolves defaults when unset", () => {
		expect(resolveProjectBrandKit({ project: baseProject as never })).toEqual(
			DEFAULT_PROJECT_BRAND_KIT,
		);
	});

	test("overlay defaults resolve when unset", () => {
		expect(resolveProjectOverlayDefaults({ project: baseProject as never })).toEqual(
			DEFAULT_PROJECT_OVERLAY_DEFAULTS,
		);
	});

	test("graphics preset builder is deterministic and uses brand kit values", () => {
		const project = {
			...baseProject,
			settings: {
				...baseProject.settings,
				brandKit: {
					...DEFAULT_PROJECT_BRAND_KIT,
					primaryColor: "#112233",
					secondaryColor: "#445566",
					accentColor: "#778899",
					titleFontFamily: "Georgia",
					bodyFontFamily: "Verdana",
					logoMediaId: null,
				},
			},
		};
		const elements = buildGraphicsPresetElements({
			project: project as never,
			presetId: "lower-third-clean",
			motionPresetId: "none",
			startTime: 1,
		});

		expect(elements).toHaveLength(2);
		expect(elements[0]).toMatchObject({
			type: "text",
			fontFamily: "Georgia",
			color: "#112233",
			startTime: 1,
		});
		expect(elements[1]).toMatchObject({
			type: "text",
			fontFamily: "Verdana",
			color: "#112233",
			opacity: 0.8,
		});
	});

	test("social overlay builder creates deterministic slot metadata", () => {
		const elements = buildSocialOverlayPresetElements({
			project: baseProject as never,
			presetId: "timestamp-card",
			startTime: 2,
			motionPresetId: "none",
		});

		expect(elements).toHaveLength(2);
		expect(elements[0]).toMatchObject({
			type: "text",
			overlayMeta: {
				kind: "timestamp-card",
				variantId: "clean-vlog",
				slot: "time",
			},
		});
		expect(elements[1]).toMatchObject({
			type: "text",
			overlayMeta: {
				kind: "timestamp-card",
				variantId: "clean-vlog",
				slot: "label",
			},
		});
	});

	test("social overlay builder uses project overlay defaults", () => {
		const project = {
			...baseProject,
			settings: {
				...baseProject.settings,
				overlayDefaults: {
					variantId: "bold-social",
					motionPresetId: "pop-in",
					safeMarginPreset: "tight",
				},
			},
		};
		const [timeElement] = buildSocialOverlayPresetElements({
			project: project as never,
			presetId: "timestamp-card",
			startTime: 0,
		});

		expect(timeElement.type).toBe("text");
		expect(timeElement.overlayMeta?.variantId).toBe("bold-social");
		expect(timeElement.keyframes?.scale).toHaveLength(2);
		expect(timeElement.transform.position.x).toBeLessThan(-0.38);
	});

	test("motion preset writes concrete intro keyframes", () => {
		const [element] = buildGraphicsPresetElements({
			project: baseProject as never,
			presetId: "cta-subscribe",
			motionPresetId: "pop-in",
			startTime: 0,
		});

		expect(element.type).toBe("text");
		expect(element.keyframes?.opacity).toHaveLength(2);
		expect(element.keyframes?.scale).toHaveLength(2);
		expect(element.keyframes?.opacity?.[0]?.value).toBe(0);
	});

	test("preset metadata exposes default durations", () => {
		expect(getGraphicsPresetById({ presetId: "quote-card" })?.defaultDuration).toBe(3);
		expect(getSocialOverlayPresetById({ presetId: "chapter-card" })?.defaultDuration).toBe(3);
	});
});
