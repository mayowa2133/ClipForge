import {
	DEFAULT_VISUAL_ADJUSTMENTS,
	adjustmentsAreDefault,
	normalizeVisualEffects,
	type FinishableVisualElement,
} from "@/lib/timeline";
import type { BlendMode, Transform } from "@/types/rendering";
import type { VisualAdjustments, VisualEffect } from "@/types/timeline";
import { drawVisualToContext } from "./backends/helpers/render-visual";

export function renderFinishedVisualLayer({
	ctx,
	canvasWidth,
	canvasHeight,
	source,
	sourceWidth,
	sourceHeight,
	transform,
	opacity,
	blendMode,
	adjustments,
	effects,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	canvasWidth: number;
	canvasHeight: number;
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
	adjustments?: VisualAdjustments | null;
	effects?: VisualEffect[] | null;
}): void {
	if (opacity <= 0) return;
	const normalizedEffects = normalizeVisualEffects({ effects });
	const effectiveAdjustments = adjustments ?? DEFAULT_VISUAL_ADJUSTMENTS;
	const hasAdjustments = !adjustmentsAreDefault({ adjustments: effectiveAdjustments });
	const hasEffects = Boolean(normalizedEffects?.length);

	if (!hasAdjustments && !hasEffects) {
		drawVisualToContext({
			ctx,
			canvasWidth,
			canvasHeight,
			source,
			sourceWidth,
			sourceHeight,
			transform,
			opacity,
			blendMode,
		});
		return;
	}

	const layerCanvas = createScratchCanvas({ width: canvasWidth, height: canvasHeight });
	const layerCtx = getScratchContext({ canvas: layerCanvas });
	drawVisualToContext({
		ctx: layerCtx,
		canvasWidth,
		canvasHeight,
		source,
		sourceWidth,
		sourceHeight,
		transform,
		opacity: 1,
	});

	const finishedCanvas = applyVisualFinishing({
		canvas: layerCanvas,
		adjustments: effectiveAdjustments,
		effects: normalizedEffects,
	});

	ctx.save();
	ctx.globalCompositeOperation = ((blendMode && blendMode !== "normal"
		? blendMode
		: "source-over") as GlobalCompositeOperation);
	ctx.globalAlpha = opacity;
	ctx.drawImage(finishedCanvas, 0, 0);
	ctx.restore();
}

export function applyVisualFinishing({
	canvas,
	adjustments,
	effects,
}: {
	canvas: OffscreenCanvas | HTMLCanvasElement;
	adjustments?: VisualAdjustments | null;
	effects?: VisualEffect[] | null;
}): OffscreenCanvas | HTMLCanvasElement {
	const normalizedEffects = normalizeVisualEffects({ effects });
	const effectiveAdjustments = adjustments ?? DEFAULT_VISUAL_ADJUSTMENTS;
	const hasAdjustments = !adjustmentsAreDefault({ adjustments: effectiveAdjustments });
	const hasEffects = Boolean(normalizedEffects?.length);
	if (!hasAdjustments && !hasEffects) {
		return canvas;
	}

	let current = canvas;

	if (hasAdjustments) {
		current = applyAdjustments({ canvas: current, adjustments: effectiveAdjustments });
	}

	for (const effect of normalizedEffects ?? []) {
		if (!effect.enabled) continue;
		switch (effect.kind) {
			case "blur":
				current = applyBlur({ canvas: current, radius: effect.radius });
				break;
			case "vignette":
				current = applyVignette({ canvas: current, intensity: effect.intensity });
				break;
			case "sharpen":
				current = applySharpen({ canvas: current, amount: effect.amount });
				break;
		}
	}

	return current;
}

export function hasFinishingState({
	element,
}: {
	element: Pick<FinishableVisualElement, "adjustments" | "effects">;
}): boolean {
	return (
		!adjustmentsAreDefault({ adjustments: element.adjustments ?? null }) ||
		Boolean(normalizeVisualEffects({ effects: element.effects })?.length)
	);
}

