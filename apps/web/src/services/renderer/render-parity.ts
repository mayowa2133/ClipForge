export async function computeCanvasFrameHash({
	canvas,
}: {
	canvas: HTMLCanvasElement;
}): Promise<string> {
	const sourceCanvas = getReadbackCanvas({ canvas });
	const ctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) {
		throw new Error("Failed to read canvas frame");
	}

	const { data } = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
	let hash = 2166136261;
	for (let i = 0; i < data.length; i += 16) {
		hash ^= data[i] ?? 0;
		hash = Math.imul(hash, 16777619);
		hash ^= data[i + 1] ?? 0;
		hash = Math.imul(hash, 16777619);
		hash ^= data[i + 2] ?? 0;
		hash = Math.imul(hash, 16777619);
		hash ^= data[i + 3] ?? 0;
		hash = Math.imul(hash, 16777619);
	}

	return `${sourceCanvas.width}x${sourceCanvas.height}:${(hash >>> 0).toString(16)}`;
}

export interface ParityCheckResult {
	match: boolean;
	previewHash: string;
	exportHash: string;
	time: number;
}

export async function compareCanvasFrameParity({
	previewCanvas,
	exportCanvas,
	time,
}: {
	previewCanvas: HTMLCanvasElement;
	exportCanvas: HTMLCanvasElement;
	time: number;
}): Promise<ParityCheckResult> {
	const [previewHash, exportHash] = await Promise.all([
		computeCanvasFrameHash({ canvas: previewCanvas }),
		computeCanvasFrameHash({ canvas: exportCanvas }),
	]);

	return {
		match: previewHash === exportHash,
		previewHash,
		exportHash,
		time,
	};
}

function getReadbackCanvas({
	canvas,
}: {
	canvas: HTMLCanvasElement;
}): HTMLCanvasElement {
	if (
		typeof document === "undefined" ||
		typeof HTMLCanvasElement === "undefined" ||
		!(canvas instanceof HTMLCanvasElement)
	) {
		return canvas;
	}

	const readbackCanvas = document.createElement("canvas");
	readbackCanvas.width = canvas.width;
	readbackCanvas.height = canvas.height;
	const drawCtx = readbackCanvas.getContext("2d");
	if (!drawCtx) {
		return canvas;
	}

	drawCtx.drawImage(canvas, 0, 0);
	return readbackCanvas;
}
