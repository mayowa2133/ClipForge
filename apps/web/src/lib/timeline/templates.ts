import {
	DEFAULT_PROJECT_AUDIO_SETTINGS,
	DEFAULT_PROJECT_BRAND_KIT,
	DEFAULT_PROJECT_MONTAGE_DEFAULTS,
	DEFAULT_PROJECT_OVERLAY_DEFAULTS,
} from "@/constants/project-constants";
import type { CaptionStyleTemplate } from "@/types/clipforge";
import type {
	TProject,
} from "@/types/project";
import type {
	ImageElement,
	StickerElement,
	TextElement,
	TimelineElement,
	TrackType,
} from "@/types/timeline";
import type {
	ComponentTemplatePayload,
	CreatorTemplate,
	ProjectKitPayload,
	ProjectMontageDefaults,
	SceneRecipePayload,
	SceneRecipePresetId,
	TemplateDefaultsPatch,
	TemplateElementSnapshot,
	TemplateVisualElement,
} from "@/types/templates";
import { generateUUID } from "@/utils/id";
import {
	buildGraphicsPresetElements,
	buildSocialOverlayPresetElements,
} from "./graphics";

type InsertableTemplateTrackType = Extract<TrackType, "text" | "video" | "sticker">;

export interface BuiltInSceneRecipeDefinition {
	id: SceneRecipePresetId;
	label: string;
	description: string;
	defaultDuration: number;
	buildPayload: (args: {
		project: TProject | null;
	}) => SceneRecipePayload;
}

export function resolveProjectMontageDefaults({
	project,
}: {
	project: TProject | null;
}): ProjectMontageDefaults {
	return {
		...DEFAULT_PROJECT_MONTAGE_DEFAULTS,
		...(project?.settings.montageDefaults ?? {}),
	};
}

export function isTemplateSupportedElement({
	element,
}: {
	element: TimelineElement;
}): boolean {
	if (element.type === "image" || element.type === "sticker") {
		return true;
	}
	return element.type === "text" && element.role !== "caption";
}

export function buildComponentTemplatePayload({
	elementsWithTracks,
}: {
	elementsWithTracks: Array<{
		track: { type: TrackType };
		element: TimelineElement;
	}>;
}): ComponentTemplatePayload {
	const snapshots = buildTemplateElementSnapshots({ elementsWithTracks });
	return {
		elements: snapshots,
		duration: getSnapshotDuration({ elements: snapshots }),
	};
}

export function buildSceneRecipePayloadFromScene({
	project,
	sceneId,
}: {
	project: TProject;
	sceneId: string;
}): SceneRecipePayload {
	const scene = project.scenes.find((candidate) => candidate.id === sceneId);
	if (!scene) {
		throw new Error("Scene not found.");
	}
	const snapshots = buildTemplateElementSnapshots({
		elementsWithTracks: scene.tracks.flatMap((track) =>
			track.elements.map((element) => ({ track, element })),
		),
	});
	return {
		elements: snapshots,
		duration: getSnapshotDuration({ elements: snapshots }),
		defaults: {
			captionStyleId: project.clipforge?.activeCaptionStyleId ?? null,
			montageDefaults: resolveProjectMontageDefaults({ project }),
		},
	};
}

export function buildProjectKitPayload({
	project,
	includeBrand = true,
	includeCaptionStyle = true,
	includeOverlayDefaults = true,
	includeAudioMix = true,
	includeMontageDefaults = true,
}: {
	project: TProject;
	includeBrand?: boolean;
	includeCaptionStyle?: boolean;
	includeOverlayDefaults?: boolean;
	includeAudioMix?: boolean;
	includeMontageDefaults?: boolean;
}): ProjectKitPayload {
	const activeCaptionStyleId = project.clipforge?.activeCaptionStyleId ?? null;
	const activeCaptionStyle =
		activeCaptionStyleId && project.clipforge?.captionStylesById
			? project.clipforge.captionStylesById[activeCaptionStyleId] ?? null
			: null;

	return {
		brandKit: includeBrand ? { ...DEFAULT_PROJECT_BRAND_KIT, ...(project.settings.brandKit ?? {}) } : null,
		overlayDefaults: includeOverlayDefaults
			? { ...DEFAULT_PROJECT_OVERLAY_DEFAULTS, ...(project.settings.overlayDefaults ?? {}) }
			: null,
		audio: includeAudioMix
			? { ...DEFAULT_PROJECT_AUDIO_SETTINGS, ...(project.settings.audio ?? {}) }
			: null,
		captionStyleId: includeCaptionStyle ? activeCaptionStyleId : null,
		captionStyle: includeCaptionStyle && activeCaptionStyle ? { ...activeCaptionStyle } : null,
		montageDefaults: includeMontageDefaults
			? resolveProjectMontageDefaults({ project })
			: null,
	};
}

