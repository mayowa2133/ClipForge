import type { TimelineTrack } from "@/types/timeline";
import type { MediaAsset } from "@/types/assets";
import type { TBackground, TCanvasSize } from "@/types/project";
import { DEFAULT_BLUR_INTENSITY } from "@/constants/project-constants";
import { getElementPlaybackRate, isMainTrack } from "@/lib/timeline";
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

		for (const element of elements) {
			if (element.type === "video") {
				layers.push({
					id: element.id,
					zIndex: zIndex++,
					kind: "video",
					startTime: element.startTime,
					duration: element.duration,
					trimStart: element.trimStart,
					trimEnd: element.trimEnd,
					hidden: false,
					payload: {
						mediaId: element.mediaId,
						playbackRate: getElementPlaybackRate({ element }),
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
					zIndex: zIndex++,
					kind: "image",
					startTime: element.startTime,
					duration: element.duration,
					trimStart: element.trimStart,
					trimEnd: element.trimEnd,
					hidden: false,
					payload: {
						mediaId: element.mediaId,
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
						transform: element.transform,
						opacity: element.opacity,
						blendMode: element.blendMode,
					},
				});
			}
		}
	}

	return {
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