function applyAdjustments({
	canvas,
	adjustments,
}: {
	canvas: OffscreenCanvas | HTMLCanvasElement;
	adjustments: VisualAdjustments;
}): OffscreenCanvas | HTMLCanvasElement {
	const next = createScratchCanvas({ width: canvas.width, height: canvas.height });
	const nextCtx = getScratchContext({ canvas: next });
	const brightness = 1 + adjustments.exposure * 0.6;
	const contrast = 1 + adjustments.contrast * 0.8;
	const saturation = 1 + adjustments.saturation;
	nextCtx.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${Math.max(
		0,
		saturation,
	)})`;
	nextCtx.drawImage(canvas, 0, 0);
	nextCtx.filter = "none";

	const pixelCtx = getScratchContext({ canvas: next });
	const imageData = pixelCtx.getImageData(0, 0, next.width, next.height);
	const data = imageData.data;
	const temperature = adjustments.temperature * 45;
	const tint = adjustments.tint * 35;
	const highlights = adjustments.highlights * 30;
	const shadows = adjustments.shadows * 30;

	for (let index = 0; index < data.length; index += 4) {
		const alpha = data[index + 3];
		if (alpha === 0) continue;
		const r = data[index];
		const g = data[index + 1];
		const b = data[index + 2];
		const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		const shadowFactor = 1 - luminance / 255;
		const highlightFactor = luminance / 255;

		data[index] = clampChannel(
			r + temperature + highlights * highlightFactor - shadows * shadowFactor,
		);
		data[index + 1] = clampChannel(
			g + tint * 0.25 + shadows * shadowFactor * 0.2 - highlights * highlightFactor * 0.2,
		);
		data[index + 2] = clampChannel(
			b - temperature + tint + shadows * shadowFactor - highlights * highlightFactor,
		);
	}

	pixelCtx.putImageData(imageData, 0, 0);
	return next;
}

function applyBlur({
	canvas,
	radius,
}: {
	canvas: OffscreenCanvas | HTMLCanvasElement;
	radius: number;
}): OffscreenCanvas | HTMLCanvasElement {
	const next = createScratchCanvas({ width: canvas.width, height: canvas.height });
	const nextCtx = getScratchContext({ canvas: next });
	nextCtx.filter = `blur(${radius}px)`;
	nextCtx.drawImage(canvas, 0, 0);
	nextCtx.filter = "none";
	return next;
}

function applyVignette({
	canvas,
	intensity,
}: {
	canvas: OffscreenCanvas | HTMLCanvasElement;
	intensity: number;
}): OffscreenCanvas | HTMLCanvasElement {
	const next = createScratchCanvas({ width: canvas.width, height: canvas.height });
	const nextCtx = getScratchContext({ canvas: next });
	nextCtx.drawImage(canvas, 0, 0);
	const gradient = nextCtx.createRadialGradient(
		next.width / 2,
		next.height / 2,
		Math.min(next.width, next.height) * 0.2,
		next.width / 2,
		next.height / 2,
		Math.max(next.width, next.height) * 0.65,
	);
	gradient.addColorStop(0, "rgba(0,0,0,0)");
	gradient.addColorStop(1, `rgba(0,0,0,${Math.max(0, Math.min(1, intensity)) * 0.8})`);
	nextCtx.fillStyle = gradient;
	nextCtx.fillRect(0, 0, next.width, next.height);
	return next;
}

function applySharpen({
	canvas,
	amount,
}: {
	canvas: OffscreenCanvas | HTMLCanvasElement;
	amount: number;
}): OffscreenCanvas | HTMLCanvasElement {
	const ctx = getScratchContext({ canvas });
	const source = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const result = createScratchCanvas({ width: canvas.width, height: canvas.height });
	const resultCtx = getScratchContext({ canvas: result });
	const output = resultCtx.createImageData(canvas.width, canvas.height);
	const weights = [
		0,
		-amount,
		0,
		-amount,
		1 + amount * 4,
		-amount,
		0,
		-amount,
		0,
	];
	convolveImageData({
		source: source.data,
		target: output.data,
		width: canvas.width,
		height: canvas.height,
		weights,
	});
	resultCtx.putImageData(output, 0, 0);
	return result;
}

function convolveImageData({
	source,
	target,
	width,
	height,
	weights,
}: {
	source: Uint8ClampedArray;
	target: Uint8ClampedArray;
	width: number;
	height: number;
	weights: number[];
}): void {
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let red = 0;
			let green = 0;
			let blue = 0;
			let alpha = 0;
			for (let ky = -1; ky <= 1; ky += 1) {
				for (let kx = -1; kx <= 1; kx += 1) {
					const sampleX = Math.max(0, Math.min(width - 1, x + kx));
					const sampleY = Math.max(0, Math.min(height - 1, y + ky));
					const sampleIndex = (sampleY * width + sampleX) * 4;
					const weight = weights[(ky + 1) * 3 + (kx + 1)] ?? 0;
					red += source[sampleIndex] * weight;
					green += source[sampleIndex + 1] * weight;
					blue += source[sampleIndex + 2] * weight;
					alpha += source[sampleIndex + 3] * weight;
				}
			}
			const targetIndex = (y * width + x) * 4;
			target[targetIndex] = clampChannel(red);
			target[targetIndex + 1] = clampChannel(green);
			target[targetIndex + 2] = clampChannel(blue);
			target[targetIndex + 3] = clampChannel(alpha || source[targetIndex + 3]);
		}
	}
}

function clampChannel(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

function createScratchCanvas({
	width,
	height,
}: {
	width: number;
	height: number;
}): OffscreenCanvas | HTMLCanvasElement {
	if (typeof OffscreenCanvas !== "undefined") {
		return new OffscreenCanvas(width, height);
	}
	if (typeof document !== "undefined") {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
	throw new Error("No canvas implementation is available");
}

function getScratchContext({
	canvas,
}: {
	canvas: OffscreenCanvas | HTMLCanvasElement;
}): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Failed to get render context");
	}
	return context;
}
