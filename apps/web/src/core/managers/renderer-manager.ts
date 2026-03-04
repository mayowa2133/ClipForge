import type { EditorCore } from "@/core";
import { ENABLE_BINARY_PREVIEW_RENDERER } from "@/constants/feature-flags";
import { compareCanvasFrameParity } from "@/services/renderer/render-parity";
import { buildRenderGraph } from "@/services/renderer/scene-builder";
import { SceneExporter, SceneExportError } from "@/services/renderer/scene-exporter";
import { RenderAssetRegistry } from "@/services/renderer/render-asset-registry";
import type { RenderGraph } from "@/services/renderer/types";
import { BinaryCanvasBackend } from "@/services/renderer/backends/binary-canvas-backend";
import { BinaryPreviewBackend } from "@/services/renderer/backends/binary-preview-backend";
import { LegacyCanvasBackend } from "@/services/renderer/backends/legacy-canvas-backend";
import type { RenderBackend } from "@/services/renderer/backends/types";
import type {
	ExportDiagnostics,
	ExportOptions,
	ExportResult,
} from "@/types/export";
import { createTimelineAudioBuffer } from "@/lib/media/audio";
import { formatTimeCode, getLastFrameTime } from "@/lib/time";
import { downloadBlob } from "@/utils/browser";

export class RendererManager {
	private renderGraph: RenderGraph | null = null;
	private readonly assetRegistry = new RenderAssetRegistry();
	private readonly listeners = new Set<() => void>();
	private previewBackend: RenderBackend;

	constructor(private editor: EditorCore) {
		this.previewBackend = this.createBackend();
	}

	setRenderGraph({ renderGraph }: { renderGraph: RenderGraph | null }): void {
		this.renderGraph = renderGraph;
		this.assetRegistry.setAssets(this.editor.media.getAssets());
		this.notify();
	}

	getRenderGraph(): RenderGraph | null {
		return this.renderGraph;
	}

	getBackend(): RenderBackend {
		return this.previewBackend;
	}

	async renderFrameToCanvas({
		time,
		targetCanvas,
	}: {
		time: number;
		targetCanvas: HTMLCanvasElement;
	}): Promise<boolean> {
		const renderGraph = this.getRenderGraph();
		if (!renderGraph) return false;

		const frame = await this.previewBackend.renderFrame({
			graph: renderGraph,
			time,
			targetSize: {
				width: targetCanvas.width,
				height: targetCanvas.height,
			},
		});
		await drawRenderedFrameToCanvas({ frame, targetCanvas });
		return true;
	}

