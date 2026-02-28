import type { RenderTextPayload } from "@/services/renderer/types";
import {
	DEFAULT_TEXT_ELEMENT,
	DEFAULT_LINE_HEIGHT,
	FONT_SIZE_SCALE_REFERENCE,
} from "@/constants/text-constants";
import {
	getMetricAscent,
	getMetricDescent,
	getTextBackgroundRect,
	measureTextBlock,
} from "@/lib/text/layout";

function scaleFontSize({
	fontSize,
	canvasHeight,
}: {
	fontSize: number;
	canvasHeight: number;
}): number {
	return fontSize * (canvasHeight / FONT_SIZE_SCALE_REFERENCE);
}

function quoteFontFamily({ fontFamily }: { fontFamily: string }): string {
	return `"${fontFamily.replace(/"/g, '\\"')}"`;
}

function drawTextDecoration({
	ctx,
	textDecoration,
	lineWidth,
	lineY,
	metrics,
	scaledFontSize,
	textAlign,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	textDecoration: string;
	lineWidth: number;
	lineY: number;
	metrics: TextMetrics;
	scaledFontSize: number;
	textAlign: CanvasTextAlign;
}): void {
	if (textDecoration === "none" || !textDecoration) return;

	const thickness = Math.max(1, scaledFontSize * 0.07);
	const ascent = getMetricAscent({ metrics, fallbackFontSize: scaledFontSize });
	const descent = getMetricDescent({ metrics, fallbackFontSize: scaledFontSize });

	let xStart = -lineWidth / 2;
	if (textAlign === "left") xStart = 0;
	if (textAlign === "right") xStart = -lineWidth;

	if (textDecoration === "underline") {
		const underlineY = lineY + descent + thickness;
		ctx.fillRect(xStart, underlineY, lineWidth, thickness);
	}

	if (textDecoration === "line-through") {
		const strikeY = lineY - (ascent - descent) * 0.35;
		ctx.fillRect(xStart, strikeY, lineWidth, thickness);
	}
}

export function renderTextLayer({
	ctx,
	payload,
	time,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	payload: RenderTextPayload;
	time: number;
}): void {
	if (time < payload.startTime || time >= payload.startTime + payload.duration) {
		return;
	}

	ctx.save();

	const x = payload.transform.position.x + payload.canvasCenter.x;
	const y = payload.transform.position.y + payload.canvasCenter.y;
	ctx.translate(x, y);
	ctx.scale(payload.transform.scale, payload.transform.scale);
	if (payload.transform.rotate) {
		ctx.rotate((payload.transform.rotate * Math.PI) / 180);
	}

	const fontWeight = payload.fontWeight === "bold" ? "bold" : "normal";
	const fontStyle = payload.fontStyle === "italic" ? "italic" : "normal";
	const scaledFontSize = scaleFontSize({
		fontSize: payload.fontSize,
		canvasHeight: payload.canvasHeight,
	});
	const fontFamily = quoteFontFamily({ fontFamily: payload.fontFamily });
	ctx.font = `${fontStyle} ${fontWeight} ${scaledFontSize}px ${fontFamily}, sans-serif`;
	ctx.textAlign = payload.textAlign;
	ctx.fillStyle = payload.color;

	const letterSpacing = payload.letterSpacing ?? 0;
	const lineHeight = payload.lineHeight ?? DEFAULT_LINE_HEIGHT;
	if ("letterSpacing" in ctx) {
		(ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${letterSpacing}px`;
	}

	const lines = payload.content.split("\n");
	const lineHeightPx = scaledFontSize * lineHeight;
	const fontSizeRatio = payload.fontSize / DEFAULT_TEXT_ELEMENT.fontSize;
	const baseline = payload.textBaseline ?? "middle";
	ctx.textBaseline = baseline;
	const lineMetrics = lines.map((line) => ctx.measureText(line));
	const block = measureTextBlock({
		lineMetrics,
		lineHeightPx,
		fallbackFontSize: scaledFontSize,
	});

	const prevAlpha = ctx.globalAlpha;
	ctx.globalCompositeOperation = ((payload.blendMode && payload.blendMode !== "normal"
		? payload.blendMode
		: "source-over") as GlobalCompositeOperation);
	ctx.globalAlpha = payload.opacity;

	if (
		payload.background.color &&
		payload.background.color !== "transparent" &&
		lines.length > 0
	) {
		const { color, cornerRadius = 0 } = payload.background;
		const backgroundRect = getTextBackgroundRect({
			textAlign: payload.textAlign,
			block,
			background: payload.background,
			fontSizeRatio,
		});
		if (backgroundRect) {
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.roundRect(
				backgroundRect.left,
				backgroundRect.top,
				backgroundRect.width,
				backgroundRect.height,
				cornerRadius,
			);
			ctx.fill();
			ctx.fillStyle = payload.color;
		}
	}

	for (let i = 0; i < lines.length; i++) {
		const lineY = i * lineHeightPx - block.visualCenterOffset;
		ctx.fillText(lines[i], 0, lineY);
		drawTextDecoration({
			ctx,
			textDecoration: payload.textDecoration ?? "none",
			lineWidth: lineMetrics[i].width,
			lineY,
			metrics: lineMetrics[i],
			scaledFontSize,
			textAlign: payload.textAlign,
		});
	}

	ctx.globalAlpha = prevAlpha;
	ctx.restore();
}
