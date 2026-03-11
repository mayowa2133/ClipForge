import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EditorCore } from "@/core";
import { CommandManager } from "@/core/managers/commands";
import { SelectionManager } from "@/core/managers/selection-manager";
import { TimelineManager } from "@/core/managers/timeline-manager";
import { ANIMATION_SFX_PAIRINGS, getAnimationSfxPairingsForTarget } from "@/lib/timeline";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type { AudioTrack, TextElement, TextTrack, TimelineTrack } from "@/types/timeline";

type FakeEditor = {
	command: CommandManager;
	timeline: TimelineManager;
	selection: SelectionManager;
	scenes: {
		getActiveScene: () => TProject["scenes"][number] | undefined;
		updateSceneTracks: ({ tracks }: { tracks: TimelineTrack[] }) => void;
	};
	project: {
		getActive: () => TProject;
		setActiveProject: ({ project }: { project: TProject }) => void;
	};
	media: {
		getAssets: () => MediaAsset[];
		addMediaAsset: ReturnType<typeof mock>;
	};
	save: {
		markDirty: () => void;
	};
};

const originalGetInstance = EditorCore.getInstance;
const originalFetch = globalThis.fetch;

let currentEditor: FakeEditor | null = null;

function createTextElement(overrides: Partial<TextElement> = {}): TextElement {
	return {
		id: overrides.id ?? "text-1",
		type: "text",
		name: overrides.name ?? "Text",
		startTime: overrides.startTime ?? 1,
		duration: overrides.duration ?? 2,
		trimStart: overrides.trimStart ?? 0,
		trimEnd: overrides.trimEnd ?? 0,
		role: overrides.role ?? "text",
		captionTiming: overrides.captionTiming ?? null,
		overlayMeta: overrides.overlayMeta ?? null,
		content: overrides.content ?? "Text",
		fontSize: overrides.fontSize ?? 8,
		fontFamily: overrides.fontFamily ?? "DM Sans",
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
				position: { x: 0, y: 0 },
				rotate: 0,
			},
		opacity: overrides.opacity ?? 1,
		blendMode: overrides.blendMode,
		versionOverrides: overrides.versionOverrides ?? null,
	};
}

function createProjectFixture(): TProject {
	return {
		metadata: {
			id: "project-animation-sfx",
			name: "Animation SFX",
			duration: 6,
			createdAt: new Date("2026-03-11T00:00:00.000Z"),
			updatedAt: new Date("2026-03-11T00:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-main",
				name: "Main scene",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-03-11T00:00:00.000Z"),
				updatedAt: new Date("2026-03-11T00:00:00.000Z"),
				tracks: [
					{
						id: "text-track",
						type: "text",
						name: "Text",
						hidden: false,
						elements: [
							createTextElement({
								id: "overlay-primary",
								content: "Primary",
								linkedGroupId: "overlay-group",
								overlayMeta: {
									kind: "timestamp-card",
									variantId: "clean-vlog",
									slot: "primary",
								},
							}),
							createTextElement({
								id: "overlay-secondary",
								content: "Secondary",
								startTime: 1.05,
								linkedGroupId: "overlay-group",
								overlayMeta: {
									kind: "timestamp-card",
									variantId: "clean-vlog",
									slot: "secondary",
								},
							}),
							createTextElement({
								id: "caption-1",
								role: "caption",
								content: "Caption",
								startTime: 3,
							}),
						],
					} satisfies TextTrack,
					{
						id: "audio-track",
						type: "audio",
						name: "Audio",
						muted: false,
						volume: 1,
						elements: [],
					} satisfies AudioTrack,
				],
			},
		],
		currentSceneId: "scene-main",
		settings: {
			fps: 30,
			canvasSize: { width: 1080, height: 1920 },
			background: { type: "color", color: "#000000" },
			audio: {
				masterVolume: 1,
				duckingEnabled: false,
				duckingAmount: 0.35,
				duckingAttackMs: 120,
				duckingReleaseMs: 180,
			},
			versionPack: {
				targets: [{ id: "9:16", enabled: true, canvasSize: { width: 1080, height: 1920 } }],
				activeTargetId: "9:16",
			},
			brandKit: {
				primaryColor: "#1da1f2",
				secondaryColor: "#ffffff",
				accentColor: "#f5f5f5",
				titleFontFamily: "DM Sans",
				bodyFontFamily: "DM Sans",
				logoMediaId: null,
			},
			overlayDefaults: {
				variantId: "clean-vlog",
				motionPresetId: "fade-up",
				safeMarginPreset: "standard",
			},
		},
		version: 18,
	};
}

function createFakeEditor() {
	let activeProject = createProjectFixture();
	let mediaAssets: MediaAsset[] = [];

	const editor = {} as FakeEditor;
	editor.command = new CommandManager();
	editor.scenes = {
		getActiveScene: () =>
			activeProject.scenes.find((scene) => scene.id === activeProject.currentSceneId),
		updateSceneTracks: ({ tracks }) => {
			activeProject = {
				...activeProject,
				scenes: activeProject.scenes.map((scene) =>
					scene.id === activeProject.currentSceneId ? { ...scene, tracks } : scene,
				),
			};
		},
	};
	editor.project = {
		getActive: () => activeProject,
		setActiveProject: ({ project }) => {
			activeProject = project;
		},
	};
	editor.media = {
		getAssets: () => mediaAssets,
		addMediaAsset: mock(
			async ({
				asset,
			}: {
				projectId: string;
				asset: Partial<MediaAsset> & {
					name: string;
					type: MediaAsset["type"];
					file: File;
				};
			}) => {
				const nextAsset = {
					id: asset.libraryItemId ?? `asset-${mediaAssets.length + 1}`,
					name: asset.name,
					type: asset.type,
					file: asset.file,
					duration: asset.duration,
					url: asset.url,
					libraryItemId: asset.libraryItemId,
					musicSourceType: asset.musicSourceType,
					rightsProfile: asset.rightsProfile,
					allowedDestinations: asset.allowedDestinations,
					attributionRequired: asset.attributionRequired,
					attributionText: asset.attributionText,
					sourceLabel: asset.sourceLabel,
					sourceUrl: asset.sourceUrl,
					compatibility: asset.compatibility,
					beatAnalysis: asset.beatAnalysis,
				} as MediaAsset;
				mediaAssets = [...mediaAssets, nextAsset];
				return nextAsset;
			},
		),
	};
	editor.save = { markDirty: () => {} };
	editor.timeline = new TimelineManager(editor as never);
	editor.selection = new SelectionManager(editor as never);

	return {
		editor,
		getProject: () => activeProject,
		getAssets: () => mediaAssets,
	};
}

