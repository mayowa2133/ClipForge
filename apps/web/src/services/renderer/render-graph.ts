import type { TimelineTrack } from "@/types/timeline";
import type { MediaAsset } from "@/types/assets";
import type { TBackground, TCanvasSize } from "@/types/project";
import { DEFAULT_BLUR_INTENSITY } from "@/constants/project-constants";
import {
	applyVersionOverridesToTracks,
	getElementPlaybackRate,
	getVersionCanvasSize,
	isMainTrack,
} from "@/lib/timeline";
import { buildProjectAssemblyTracks, getProjectDurationFromScenes } from "@/lib/scenes";
import type { TScene } from "@/types/timeline";
import type { ProjectVersionTarget, TProject } from "@/types/project";
import { resolveStickerId } from "@/lib/stickers";
import type { RenderGraph, RenderLayer } from "./types";

const PREVIEW_MAX_IMAGE_SIZE = 2048;

export type BuildRenderGraphParams = {
	canvasSize: TCanvasSize;
	tracks: TimelineTrack[];
	mediaAssets: MediaAsset[];
	duration: number;
	background: TBackground;
	isPreview?: boolean;
	scope?: "scene" | "project";
};

export function buildRenderGraph(params: BuildRenderGraphParams): RenderGraph {
	const { tracks, duration, canvasSize, background } = params;
	const visibleTracks = tracks.filter(
		(track) => !("hidden" in track && track.hidden),
	);

	const orderedTracksTopToBottom = [
		...visibleTracks.filter((track) => !isMainTrack(track)),
		...visibleTracks.filter((track) => isMainTrack(track)),
	];
	const orderedTracksBottomToTop = orderedTracksTopToBottom.slice().reverse();

	const layers: RenderLayer[] = [];
	let zIndex = 0;

	for (const track of orderedTracksBottomToTop) {
		const elements = track.elements
			.filter((element) => !("hidden" in element && element.hidden))
			.slice()
			.sort((a, b) => {
				if (a.startTime !== b.startTime) return a.startTime - b.startTime;
				return a.id.localeCompare(b.id);
			});

		const previousVisualLayerIdByElementId = new Map<string, string | null>();
		if (track.type === "video") {
			let previousVisualElement: (typeof elements)[number] | null = null;
			for (const element of elements) {
				if (element.type === "video" || element.type === "image") {
					previousVisualLayerIdByElementId.set(
						element.id,
						previousVisualElement?.id ?? null,
					);
					previousVisualElement = element;
				}
			}
		}

		for (const element of elements) {
			if (element.type === "video") {
				layers.push({
					id: element.id,
					trackId: track.id,
					zIndex: zIndex++,
					kind: "video",
					startTime: element.startTime,
					duration: element.duration,
					trimStart: element.trimStart,
					trimEnd: element.trimEnd,
					hidden: false,
					previousVisualLayerId:
						previousVisualLayerIdByElementId.get(element.id) ?? null,
					payload: {
						mediaId: element.mediaId,
						playbackRate: getElementPlaybackRate({ element }),
						keyframes: element.keyframes ?? null,
						transitionIn: element.transitionIn ?? null,
						adjustments: element.adjustments ?? null,
						effects: element.effects ?? null,
						transform: element.transform,
						opacity: element.opacity,
						blendMode: element.blendMode,
						muted: element.muted,
					},
				});
				continue;
			}

			if (element.type === "image") {
				layers.push({
					id: element.id,
					trackId: track.id,
					zIndex: zIndex++,
					kind: "image",
					startTime: element.startTime,
					duration: element.duration,
					trimStart: element.trimStart,
					trimEnd: element.trimEnd,
					hidden: false,
					previousVisualLayerId:
						previousVisualLayerIdByElementId.get(element.id) ?? null,
					payload: {
						mediaId: element.mediaId,
						keyframes: element.keyframes ?? null,
						transitionIn: element.transitionIn ?? null,
						adjustments: element.adjustments ?? null,
						effects: element.effects ?? null,
						transform: element.transform,
						opacity: element.opacity,
						blendMode: element.blendMode,
						...(params.isPreview ? { maxSourceSize: PREVIEW_MAX_IMAGE_SIZE } : {}),
					},
				});
				continue;
			}

			if (element.type === "text") {
				layers.push({
					id: element.id,
					trackId: track.id,
					zIndex: zIndex++,
					kind: "text",
					startTime: element.startTime,
					duration: element.duration,
					trimStart: element.trimStart,
					trimEnd: element.trimEnd,
					hidden: false,
					payload: {
						...element,
						canvasCenter: {
							x: canvasSize.width / 2,
							y: canvasSize.height / 2,
						},
						canvasHeight: canvasSize.height,
						textBaseline: "middle",
					},
				});
				continue;
			}

			if (element.type === "sticker") {
				layers.push({
					id: element.id,
					trackId: track.id,
					zIndex: zIndex++,
					kind: "sticker",
					startTime: element.startTime,
					duration: element.duration,
					trimStart: element.trimStart,
					trimEnd: element.trimEnd,
					hidden: false,
					payload: {
						stickerId: element.stickerId,
						sourceUrl: resolveStickerId({
							stickerId: element.stickerId,
							options: { width: 200, height: 200 },
						}),
						keyframes: element.keyframes ?? null,
						transitionIn: element.transitionIn ?? null,
						transform: element.transform,
						opacity: element.opacity,
						blendMode: element.blendMode,
					},
				});
			}
		}
	}

	return {
		scope: params.scope ?? "scene",
		duration,
		canvas: {
			width: canvasSize.width,
			height: canvasSize.height,
		},
		background:
			background.type === "blur"
				? {
					type: "blur",
					blurIntensity:
						background.blurIntensity ?? DEFAULT_BLUR_INTENSITY,
				  }
				: background,
		layers,
	};
}

export function graphHasVideo({ graph }: { graph: RenderGraph | null }): boolean {
	if (!graph) return false;
	return graph.layers.some((layer) => layer.kind === "video");
}

export function buildProjectRenderGraph({
	scenes,
	mediaAssets,
	canvasSize,
	background,
	isPreview = false,
	targetVersionId = null,
	project = null,
}: {
	scenes: TScene[];
	mediaAssets: MediaAsset[];
	canvasSize: TCanvasSize;
	background: TBackground;
	isPreview?: boolean;
	targetVersionId?: ProjectVersionTarget | null;
	project?: TProject | null;
}): RenderGraph {
	const targetCanvasSize =
		project && targetVersionId
			? getVersionCanvasSize({ project, targetVersionId })
			: canvasSize;
	return buildRenderGraph({
		tracks: applyVersionOverridesToTracks({
			tracks: buildProjectAssemblyTracks({ scenes }),
			targetVersionId,
		}),
		mediaAssets,
		duration: getProjectDurationFromScenes({ scenes }),
		canvasSize: targetCanvasSize,
		background,
		isPreview,
		scope: "project",
	});
}