export function applyProjectKitPayload({
	project,
	payload,
}: {
	project: TProject;
	payload: ProjectKitPayload;
}): TProject {
	return {
		...project,
		settings: {
			...project.settings,
			...(payload.brandKit ? { brandKit: { ...payload.brandKit } } : {}),
			...(payload.overlayDefaults
				? { overlayDefaults: { ...payload.overlayDefaults } }
				: {}),
			...(payload.audio ? { audio: { ...payload.audio } } : {}),
			...(payload.montageDefaults
				? { montageDefaults: { ...payload.montageDefaults } }
				: {}),
		},
		clipforge: project.clipforge
			? {
					...project.clipforge,
					captionStylesById:
						payload.captionStyle && payload.captionStyleId
							? {
									...project.clipforge.captionStylesById,
									[payload.captionStyleId]: payload.captionStyle,
								}
							: project.clipforge.captionStylesById,
					activeCaptionStyleId:
						payload.captionStyleId ?? project.clipforge.activeCaptionStyleId,
				}
			: project.clipforge,
	};
}

export function instantiateTemplateElements({
	elements,
	startTime,
	duration,
}: {
	elements: TemplateElementSnapshot[];
	startTime: number;
	duration?: number;
}): Array<{ trackType: InsertableTemplateTrackType; element: TemplateVisualElement }> {
	const baseDuration = getSnapshotDuration({ elements }) || 1;
	const scale = duration && duration > 0 ? duration / baseDuration : 1;
	const idMap = new Map<string, string>();
	const linkedGroupMap = new Map<string, string>();

	return elements.map((snapshot) => {
		const nextId = generateUUID();
		idMap.set(snapshot.element.id, nextId);
		const linkedGroupId = snapshot.element.linkedGroupId ?? null;
		const nextLinkedGroupId = linkedGroupId
			? (linkedGroupMap.get(linkedGroupId) ?? (() => {
					const created = generateUUID();
					linkedGroupMap.set(linkedGroupId, created);
					return created;
				})())
			: null;
		const nextElement = {
			...snapshot.element,
			id: nextId,
			startTime: startTime + snapshot.element.startTime * scale,
			duration: snapshot.element.duration * scale,
			linkedGroupId: nextLinkedGroupId,
			keyframes: scaleKeyframes({
				keyframes: snapshot.element.keyframes ?? null,
				scale,
			}),
			transitionIn: snapshot.element.transitionIn
				? {
						...snapshot.element.transitionIn,
						duration: Math.min(
							snapshot.element.duration * scale,
							snapshot.element.transitionIn.duration * scale,
						),
					}
				: snapshot.element.transitionIn,
		} as TemplateVisualElement;
		return {
			trackType: snapshot.trackType,
			element: nextElement,
		};
	});
}