	async saveSnapshot(): Promise<{ success: boolean; error?: string }> {
		try {
			const renderGraph = this.getRenderGraph();
			const activeProject = this.editor.project.getActive();

			if (!renderGraph || !activeProject) {
				return { success: false, error: "No project or scene to capture" };
			}

			if (renderGraph.duration === 0) {
				return { success: false, error: "Project is empty" };
			}

			const { canvasSize, fps } = activeProject.settings;
			const currentTime = this.editor.playback.getCurrentTime();
			const lastFrameTime = getLastFrameTime({
				duration: renderGraph.duration,
				fps,
			});
			const renderTime = Math.min(currentTime, lastFrameTime);

			const tempCanvas = document.createElement("canvas");
			tempCanvas.width = canvasSize.width;
			tempCanvas.height = canvasSize.height;

			const didRender = await this.renderFrameToCanvas({
				time: renderTime,
				targetCanvas: tempCanvas,
			});
			if (!didRender) {
				return { success: false, error: "No frame available" };
			}

			const blob = await new Promise<Blob | null>((resolve) => {
				tempCanvas.toBlob((result) => resolve(result), "image/png");
			});
			if (!blob) {
				return { success: false, error: "Failed to create image" };
			}

			const timecode = formatTimeCode({
				timeInSeconds: renderTime,
				fps,
			}).replace(/:/g, "-");
			const safeName =
				activeProject.metadata.name.replace(/[<>:"/\\|?*]/g, "-").trim() ||
				"snapshot";
			const filename = `${safeName}-${timecode}.png`;
			downloadBlob({ blob, filename });
			return { success: true };
		} catch (error) {
			console.error("Save snapshot failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	async exportProject({
		options,
	}: {
		options: ExportOptions;
	}): Promise<ExportResult> {
		const { format, quality, fps, includeAudio, onProgress, onCancel } = options;
		let lastExportBackendUsed: "binary-canvas" | "legacy-canvas" = "binary-canvas";
		let getLastExportBackendUsed = () => lastExportBackendUsed;

		try {
			const tracks = this.editor.timeline.getTracks();
			const mediaAssets = this.editor.media.getAssets();
			const activeProject = this.editor.project.getActive();
			const buildDiagnostics = ({
				failureCode,
				failedFrameIndex = null,
				failedTimeSeconds = null,
				backendUsed = "binary-canvas",
			}: {
				failureCode?: ExportDiagnostics["failureCode"];
				failedFrameIndex?: number | null;
				failedTimeSeconds?: number | null;
				backendUsed?: ExportDiagnostics["backendUsed"];
			}): ExportDiagnostics => ({
				failureCode,
				failedFrameIndex,
				failedTimeSeconds,
				backendUsed,
				audioIncluded: !!includeAudio,
				format,
				quality,
			});
			if (!activeProject) {
				return {
					success: false,
					error: "No active project",
					diagnostics: buildDiagnostics({ failureCode: "no-active-project" }),
				};
			}

			const duration = this.editor.timeline.getTotalDuration();
			if (duration === 0) {
				return {
					success: false,
					error: "Project is empty",
					diagnostics: buildDiagnostics({ failureCode: "empty-project" }),
				};
			}

			const exportFps = fps || activeProject.settings.fps;
			const canvasSize = activeProject.settings.canvasSize;
			let audioBuffer: AudioBuffer | null = null;
			if (includeAudio) {
				onProgress?.({ progress: 0.02 });
				try {
					audioBuffer = await createTimelineAudioBuffer({
						tracks,
						mediaAssets,
						duration,
					});
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error ? error.message : "Failed to mix audio for export",
						diagnostics: buildDiagnostics({ failureCode: "audio-mix-failed" }),
					};
				}
				onProgress?.({ progress: 0.05 });
			}

			const renderGraph = buildRenderGraph({
				tracks,
				mediaAssets,
				duration,
				canvasSize,
				background: activeProject.settings.background,
			});
			this.assetRegistry.setAssets(mediaAssets);

			const exportBackend = this.createExportBackend();
			const backend = exportBackend.backend;
			getLastExportBackendUsed = exportBackend.getLastUsedBackend;
			lastExportBackendUsed = exportBackend.getLastUsedBackend();
			if (
				process.env.NODE_ENV !== "production" &&
				typeof document !== "undefined"
			) {
				void this.logExportParityCheck({
					renderGraph,
					exportBackend: backend,
					canvasSize,
				});
			}
			const exporter = new SceneExporter({
				width: canvasSize.width,
				height: canvasSize.height,
				fps: exportFps,
				format,
				quality,
				backend,
				graph: renderGraph,
				shouldIncludeAudio: !!includeAudio,
				audioBuffer: audioBuffer || undefined,
			});

			exporter.on("progress", (progress) => {
				onProgress?.({ progress });
			});

			let cancelled = false;
			const checkCancel = () => {
				if (onCancel?.()) {
					cancelled = true;
					exporter.cancel();
				}
			};
			const cancelInterval = setInterval(checkCancel, 100);

			try {
				const buffer = await exporter.export();
				clearInterval(cancelInterval);
				lastExportBackendUsed = exportBackend.getLastUsedBackend();

				if (cancelled) {
					return {
						success: false,
						cancelled: true,
						diagnostics: buildDiagnostics({
							failureCode: "cancelled",
							backendUsed: lastExportBackendUsed,
						}),
					};
				}
				if (!buffer) {
					return {
						success: false,
						error: "Export failed to produce buffer",
						diagnostics: buildDiagnostics({
							failureCode: "unknown",
							backendUsed: lastExportBackendUsed,
						}),
					};
				}
				return {
					success: true,
					buffer,
					diagnostics: buildDiagnostics({
						backendUsed: lastExportBackendUsed,
					}),
				};
			} finally {
				clearInterval(cancelInterval);
				backend.dispose();
			}
		} catch (error) {
			console.error("Export failed:", error);
			const sceneExportError =
				error instanceof SceneExportError ? error : null;
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Unknown export error",
				diagnostics: {
					failureCode: sceneExportError?.failureCode ?? "unknown",
					failedFrameIndex: sceneExportError?.frameIndex ?? null,
					failedTimeSeconds: sceneExportError?.timeSeconds ?? null,
					backendUsed: getLastExportBackendUsed(),
					audioIncluded: !!includeAudio,
					format,
					quality,
				},
			};
		}
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private createBackend(): RenderBackend {
		if (ENABLE_BINARY_PREVIEW_RENDERER) {
			return new BinaryPreviewBackend(this.assetRegistry);
		}
		return new LegacyCanvasBackend(this.assetRegistry);
	}

	private createExportBackend(): {
		backend: RenderBackend;
		getLastUsedBackend: () => "binary-canvas" | "legacy-canvas";
	} {
		const binaryBackend = new BinaryCanvasBackend(this.assetRegistry);
		const legacyBackend = new LegacyCanvasBackend(this.assetRegistry);
		let lastUsedBackend: "binary-canvas" | "legacy-canvas" = "binary-canvas";
		return {
			getLastUsedBackend: () => lastUsedBackend,
			backend: {
				renderFrame: async (request) => {
					try {
						lastUsedBackend = "binary-canvas";
						return await binaryBackend.renderFrame(request);
					} catch (error) {
						if (process.env.NODE_ENV !== "production") {
							console.warn(
								`[RendererManager] Falling back to legacy export backend: ${
									error instanceof Error ? error.message : "unknown error"
								}`,
							);
						}
						lastUsedBackend = "legacy-canvas";
						return legacyBackend.renderFrame(request);
					}
				},
				dispose: () => {
					binaryBackend.dispose();
					legacyBackend.dispose();
				},
			},
		};
	}

	private async logExportParityCheck({
		renderGraph,
		exportBackend,
		canvasSize,
	}: {
		renderGraph: RenderGraph;
		exportBackend: RenderBackend;
		canvasSize: { width: number; height: number };
	}): Promise<void> {
		const previewCanvas = document.createElement("canvas");
		previewCanvas.width = canvasSize.width;
		previewCanvas.height = canvasSize.height;
		const exportCanvas = document.createElement("canvas");
		exportCanvas.width = canvasSize.width;
		exportCanvas.height = canvasSize.height;

		try {
			const previewFrame = await this.previewBackend.renderFrame({
				graph: renderGraph,
				time: 0,
				targetSize: canvasSize,
			});
			await drawRenderedFrameToCanvas({
				frame: previewFrame,
				targetCanvas: previewCanvas,
			});

			const exportFrame = await exportBackend.renderFrame({
				graph: renderGraph,
				time: 0,
				targetSize: canvasSize,
			});
			await drawRenderedFrameToCanvas({
				frame: exportFrame,
				targetCanvas: exportCanvas,
			});

			const parity = await compareCanvasFrameParity({
				previewCanvas,
				exportCanvas,
				time: 0,
			});
			if (!parity.match) {
				console.warn(
					`[RendererManager] Preview/export first-frame parity mismatch at ${parity.time}s (${parity.previewHash} vs ${parity.exportHash})`,
				);
			}
		} catch {
			// Parity logging is dev-only and best-effort.
		}
	}

	private notify(): void {
		this.listeners.forEach((fn) => fn());
	}
}

async function drawRenderedFrameToCanvas({
	frame,
	targetCanvas,
}: {
	frame: Awaited<ReturnType<RenderBackend["renderFrame"]>>;
	targetCanvas: HTMLCanvasElement;
}): Promise<void> {
	const ctx = targetCanvas.getContext("2d");
	if (!ctx) {
		throw new Error("Failed to get target canvas context");
	}

	ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
	if (frame.kind === "image-bitmap" && frame.bitmap) {
		ctx.drawImage(frame.bitmap, 0, 0, targetCanvas.width, targetCanvas.height);
		frame.bitmap.close();
		return;
	}
	if (frame.canvas) {
		ctx.drawImage(frame.canvas, 0, 0, targetCanvas.width, targetCanvas.height);
	}
}
