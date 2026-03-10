import { describe, expect, test } from "bun:test";
import {
	applyProjectKitPayload,
	buildComponentTemplatePayload,
	buildProjectKitPayload,
	buildSceneRecipePayloadFromScene,
	instantiateTemplateElements,
	resolveProjectMontageDefaults,
} from "@/lib/timeline";
import { buildDefaultClipForgeProjectData } from "@/lib/clipforge";
import type { TextElement } from "@/types/timeline";

function createTextElement(overrides: Partial<TextElement> = {}): TextElement {
	return {
		id: overrides.id ?? "text-id",
		type: "text",
		name: overrides.name ?? "Text",
		startTime: overrides.startTime ?? 0,
		duration: overrides.duration ?? 2,
		trimStart: overrides.trimStart ?? 0,
		trimEnd: overrides.trimEnd ?? 0,
		role: overrides.role ?? "text",
		captionTiming: overrides.captionTiming ?? null,
		overlayMeta: overrides.overlayMeta ?? null,
		content: overrides.content ?? "Text",
		fontSize: overrides.fontSize ?? 8,
		fontFamily: overrides.fontFamily ?? "Inter",
		color: overrides.color ?? "#ffffff",
		background:
			overrides.background ?? {
				color: "transparent",
				cornerRadius: 0,
				paddingX: 0,
				paddingY: 0,
				offsetX: 0,
				offsetY: 0,
			},
		textAlign: overrides.textAlign ?? "left",
		fontWeight: overrides.fontWeight ?? "normal",
		fontStyle: overrides.fontStyle ?? "normal",
		textDecoration: overrides.textDecoration ?? "none",
		letterSpacing: overrides.letterSpacing,
		lineHeight: overrides.lineHeight,
		hidden: overrides.hidden ?? false,
		linkedGroupId: overrides.linkedGroupId ?? null,
		transitionIn: overrides.transitionIn ?? null,
		keyframes: overrides.keyframes ?? null,
		transform:
			overrides.transform ?? {
				scale: 1,
				position: {
					x: 0,
					y: 0,
				},
				rotate: 0,
			},
		opacity: overrides.opacity ?? 1,
		blendMode: overrides.blendMode,
	};
}

const baseProject = {
	metadata: {
		id: "project-1",
		name: "Project",
		duration: 8,
		createdAt: new Date("2026-03-10T00:00:00.000Z"),
		updatedAt: new Date("2026-03-10T00:00:00.000Z"),
	},
	currentSceneId: "scene-1",
	version: 16,
	settings: {
		fps: 30,
		canvasSize: { width: 1080, height: 1920 },
		background: { type: "color" as const, color: "#000000" },
		audio: {
			masterVolume: 0.9,
			duckingEnabled: true,
			duckingAmount: 0.4,
			duckingAttackMs: 100,
			duckingReleaseMs: 200,
		},
		brandKit: {
			primaryColor: "#112233",
			secondaryColor: "#445566",
			accentColor: "#778899",
			titleFontFamily: "Georgia",
			bodyFontFamily: "Verdana",
			logoMediaId: null,
		},
		overlayDefaults: {
			variantId: "luxury" as const,
			motionPresetId: "pop-in" as const,
			safeMarginPreset: "tight" as const,
		},
		montageDefaults: {
			beatDivision: 4 as const,
			motionPresetId: "drift-in" as const,
		},
	},
	scenes: [],
	clipforge: {
		...buildDefaultClipForgeProjectData(),
		activeCaptionStyleId: "bold-center",
	},
};

