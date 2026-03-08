import { getLastFrameTime } from "@/lib/time";
import type { RenderBackendDiagnostics } from "@/services/renderer/backends/types";
import type {
	PreviewFidelityIssue,
	PreviewFidelityReport,
	PreviewFidelityStatus,
	PreviewParitySample,
	RenderGraph,
	RenderLayer,
} from "@/services/renderer/types";

export function buildRenderGraphFingerprint({
	graph,
}: {
	graph: RenderGraph | null;
}): string | null {
	if (!graph) return null;

	const background =
		graph.background.type === "blur"
			? `blur:${graph.background.blurIntensity}`
			: `color:${graph.background.color}`;

	const layers = graph.layers
		.map((layer) => serializeRenderLayer({ layer }))
		.join("|");

	return [
		"preview-fidelity-v1",
		`duration:${graph.duration}`,
		`canvas:${graph.canvas.width}x${graph.canvas.height}`,
		`background:${background}`,
		`layers:${layers}`,
	].join(";");
}

export function buildPreviewParitySampleTimes({
	graph,
	fps,
}: {
	graph: RenderGraph;
	fps: number;
}): number[] {
	if (graph.duration <= 0) return [];

	const lastFrameTime = Math.max(
		0,
		getLastFrameTime({
			duration: graph.duration,
			fps,
		}),
	);
	const firstNonZeroStart = graph.layers
		.map((layer) => layer.startTime)
		.filter((time) => time > 0)
		.sort((a, b) => a - b)[0];

	const candidates = [0, graph.duration / 2, lastFrameTime, firstNonZeroStart];
	const seen = new Set<string>();

	return candidates
		.filter((time): time is number => typeof time === "number" && Number.isFinite(time))
		.map((time) => Math.max(0, Math.min(lastFrameTime, time)))
		.filter((time) => {
			const key = time.toFixed(6);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.slice(0, 4);
}

export function buildPreviewFidelityReport({
	graphFingerprint,
	previewDiagnostics,
	exportDiagnostics,
	samples,
	checkedAt,
	parityError,
}: {
	graphFingerprint: string;
	previewDiagnostics: RenderBackendDiagnostics;
	exportDiagnostics: RenderBackendDiagnostics | null;
	samples: PreviewParitySample[];
	checkedAt: string;
	parityError?: string | null;
}): PreviewFidelityReport {
	const issues: PreviewFidelityIssue[] = [];

	if (
		previewDiagnostics.backendKind === "binary-preview" &&
		previewDiagnostics.unsupportedFeatures.includes("worker-unavailable")
	) {
		issues.push({
			code: "preview-worker-unavailable",
			message: "Binary preview worker is unavailable; preview is using a fallback path.",
			severity: "warning",
		});
	}

	if (
		previewDiagnostics.unsupportedFeatures.some(
			(feature) => feature !== "worker-unavailable",
		)
	) {
		issues.push({
			code: "feature-not-supported-by-primary-preview",
			message:
				"Current preview features require a fallback renderer for this timeline.",
			severity: "warning",
		});
	}

	if (previewDiagnostics.usedBinaryFallback) {
		issues.push({
			code: "preview-used-binary-fallback",
			message:
				"Preview required the graph-native binary fallback instead of the primary preview backend.",
			severity: "warning",
		});
	}

	if (previewDiagnostics.usedLegacyFallback) {
		issues.push({
			code: "preview-used-legacy-fallback",
			message:
				"Preview required the legacy canvas fallback, so exact export parity is not guaranteed.",
			severity: "error",
		});
	}

	if (exportDiagnostics?.usedLegacyFallback) {
		issues.push({
			code: "export-used-legacy-fallback",
			message:
				"Export rendering required the legacy canvas fallback for sampled frames.",
			severity: "error",
		});
	}

	for (const sample of samples.filter((entry) => !entry.match)) {
		issues.push({
			code: "preview-export-parity-mismatch",
			message:
				"Preview and export sampled frames produced different rendered output.",
			severity: "error",
			time: sample.time,
		});
	}

	if (parityError) {
		issues.push({
			code: "parity-check-failed",
			message: parityError,
			severity: "error",
		});
	}

	return {
		status: classifyPreviewFidelityStatus({
			previewDiagnostics,
			exportDiagnostics,
			issues,
			samples,
		}),
		checkedAt,
		graphFingerprint,
		previewBackend: previewDiagnostics.backendKind,
		exportBackend:
			exportDiagnostics?.backendKind === "legacy-canvas"
				? "legacy-canvas"
				: exportDiagnostics?.backendKind === "binary-canvas"
					? "binary-canvas"
					: null,
		issues,
		samples,
	};
}

export function classifyPreviewFidelityStatus({
	previewDiagnostics,
	exportDiagnostics,
	issues,
	samples,
}: {
	previewDiagnostics: RenderBackendDiagnostics;
	exportDiagnostics: RenderBackendDiagnostics | null;
	issues: PreviewFidelityIssue[];
	samples: PreviewParitySample[];
}): PreviewFidelityStatus {
	if (
		issues.some((issue) => issue.code === "preview-export-parity-mismatch") ||
		issues.some((issue) => issue.code === "parity-check-failed") ||
		previewDiagnostics.usedLegacyFallback ||
		!!exportDiagnostics?.usedLegacyFallback
	) {
		return "unsupported";
	}

	if (
		previewDiagnostics.usedBinaryFallback ||
		previewDiagnostics.unsupportedFeatures.length > 0 ||
		samples.length === 0
	) {
		return "approximate";
	}

	return "exact";
}

function serializeRenderLayer({ layer }: { layer: RenderLayer }): string {
	const payloadIdentity = (() => {
		switch (layer.kind) {
			case "video":
				return `video:${layer.payload.mediaId}:${JSON.stringify(layer.payload.keyframes ?? null)}:${JSON.stringify(layer.payload.transitionIn ?? null)}:${JSON.stringify(layer.payload.adjustments ?? null)}:${JSON.stringify(layer.payload.effects ?? null)}`;
			case "image":
				return `image:${layer.payload.mediaId}:${JSON.stringify(layer.payload.keyframes ?? null)}:${JSON.stringify(layer.payload.transitionIn ?? null)}:${JSON.stringify(layer.payload.adjustments ?? null)}:${JSON.stringify(layer.payload.effects ?? null)}`;
			case "text":
				return `text:${layer.payload.content}:${JSON.stringify(layer.payload.keyframes ?? null)}:${JSON.stringify(layer.payload.transitionIn ?? null)}`;
			case "sticker":
				return `sticker:${layer.payload.stickerId}:${layer.payload.sourceUrl}:${JSON.stringify(layer.payload.keyframes ?? null)}:${JSON.stringify(layer.payload.transitionIn ?? null)}`;
		}
	})();

	return [
		layer.id,
		layer.trackId,
		layer.kind,
		layer.zIndex,
		layer.startTime,
		layer.duration,
		layer.trimStart,
		layer.trimEnd,
		layer.hidden ? 1 : 0,
		"previousVisualLayerId" in layer ? (layer.previousVisualLayerId ?? "none") : "none",
		payloadIdentity,
	].join(":");
}
