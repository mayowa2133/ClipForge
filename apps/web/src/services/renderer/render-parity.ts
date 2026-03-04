export async function computeCanvasFrameHash({
	canvas,
}: {
	canvas: HTMLCanvasElement;
}): Promise<string> {
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) {
		throw new Error("Failed to read canvas frame");
	}

	const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
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

	return `${canvas.width}x${canvas.height}:${(hash >>> 0).toString(16)}`;
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
