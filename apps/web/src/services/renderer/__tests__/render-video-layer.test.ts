import { describe, expect, test } from "bun:test";
import {
	getVideoSampleTime,
	renderVideoLayer,
} from "@/services/renderer/backends/helpers/render-video-layer";
import type { RenderVideoFrameProvider } from "@/services/renderer/video-frame-provider";

describe("renderVideoLayer", () => {
	test("computes media sample time from timeline time and trim", () => {
		expect(
			getVideoSampleTime({
				layer: { startTime: 2.5, trimStart: 0.75 },
				time: 4,
			}),
		).toBeCloseTo(2.25);
	});

	test("requests the correct frame and draws it onto the target context", async () => {
		const calls: Array<{ mediaId: string; time: number }> = [];
		const provider: RenderVideoFrameProvider = {
			getFrameAt: async ({ mediaId, time }) => {
				calls.push({ mediaId, time });
				return {
					width: 640,
					height: 360,
				} as unknown as CanvasImageSource;
			},
			clearVideo: () => {},
			clearAll: () => {},
			dispose: () => {},
		};

		const drawCalls: Array<[CanvasImageSource, number, number, number, number]> = [];
		const ctx = {
			save: () => {},
			restore: () => {},
			translate: () => {},
			rotate: () => {},
			drawImage: (
				source: CanvasImageSource,
				x: number,
				y: number,
				width: number,
				height: number,
			) => {
				drawCalls.push([source, x, y, width, height]);
			},
			globalCompositeOperation: "source-over",
			globalAlpha: 1,
		} as unknown as CanvasRenderingContext2D;

		await renderVideoLayer({
			ctx,
			layer: {
				id: "video-1",
				zIndex: 0,
				kind: "video",
				startTime: 1,
				duration: 4,
				trimStart: 0.5,
				trimEnd: 0,
				hidden: false,
				payload: {
					mediaId: "media-1",
					transform: {
						scale: 1,
						position: { x: 0, y: 0 },
						rotate: 0,
					},
					opacity: 1,
				},
			},
			time: 2,
			canvasWidth: 1080,
			canvasHeight: 1920,
			videoFrameProvider: provider,
		});

		expect(calls).toEqual([{ mediaId: "media-1", time: 1.5 }]);
		expect(drawCalls).toHaveLength(1);
	});
});