export const BUILT_IN_SCENE_RECIPES: BuiltInSceneRecipeDefinition[] = [
	{
		id: "intro-title",
		label: "Intro title",
		description: "Large opener with a subtitle and intro timing.",
		defaultDuration: 3,
		buildPayload: ({ project }) => ({
			elements: normalizeGeneratedElements({
				elements: buildGraphicsPresetElements({
					project,
					presetId: "title-clean",
					motionPresetId: "fade-up",
					startTime: 0,
					duration: 3,
				}),
			}),
			duration: 3,
			defaults: {
				captionStyleId: project?.clipforge?.activeCaptionStyleId ?? null,
				montageDefaults: resolveProjectMontageDefaults({ project }),
			},
		}),
	},
	{
		id: "chapter-break",
		label: "Chapter break",
		description: "Section card for story pivots or chapter bumps.",
		defaultDuration: 3,
		buildPayload: ({ project }) => ({
			elements: normalizeGeneratedElements({
				elements: buildSocialOverlayPresetElements({
					project,
					presetId: "chapter-card",
					startTime: 0,
					duration: 3,
				}),
			}),
			duration: 3,
			defaults: {
				captionStyleId: project?.clipforge?.activeCaptionStyleId ?? null,
				montageDefaults: resolveProjectMontageDefaults({ project }),
			},
		}),
	},
	{
		id: "location-section",
		label: "Location section",
		description: "Quick location + sublabel card for travel or lifestyle sections.",
		defaultDuration: 2,
		buildPayload: ({ project }) => ({
			elements: normalizeGeneratedElements({
				elements: buildSocialOverlayPresetElements({
					project,
					presetId: "location-tag",
					startTime: 0,
					duration: 2,
				}),
			}),
			duration: 2,
			defaults: {
				montageDefaults: resolveProjectMontageDefaults({ project }),
			},
		}),
	},
	{
		id: "cta-outro",
		label: "CTA outro",
		description: "Reusable outro card for subscribe or follow callouts.",
		defaultDuration: 2.5,
		buildPayload: ({ project }) => ({
			elements: normalizeGeneratedElements({
				elements: buildGraphicsPresetElements({
					project,
					presetId: "cta-follow",
					motionPresetId: "pop-in",
					startTime: 0,
					duration: 2.5,
				}),
			}),
			duration: 2.5,
			defaults: {
				montageDefaults: resolveProjectMontageDefaults({ project }),
			},
		}),
	},
	{
		id: "vlog-beat-section",
		label: "Vlog beat section",
		description: "Starter overlay for a rhythmic vlog beat or routine card.",
		defaultDuration: 2,
		buildPayload: ({ project }) => ({
			elements: normalizeGeneratedElements({
				elements: buildSocialOverlayPresetElements({
					project,
					presetId: "routine-label",
					startTime: 0,
					duration: 2,
				}),
			}),
			duration: 2,
			defaults: {
				montageDefaults: resolveProjectMontageDefaults({ project }),
			},
		}),
	},
];

export function getBuiltInSceneRecipeDefinition({
	recipeId,
}: {
	recipeId: SceneRecipePresetId;
}): BuiltInSceneRecipeDefinition | null {
	return BUILT_IN_SCENE_RECIPES.find((recipe) => recipe.id === recipeId) ?? null;
}

function buildTemplateElementSnapshots({
	elementsWithTracks,
}: {
	elementsWithTracks: Array<{
		track: { type: TrackType };
		element: TimelineElement;
	}>;
}): TemplateElementSnapshot[] {
	const supported = elementsWithTracks.filter(({ element, track }) =>
		(track.type === "text" || track.type === "video" || track.type === "sticker") &&
		isTemplateSupportedElement({ element }),
	);
	if (supported.length === 0) {
		throw new Error("Select text, image, or sticker elements to save as a reusable template.");
	}
	const minStartTime = Math.min(...supported.map(({ element }) => element.startTime));
	return supported
		.map(({ track, element }) => ({
			trackType: track.type as InsertableTemplateTrackType,
			element: {
				...element,
				startTime: element.startTime - minStartTime,
			} as TemplateVisualElement,
		}))
		.sort((left, right) => left.element.startTime - right.element.startTime);
}

function normalizeGeneratedElements({
	elements,
}: {
	elements: Array<TextElement | ImageElement | StickerElement | Omit<TextElement, "id"> | Omit<ImageElement, "id"> | Omit<StickerElement, "id">>;
}): TemplateElementSnapshot[] {
	const withIds = elements.map((element) => ({
		...element,
		id: "id" in element && typeof element.id === "string" ? element.id : generateUUID(),
	})) as TemplateVisualElement[];
	const minStartTime = Math.min(...withIds.map((element) => element.startTime));
	return withIds.map((element) => ({
		trackType: element.type === "image" ? "video" : element.type,
		element: {
			...element,
			startTime: element.startTime - minStartTime,
		} as TemplateVisualElement,
	}));
}

function getSnapshotDuration({
	elements,
}: {
	elements: TemplateElementSnapshot[];
}): number {
	if (elements.length === 0) return 0;
	return Math.max(
		...elements.map((snapshot) => snapshot.element.startTime + snapshot.element.duration),
	);
}

function scaleKeyframes({
	keyframes,
	scale,
}: {
	keyframes: TextElement["keyframes"] | ImageElement["keyframes"] | StickerElement["keyframes"] | null;
	scale: number;
}) {
	if (!keyframes) return keyframes;
	return Object.fromEntries(
		Object.entries(keyframes).map(([property, values]) => [
			property,
			values?.map((keyframe: { time: number; value: number }) => ({
				...keyframe,
				time: keyframe.time * scale,
			})) ?? [],
		]),
	) as typeof keyframes;
}

export function getSupportedComponentElements({
	elements,
}: {
	elements: Array<{ track: { type: TrackType }; element: TimelineElement }>;
}) {
	return buildTemplateElementSnapshots({ elementsWithTracks: elements });
}
