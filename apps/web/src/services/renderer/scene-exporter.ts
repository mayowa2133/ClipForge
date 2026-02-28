import EventEmitter from "eventemitter3";

import {
	Output,
	Mp4OutputFormat,
	WebMOutputFormat,
	BufferTarget,
	CanvasSource,
	AudioBufferSource,
	QUALITY_LOW,
	QUALITY_MEDIUM,
	QUALITY_HIGH,
	QUALITY_VERY_HIGH,
} from "mediabunny";
import type { ExportFormat, ExportQuality } from "@/types/export";
import type { RenderGraph } from "@/services/renderer/types";
import type { RenderBackend } from "@/services/renderer/backends/types";

type ExportParams = {
	width: number;
	height: number;
	fps: number;
	format: ExportFormat;
	quality: ExportQuality;
	backend: RenderBackend;
	graph: RenderGraph;
	shouldIncludeAudio?: boolean;
	audioBuffer?: AudioBuffer;
};

const qualityMap = {
	low: QUALITY_LOW,
	medium: QUALITY_MEDIUM,
	high: QUALITY_HIGH,
	very_high: QUALITY_VERY_HIGH,
};

export type SceneExporterEvents = {
	progress: [progress: number];
	complete: [buffer: ArrayBuffer];
	error: [error: Error];
	cancelled: [];
};

export class SceneExporter extends EventEmitter<SceneExporterEvents> {
	private readonly format: ExportFormat;
	private readonly quality: ExportQuality;
	private readonly shouldIncludeAudio: boolean;
	private readonly audioBuffer?: AudioBuffer;
	private readonly backend: RenderBackend;
	private readonly graph: RenderGraph;
	private readonly width: number;
	private readonly height: number;
	private readonly fps: number;
	private isCancelled = false;

	constructor({
		width,
		height,
		fps,
		format,
		quality,
		backend,
		graph,
		shouldIncludeAudio,
		audioBuffer,
	}: ExportParams) {
		super();
		this.width = width;
		this.height = height;
		this.fps = fps;
		this.format = format;
		this.quality = quality;
		this.backend = backend;
		this.graph = graph;
		this.shouldIncludeAudio = shouldIncludeAudio ?? false;
		this.audioBuffer = audioBuffer;
	}

	cancel(): void {
		this.isCancelled = true;
	}

	async export(): Promise<ArrayBuffer | null> {
		const frameCount = Math.ceil(this.graph.duration * this.fps);
		const outputFormat =
			this.format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();

		const output = new Output({
			format: outputFormat,
			target: new BufferTarget(),
		});

		const encoderCanvas = document.createElement("canvas");
		encoderCanvas.width = this.width;
		encoderCanvas.height = this.height;
		const encoderCtx = encoderCanvas.getContext("2d");
		if (!encoderCtx) {
			throw new Error("Failed to get export canvas context");
		}

		const videoSource = new CanvasSource(encoderCanvas, {
			codec: this.format === "webm" ? "vp9" : "avc",
			bitrate: qualityMap[this.quality],
		});
		output.addVideoTrack(videoSource, { frameRate: this.fps });

		let audioSource: AudioBufferSource | null = null;
		if (this.shouldIncludeAudio && this.audioBuffer) {
			audioSource = new AudioBufferSource({
				codec: this.format === "webm" ? "opus" : "aac",
				bitrate: qualityMap[this.quality],
			});
			output.addAudioTrack(audioSource);
		}

		await output.start();
		if (audioSource && this.audioBuffer) {
			await audioSource.add(this.audioBuffer);
			audioSource.close();
		}

		for (let i = 0; i < frameCount; i++) {
			if (this.isCancelled) {
				await output.cancel();
				this.emit("cancelled");
				return null;
			}

			const time = i / this.fps;
			const frame = await this.backend.renderFrame({
				graph: this.graph,
				time,
				targetSize: { width: this.width, height: this.height },
			});
			encoderCtx.clearRect(0, 0, this.width, this.height);
			if (frame.kind === "image-bitmap" && frame.bitmap) {
				encoderCtx.drawImage(frame.bitmap, 0, 0, this.width, this.height);
				frame.bitmap.close();
			} else if (frame.canvas) {
				encoderCtx.drawImage(frame.canvas, 0, 0, this.width, this.height);
			}
			await videoSource.add(time, 1 / this.fps);
			this.emit("progress", i / frameCount);
		}

		if (this.isCancelled) {
			await output.cancel();
			this.emit("cancelled");
			return null;
		}

		videoSource.close();
		await output.finalize();
		this.emit("progress", 1);

		const buffer = output.target.buffer;
		if (!buffer) {
			this.emit("error", new Error("Failed to export video"));
			return null;
		}

		this.emit("complete", buffer);
		return buffer;
	}
}
