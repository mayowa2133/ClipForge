import { describe, expect, test } from "bun:test";
import {
	buildCaptionRevealKeyframes,
	getCaptionRevealSoundSyncPreset,
	resolvePolishProfileFromBrief,
} from "@/lib/clipforge";
import type { TProject } from "@/types/project";

function buildProjectFixture(): TProject {
	return {
		metadata: {
			id: "project-polish-1",
			name: "Polish Fixture",
			duration: 30,
			createdAt: new Date("2026-03-12T00:00:00.000Z"),
			updatedAt: new Date("2026-03-12T00:00:00.000Z"),
		},
		scenes: [],
		currentSceneId: "scene-1",
		settings: {
			fps: 30,
			canvasSize: { width: 1080, height: 1920 },
			background: { type: "color", color: "#000000" },
			audio: {
				masterVolume: 1,
				duckingEnabled: true,
				duckingAmount: 0.5,
				duckingAttackMs: 100,
				duckingReleaseMs: 300,
				audioPolishPresetId: "none",
				softLimiterEnabled: false,
			},
			polishProfileId: null,
		},
		version: 19,
	};
}

describe("polish profiles", () => {
	test("maps luxury routine prompts to the luxury polish profile", () => {
		const project = buildProjectFixture();
		const profile = resolvePolishProfileFromBrief({
			brief: {
				goal: "luxury-routine",
				tone: "luxury",
				durationTargetS: 24,
				captionStyleId: "luxury-bottom",
				overlayStyleVariantId: "luxury",
				motionPresetId: "drift-in",
				beatDivision: 2,
				versionTargets: ["9:16"],
				notes: "luxury morning routine",
				trendSoundReferenceId: null,
			},
			project,
		});

		expect(profile.id).toBe("luxury-routine");
		expect(profile.audioPolishPresetId).toBe("luxury-soft");
		expect(profile.captionRevealPresetId).toBe("luxury-rise");
	});

	test("respects a saved project polish profile default", () => {
		const project = buildProjectFixture();
		project.settings.polishProfileId = "talking-head";
		const profile = resolvePolishProfileFromBrief({
			brief: {
				goal: "viral-tiktok",
				tone: "clean",
				durationTargetS: 25,
				captionStyleId: "clean-bottom",
				overlayStyleVariantId: "clean-vlog",
				motionPresetId: "fade-up",
				beatDivision: 2,
				versionTargets: ["9:16"],
				notes: "make me a viral tiktok",
				trendSoundReferenceId: null,
			},
			project,
		});

		expect(profile.id).toBe("talking-head");
	});

	test("caption reveal presets write deterministic motion and sound sync", () => {
		const keyframes = buildCaptionRevealKeyframes({
			element: {
				id: "caption-1",
				type: "text",
				name: "Caption",
				content: "Hello world",
				startTime: 0,
				duration: 2,
				trimStart: 0,
				trimEnd: 0,
				transform: {
					scale: 1,
					position: { x: 0, y: 0.6 },
					rotate: 0,
				},
				opacity: 1,
				fontSize: 14,
				fontFamily: "Geist Sans",
				fontWeight: "bold",
				fontStyle: "normal",
				textDecoration: "none",
				textAlign: "center",
				color: "#ffffff",
				background: {
					color: "#000000",
					paddingX: 0.02,
					paddingY: 0.01,
				},
				role: "caption",
				captionTiming: null,
			},
			presetId: "type-on-soft",
		});

		expect(keyframes?.opacity?.[0]?.value).toBe(0);
		expect(keyframes?.positionY?.[0]?.value).toBeGreaterThan(0.6);
		expect(getCaptionRevealSoundSyncPreset({ presetId: "type-on-soft" })).toBe(
			"typing-soft",
		);
	});
});
