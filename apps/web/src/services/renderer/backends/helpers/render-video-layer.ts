import type { RenderVideoFrameProvider } from "@/services/renderer/video-frame-provider";
import { renderFinishedVisualLayer } from "@/services/renderer/visual-finishing";

type ResolvedVideoLayer = {
	id: string;
	zIndex: number;
	kind: "video";
	startTime: number;
	duration: number;
	trimStart: number;
	trimEnd: number;
	hidden: boolean;
	payload: {
		mediaId: string;
		playbackRate: number;
		file?: File;
		transform: {
			scale: number;
			position: { x: number; y: number };
			rotate: number;
		};
		adjustments?: import("@/types/timeline").VisualAdjustments | null;
		effects?: import("@/types/timeline").VisualEffect[] | null;
		opacity: number;
		blendMode?: string;
		muted?: boolean;
	};
};

export function getVideoSampleTime({
	layer,
	time,
}: {
	layer: Pick<ResolvedVideoLayer, "startTime" | "trimStart" | "payload">;
	time: number;
}): number {
	return Math.max(
		0,
		(time - layer.startTime) * Math.max(0.25, layer.payload.playbackRate) +
			layer.trimStart,
	);
}

export async function renderVideoLayer({
	ctx,
	layer,
	time,
	canvasWidth,
	canvasHeight,
	videoFrameProvider,
	transformOverride,
	opacityOverride,
	sampleTimeOverride,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	layer: ResolvedVideoLayer;
	time: number;
	canvasWidth: number;
	canvasHeight: number;
	videoFrameProvider: RenderVideoFrameProvider;
	transformOverride?: ResolvedVideoLayer["payload"]["transform"];
	opacityOverride?: number;
	sampleTimeOverride?: number;
}): Promise<void> {
	if (time < layer.startTime || time >= layer.startTime + layer.duration) {
		return;
	}

	const sourceTime =
		sampleTimeOverride ?? getVideoSampleTime({ layer, time });
	const source = await videoFrameProvider.getFrameAt({
		mediaId: layer.payload.mediaId,
		file: layer.payload.file,
		time: sourceTime,
	});
	if (!source) return;

	const sourceWidth =
		("displayWidth" in source && typeof source.displayWidth === "number"
			? source.displayWidth
			: "videoWidth" in source && typeof source.videoWidth === "number"
				? source.videoWidth
				: "width" in source && typeof source.width === "number"
					? source.width
					: canvasWidth) || canvasWidth;
	const sourceHeight =
		("displayHeight" in source && typeof source.displayHeight === "number"
			? source.displayHeight
			: "videoHeight" in source && typeof source.videoHeight === "number"
				? source.videoHeight
				: "height" in source && typeof source.height === "number"
					? source.height
					: canvasHeight) || canvasHeight;

	renderFinishedVisualLayer({
		ctx,
		canvasWidth,
		canvasHeight,
		source,
		sourceWidth,
		sourceHeight,
		transform: transformOverride ?? layer.payload.transform,
		opacity: opacityOverride ?? layer.payload.opacity,
		blendMode: (layer.payload.blendMode as never) ?? undefined,
		adjustments: layer.payload.adjustments ?? null,
		effects: layer.payload.effects ?? null,
	});
}