beforeEach(() => {
	(EditorCore as unknown as { getInstance: () => unknown }).getInstance = () => currentEditor!;
	globalThis.fetch = mock(
		async () =>
			new Response(new Blob(["sfx"], { type: "audio/wav" }), {
				status: 200,
			}),
	) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
	(EditorCore as unknown as { getInstance: typeof originalGetInstance }).getInstance =
		originalGetInstance;
	globalThis.fetch = originalFetch;
	currentEditor = null;
});

describe("animation SFX", () => {
	test("registry resolves pairings for graphics and captions", () => {
		expect(ANIMATION_SFX_PAIRINGS.map((pairing) => pairing.id)).toEqual([
			"typing-clean",
			"typing-soft",
			"cursor-blink",
			"caption-pop-clean",
			"caption-pop-bright",
			"air-fahhh-soft",
			"air-fahhh-bold",
			"whoosh-pop",
		]);

		expect(
			getAnimationSfxPairingsForTarget({ targetKind: "graphics" }).map(
				(pairing) => pairing.id,
			),
		).toEqual(["air-fahhh-soft", "air-fahhh-bold", "whoosh-pop"]);
		expect(
			getAnimationSfxPairingsForTarget({ targetKind: "caption" }).map(
				(pairing) => pairing.id,
			),
		).toContain("typing-clean");
	});

	test("applying a graphics pairing inserts a single grouped SFX clip", async () => {
		const harness = createFakeEditor();
		currentEditor = harness.editor;

		await harness.editor.timeline.applyAnimationSfxPairing({
			pairingId: "whoosh-pop",
			targetElementIds: ["overlay-primary", "overlay-secondary"],
		});

		const audioTrack = harness.getProject().scenes[0]?.tracks[1] as AudioTrack;
		expect(audioTrack.elements).toHaveLength(2);
		expect(audioTrack.elements.every((element) => element.role === "sfx")).toBe(true);
		expect(
			audioTrack.elements.every(
				(element) =>
					element.animationSfxSync?.pairingId === "whoosh-pop" &&
					element.animationSfxSync?.targetAnchorId === "overlay-group" &&
					element.animationSfxSync?.targetKind === "graphics",
			),
		).toBe(true);
	});

	test("reapplying a pairing replaces prior pairing-generated SFX without touching manual SFX", async () => {
		const harness = createFakeEditor();
		currentEditor = harness.editor;

		await harness.editor.timeline.applyAnimationSfxPairing({
			pairingId: "air-fahhh-soft",
			targetElementIds: ["overlay-primary", "overlay-secondary"],
		});

		const audioTrack = harness.getProject().scenes[0]?.tracks[1] as AudioTrack;
		audioTrack.elements.push({
			id: "manual-sfx",
			type: "audio",
			name: "Manual",
			mediaId: "manual-media",
			sourceType: "upload",
			startTime: 0.5,
			duration: 0.2,
			trimStart: 0,
			trimEnd: 0,
			volume: 1,
			muted: false,
			playbackRate: 1,
			linkedGroupId: null,
			fadeInDuration: 0,
			fadeOutDuration: 0,
			role: "sfx",
			normalizationGainDb: null,
			animationSfxSync: null,
		});

		await harness.editor.timeline.applyAnimationSfxPairing({
			pairingId: "whoosh-pop",
			targetElementIds: ["overlay-primary", "overlay-secondary"],
		});

		const nextAudioTrack = harness.getProject().scenes[0]?.tracks[1] as AudioTrack;
		expect(nextAudioTrack.elements.some((element) => element.id === "manual-sfx")).toBe(true);
		expect(
			nextAudioTrack.elements.filter(
				(element) => element.animationSfxSync?.targetAnchorId === "overlay-group",
			),
		).toHaveLength(2);
		expect(
			nextAudioTrack.elements.some(
				(element) => element.animationSfxSync?.pairingId === "air-fahhh-soft",
			),
		).toBe(false);
	});

	test("clearing a caption pairing removes only pairing-generated caption SFX", async () => {
		const harness = createFakeEditor();
		currentEditor = harness.editor;

		await harness.editor.timeline.applyAnimationSfxPairing({
			pairingId: "caption-pop-clean",
			targetElementIds: ["caption-1"],
		});
		harness.editor.timeline.clearAnimationSfxPairing({
			targetElementIds: ["caption-1"],
			expectedKind: "caption",
		});

		const audioTrack = harness
			.getProject()
			.scenes[0]?.tracks.find((track): track is AudioTrack => track.type === "audio");
		expect(
			audioTrack?.elements.some(
				(element) => element.animationSfxSync?.targetAnchorId === "caption-1",
			) ?? false,
		).toBe(false);
	});
});
