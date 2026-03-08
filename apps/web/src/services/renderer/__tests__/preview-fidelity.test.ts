import { describe, expect, test } from "bun:test";
import {
	buildPreviewFidelityReport,
	buildPreviewParitySampleTimes,
	buildRenderGraphFingerprint,
	classifyPreviewFidelityStatus,
} from "@/services/renderer/preview-fidelity";
import type { RenderBackendDiagnostics } from "@/services/renderer/backends/types";
import type { RenderGraph } from "@/services/renderer/types";

const baseDiagnostics: RenderBackendDiagnostics = {
	backendKind: "binary-preview",
	usedBinaryFallback: false,
	usedLegacyFallback: false,
	unsupportedFeatures: [],
};

function buildGraph({
	layers = [],
	duration = 6,
}: {
	layers?: RenderGraph["layers"];
	duration?: number;
} = {}): RenderGraph {
	return {
		duration,
		canvas: { width: 1080, height: 1920 },
		background: { type: "color", color: "#000000" },
		layers,
	};
}

describe("preview fidelity", () => {
	test("graph fingerprint is stable for equivalent graphs", () => {
		const a = buildGraph({
			layers: [
				{
					id: "video-1",
					trackId: "track-video-1",
					kind: "video",
					zIndex: 0,
					startTime: 0,
					duration: 3,
					trimStart: 0,
					trimEnd: 0,
					hidden: false,
					payload: {
						mediaId: "asset-1",
						playbackRate: 1,
						transform: {
							scale: 1,
							position: { x: 0, y: 0 },
							rotate: 0,
						},
						opacity: 1,
					},
				},
			],
		});
		const b = buildGraph({
			layers: [
				{
					id: "video-1",
					trackId: "track-video-1",
					kind: "video",
					zIndex: 0,
					startTime: 0,
					duration: 3,
					trimStart: 0,
					trimEnd: 0,
					hidden: false,
					payload: {
						mediaId: "asset-1",
						playbackRate: 1,
						transform: {
							scale: 1,
							position: { x: 0, y: 0 },
							rotate: 0,
						},
						opacity: 1,
					},
				},
			],
		});

		expect(buildRenderGraphFingerprint({ graph: a })).toBe(
			buildRenderGraphFingerprint({ graph: b }),
		);
	});

	test("graph fingerprint changes on meaningful graph edits", () => {
		const a = buildGraph();
		const b = buildGraph({ duration: 7 });

		expect(buildRenderGraphFingerprint({ graph: a })).not.toBe(
			buildRenderGraphFingerprint({ graph: b }),
		);
	});

	test("graph fingerprint changes when finishing payload changes", () => {
		const baseLayer: RenderGraph["layers"][number] = {
			id: "video-1",
			trackId: "track-video-1",
			kind: "video",
			zIndex: 0,
			startTime: 0,
			duration: 3,
			trimStart: 0,
			trimEnd: 0,
			hidden: false,
			payload: {
				mediaId: "asset-1",
				playbackRate: 1,
				transform: {
					scale: 1,
					position: { x: 0, y: 0 },
					rotate: 0,
				},
				opacity: 1,
				adjustments: null,
				effects: null,
			},
		};
		const a = buildGraph({ layers: [baseLayer] });
		const b = buildGraph({
			layers: [
				{
					...baseLayer,
					payload: {
						...baseLayer.payload,
						adjustments: {
							exposure: 0.2,
							contrast: 0,
							saturation: 0,
							temperature: 0,
							tint: 0,
							highlights: 0,
							shadows: 0,
						},
					},
				},
			],
		});

		expect(buildRenderGraphFingerprint({ graph: a })).not.toBe(
			buildRenderGraphFingerprint({ graph: b }),
		);
	});

	test("parity sample times are deterministic and capped", () => {
		const times = buildPreviewParitySampleTimes({
			graph: buildGraph({
				layers: [
					{
						id: "text-1",
						trackId: "track-text-1",
						kind: "text",
						zIndex: 0,
						startTime: 1.5,
						duration: 2,
						trimStart: 0,
						trimEnd: 0,
						hidden: false,
						payload: {
							id: "text-1",
							type: "text",
							name: "Caption",
							content: "hello",
							startTime: 1.5,
							duration: 2,
							trimStart: 0,
							trimEnd: 0,
							fontSize: 48,
							fontFamily: "Geist",
							color: "#fff",
							background: { color: "#000000" },
							textAlign: "center",
							fontWeight: "normal",
							fontStyle: "normal",
							textDecoration: "none",
							transform: {
								scale: 1,
								position: { x: 0, y: 0 },
								rotate: 0,
							},
							opacity: 1,
							canvasCenter: { x: 540, y: 960 },
							canvasHeight: 1920,
							textBaseline: "middle",
						},
					},
				],
			}),
			fps: 30,
		});

		expect(times.length).toBeLessThanOrEqual(4);
		expect(times[0]).toBe(0);
		expect(times).toContain(1.5);
	});

	test("classifies binary fallback without mismatch as approximate", () => {
		const status = classifyPreviewFidelityStatus({
			previewDiagnostics: {
				...baseDiagnostics,
				usedBinaryFallback: true,
			},
			exportDiagnostics: {
				backendKind: "binary-canvas",
				usedBinaryFallback: false,
				usedLegacyFallback: false,
				unsupportedFeatures: [],
			},
			issues: [],
			samples: [
				{ time: 0, previewHash: "a", exportHash: "a", match: true },
			],
		});

		expect(status).toBe("approximate");
	});

	test("parity mismatch produces unsupported report with sample metadata", () => {
		const report = buildPreviewFidelityReport({
			graphFingerprint: "graph-v1",
			previewDiagnostics: baseDiagnostics,
			exportDiagnostics: {
				backendKind: "binary-canvas",
				usedBinaryFallback: false,
				usedLegacyFallback: false,
				unsupportedFeatures: [],
			},
			samples: [{ time: 0.5, previewHash: "a", exportHash: "b", match: false }],
			checkedAt: "2026-03-06T12:00:00.000Z",
		});

		expect(report.status).toBe("unsupported");
		expect(report.issues.some((issue) => issue.code === "preview-export-parity-mismatch")).toBe(
			true,
		);
		expect(report.samples[0]?.time).toBe(0.5);
	});
});
