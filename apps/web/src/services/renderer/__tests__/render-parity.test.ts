import { describe, expect, test } from "bun:test";
import {
	compareCanvasFrameParity,
	computeCanvasFrameHash,
} from "@/services/renderer/render-parity";

function createCanvas({
	width,
	height,
	data,
}: {
	width: number;
	height: number;
	data: Uint8ClampedArray;
}): HTMLCanvasElement {
	return {
		width,
		height,
		getContext: () =>
			({
				getImageData: () =>
					({
						data,
						width,
						height,
						colorSpace: "srgb",
					}) as unknown as ImageData,
			}) as unknown as Pick<CanvasRenderingContext2D, "getImageData">,
	} as unknown as HTMLCanvasElement;
}

describe("render parity", () => {
	test("hashes canvas frames deterministically", async () => {
		const canvas = createCanvas({
			width: 2,
			height: 2,
			data: new Uint8ClampedArray([
				255, 0, 0, 255, 0, 0, 0, 0,
				0, 255, 0, 255, 0, 0, 0, 0,
			]),
		});

		const hash = await computeCanvasFrameHash({ canvas });
		expect(hash.startsWith("2x2:")).toBe(true);
	});

	test("compares preview/export parity by frame hash", async () => {
		const previewCanvas = createCanvas({
			width: 1,
			height: 1,
			data: new Uint8ClampedArray([255, 255, 255, 255]),
		});
		const exportCanvas = createCanvas({
			width: 1,
			height: 1,
			data: new Uint8ClampedArray([255, 255, 255, 255]),
		});
		const mismatchCanvas = createCanvas({
			width: 1,
			height: 1,
			data: new Uint8ClampedArray([0, 0, 0, 255]),
		});

		const match = await compareCanvasFrameParity({
			previewCanvas,
			exportCanvas,
			time: 0,
		});
		const mismatch = await compareCanvasFrameParity({
			previewCanvas,
			exportCanvas: mismatchCanvas,
			time: 0.5,
		});

		expect(match.match).toBe(true);
		expect(mismatch.match).toBe(false);
		expect(mismatch.time).toBe(0.5);
	});
});