describe("creator templates", () => {
	test("component template payload normalizes grouped element timing", () => {
		const title: TextElement = createTextElement({
			id: "title-1",
			startTime: 5,
			content: "Name",
			linkedGroupId: "group-1",
			overlayMeta: {
				kind: "timestamp-card" as const,
				variantId: "clean-vlog" as const,
				slot: "time" as const,
			},
		});
		const subtitle: TextElement = createTextElement({
			id: "title-2",
			startTime: 6,
			content: "Role",
			linkedGroupId: "group-1",
			overlayMeta: {
				kind: "timestamp-card" as const,
				variantId: "clean-vlog" as const,
				slot: "label" as const,
			},
		});
		const payload = buildComponentTemplatePayload({
			elementsWithTracks: [
				{ track: { type: "text" as const }, element: title },
				{ track: { type: "text" as const }, element: subtitle },
			],
		});

		expect(payload.duration).toBe(3);
		expect(payload.elements.map((snapshot) => snapshot.element.startTime)).toEqual([0, 1]);
	});

	test("template instantiation remaps ids and linked groups while preserving offsets", () => {
		const title: TextElement = createTextElement({
			id: "text-1",
			startTime: 0,
			content: "Primary",
			linkedGroupId: "group-1",
		});
		const subtitle: TextElement = createTextElement({
			id: "text-2",
			startTime: 1,
			content: "Secondary",
			linkedGroupId: "group-1",
		});

		const instantiated = instantiateTemplateElements({
			elements: [
				{ trackType: "text", element: title },
				{ trackType: "text", element: subtitle },
			],
			startTime: 10,
		});

		expect(instantiated[0]?.element.id).not.toBe(title.id);
		expect(instantiated[1]?.element.id).not.toBe(subtitle.id);
		expect(instantiated[0]?.element.linkedGroupId).toBe(instantiated[1]?.element.linkedGroupId);
		expect(instantiated.map((entry) => entry.element.startTime)).toEqual([10, 11]);
	});

	test("scene recipe payload is portable and preserves recipe defaults", () => {
		const sceneProject = {
			...baseProject,
			scenes: [
				{
					id: "scene-1",
					name: "Main",
					isMain: true,
					bookmarks: [],
					createdAt: new Date("2026-03-10T00:00:00.000Z"),
					updatedAt: new Date("2026-03-10T00:00:00.000Z"),
					tracks: [
						{
							id: "track-text",
							type: "text" as const,
							name: "Text",
							hidden: false,
							elements: [
								createTextElement({
									id: "scene-text-1",
									startTime: 3,
									content: "Intro",
									fontSize: 8,
								}),
							],
						},
					],
				},
			],
		};

		const payload = buildSceneRecipePayloadFromScene({
			project: sceneProject as never,
			sceneId: "scene-1",
		});

		expect(payload.elements[0]?.element.startTime).toBe(0);
		expect(payload.defaults?.captionStyleId).toBe("bold-center");
		expect(payload.defaults?.montageDefaults?.beatDivision).toBe(4);
	});

	test("project kit payload capture and apply are deterministic", () => {
		const payload = buildProjectKitPayload({
			project: baseProject as never,
		});

		expect(payload.brandKit?.primaryColor).toBe("#112233");
		expect(payload.captionStyleId).toBe("bold-center");
		expect(payload.montageDefaults?.beatDivision).toBe(4);

		const updated = applyProjectKitPayload({
			project: {
				...baseProject,
				settings: {
					...baseProject.settings,
					brandKit: undefined,
					overlayDefaults: undefined,
					audio: undefined,
					montageDefaults: undefined,
				},
				clipforge: {
					...baseProject.clipforge,
					activeCaptionStyleId: "clean-bottom",
				},
			} as never,
			payload,
		});

		expect(updated.settings.brandKit?.primaryColor).toBe("#112233");
		expect(updated.settings.overlayDefaults?.variantId).toBe("luxury");
		expect(updated.settings.audio?.masterVolume).toBe(0.9);
		expect(updated.settings.montageDefaults?.beatDivision).toBe(4);
		expect(updated.clipforge?.activeCaptionStyleId).toBe("bold-center");
	});

	test("project montage defaults resolve safely when unset", () => {
		expect(
			resolveProjectMontageDefaults({
				project: { ...baseProject, settings: { ...baseProject.settings, montageDefaults: undefined } } as never,
			}).beatDivision,
		).toBe(2);
	});
});
