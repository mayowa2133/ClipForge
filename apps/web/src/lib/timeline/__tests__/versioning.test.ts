import { describe, expect, test } from "bun:test";
import {
	buildDefaultProjectVersionPack,
	DEFAULT_PROJECT_OVERLAY_DEFAULTS,
} from "@/constants/project-constants";
import {
	collectVersionLayoutWarnings,
	createSafeLayoutOverrides,
	createVersionOverrideForAutoReframe,
	resolveProjectVersionPack,
} from "@/lib/timeline";

const baseProject = {
	metadata: {
		id: "project-1",
		name: "Project",
		duration: 5,
		createdAt: new Date("2026-03-10T00:00:00.000Z"),
		updatedAt: new Date("2026-03-10T00:00:00.000Z"),
	},
	scenes: [],
	currentSceneId: "scene-1",
	settings: {
		fps: 30,
		canvasSize: { width: 1080, height: 1920 },
		background: { type: "color" as const, color: "#000000" },
		audio: {
			masterVolume: 1,
			duckingEnabled: true,
			duckingAmount: 0.45,
			duckingAttackMs: 120,
			duckingReleaseMs: 280,
		},
		overlayDefaults: DEFAULT_PROJECT_OVERLAY_DEFAULTS,
	},
	version: 17,
};

describe("versioning helpers", () => {
	test("version-pack defaults initialize predictably for a legacy project", () => {
		const versionPack = resolveProjectVersionPack({ project: baseProject as never });

		expect(versionPack.targets.map((target) => target.id)).toEqual(["9:16", "1:1", "16:9"]);
		expect(versionPack.targets.find((target) => target.id === "9:16")?.enabled).toBe(true);
		expect(versionPack.targets.find((target) => target.id === "1:1")?.enabled).toBe(false);
		expect(versionPack.targets.find((target) => target.id === "16:9")?.enabled).toBe(false);
		expect(versionPack.activeTargetId).toBe("9:16");
	});

	test("auto reframe computes deterministic transform overrides per target ratio", () => {
		const override = createVersionOverrideForAutoReframe({
			element: {
				type: "video",
				id: "video-1",
				name: "Video",
				mediaId: "media-1",
				duration: 4,
				startTime: 0,
				trimStart: 0,
				trimEnd: 0,
				transform: {
					scale: 1.25,
					rotate: 0,
					position: { x: 0.2, y: -0.15 },
				},
				opacity: 1,
			},
			baseCanvasSize: { width: 1080, height: 1920 },
			targetCanvasSize: { width: 1080, height: 1080 },
		});

		expect(override.transform?.scale).toBe(1);
		expect(override.transform?.rotate).toBe(0);
		expect(override.transform?.position?.x).toBe(0.2);
		expect(override.transform?.position?.y).toBeCloseTo(-0.084375, 8);
	});

	test("safe layout adaptation preserves grouped overlay layout and emits no warnings after adaptation", () => {
		const targetVersionId = "1:1" as const;
		const targetCanvasSize = { width: 1080, height: 1080 };
		const tracks = [
			{
				id: "text-track-1",
				name: "Text",
				type: "text" as const,
				hidden: false,
				elements: [
					{
						type: "text" as const,
						id: "title",
						name: "Title",
						content: "7:20 am",
						duration: 2,
						startTime: 0,
						trimStart: 0,
						trimEnd: 0,
						fontSize: 18,
						fontFamily: "Arial",
						color: "#ffffff",
						background: {
							color: "#111111",
							paddingX: 0.03,
							paddingY: 0.02,
						},
						textAlign: "left" as const,
						fontWeight: "bold" as const,
						fontStyle: "normal" as const,
						textDecoration: "none" as const,
						transform: {
							scale: 1,
							rotate: 0,
							position: { x: -0.46, y: 0.72 },
						},
						opacity: 1,
						linkedGroupId: "overlay-1",
						overlayMeta: {
							kind: "timestamp-card" as const,
							variantId: "clean-vlog" as const,
							slot: "time" as const,
						},
						versionOverrides: null,
					},
					{
						type: "text" as const,
						id: "subtitle",
						name: "Subtitle",
						content: "Get loose",
						duration: 2,
						startTime: 0,
						trimStart: 0,
						trimEnd: 0,
						fontSize: 12,
						fontFamily: "Arial",
						color: "#ffffff",
						background: {
							color: "#111111",
							paddingX: 0.03,
							paddingY: 0.02,
						},
						textAlign: "left" as const,
						fontWeight: "normal" as const,
						fontStyle: "normal" as const,
						textDecoration: "none" as const,
						transform: {
							scale: 1,
							rotate: 0,
							position: { x: -0.42, y: 0.82 },
						},
						opacity: 1,
						linkedGroupId: "overlay-1",
						overlayMeta: {
							kind: "timestamp-card" as const,
							variantId: "clean-vlog" as const,
							slot: "label" as const,
						},
						versionOverrides: null,
					},
				],
			},
		];

		const overrides = createSafeLayoutOverrides({
			tracks: tracks as never,
			targetCanvasSize,
			targetVersionId,
			safeMarginPreset: "standard",
		});

		expect(overrides.size).toBe(2);
		expect(overrides.get("title")?.transform?.position?.x).toBeGreaterThan(-450);
		expect(overrides.get("subtitle")?.transform?.position?.y).toBeLessThan(420);

		const adaptedTracks = tracks.map((track) => ({
			...track,
			elements: track.elements.map((element) => ({
				...element,
				versionOverrides: {
					[targetVersionId]: overrides.get(element.id) ?? null,
				},
			})),
		}));
		const warnings = collectVersionLayoutWarnings({
			tracks: adaptedTracks as never,
			targetCanvasSize,
			targetVersionId,
			safeMarginPreset: "standard",
		});

		expect(warnings).toHaveLength(0);
	});
});
