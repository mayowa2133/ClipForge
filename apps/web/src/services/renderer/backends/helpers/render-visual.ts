import type { BlendMode, Transform } from "@/types/rendering";

export function drawVisualToContext({
	ctx,
	canvasWidth,
	canvasHeight,
	source,
	sourceWidth,
	sourceHeight,
	transform,
	opacity,
	blendMode,
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
}): void {
	ctx.save();

	const scale = transform.scale || 1;
	const fillScale = Math.max(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
	const scaledWidth = sourceWidth * fillScale * scale;
	const scaledHeight = sourceHeight * fillScale * scale;
	const x = canvasWidth / 2 + transform.position.x - scaledWidth / 2;
	const y = canvasHeight / 2 + transform.position.y - scaledHeight / 2;
	const centerX = x + scaledWidth / 2;
	const centerY = y + scaledHeight / 2;

	ctx.globalCompositeOperation = ((blendMode && blendMode !== "normal"
		? blendMode
		: "source-over") as GlobalCompositeOperation);
	ctx.globalAlpha = opacity;

	if (transform.rotate) {
		ctx.translate(centerX, centerY);
		ctx.rotate((transform.rotate * Math.PI) / 180);
		ctx.translate(-centerX, -centerY);
	}

	ctx.drawImage(source, x, y, scaledWidth, scaledHeight);
	ctx.restore();
}
