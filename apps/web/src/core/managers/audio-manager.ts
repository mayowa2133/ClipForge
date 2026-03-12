import type { EditorCore } from "@/core";
import type { AudioClipSource, ProjectMixSummary } from "@/lib/media/audio";
import {
	analyzeNormalizationGainDb,
	buildSoftLimiterCurve,
	buildProjectMixSummary,
	collectAudioClips,
	createAudioContext,
	dbToGain,
	getAudioEnvelopeGain,
	getDuckingGainAtTime,
} from "@/lib/media/audio";
import { resolveSceneBeatMarkers } from "@/lib/media/beat-analysis";
import { buildProjectAssemblyTracks, getProjectDurationFromScenes } from "@/lib/scenes";
import { usePreviewStore } from "@/stores/preview-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { buildUploadAudioElement } from "@/lib/timeline";
import {
	ALL_FORMATS,
	AudioBufferSink,
	BlobSource,
	Input,
	type WrappedAudioBuffer,
} from "mediabunny";

export class AudioManager {
	private audioContext: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	private softLimiter: WaveShaperNode | null = null;
	private playbackStartTime = 0;
	private playbackStartContextTime = 0;
	private scheduleTimer: number | null = null;
	private lookaheadSeconds = 2;
	private scheduleIntervalMs = 500;
	private clips: AudioClipSource[] = [];
	private sinks = new Map<string, AudioBufferSink>();
	private inputs = new Map<string, Input>();
	private activeClipIds = new Set<string>();
	private clipIterators = new Map<
		string,
		AsyncGenerator<WrappedAudioBuffer, void, unknown>
	>();
	private queuedSources = new Set<AudioBufferSourceNode>();
	private playbackSessionId = 0;
	private lastIsPlaying = false;
	private lastVolume = 1;
	private unsubscribers: Array<() => void> = [];
	private mediaRecorder: MediaRecorder | null = null;
	private recordingStream: MediaStream | null = null;
	private recordingChunks: Blob[] = [];
	private recordingInsertTime = 0;
	private recordingStartedAtMs = 0;
	private listeners = new Set<() => void>();

	constructor(private editor: EditorCore) {
		this.lastVolume = this.editor.playback.getVolume();

		this.unsubscribers.push(
			this.editor.playback.subscribe(this.handlePlaybackChange),
			this.editor.timeline.subscribe(this.handleTimelineChange),
			this.editor.media.subscribe(this.handleTimelineChange),
			this.editor.project.subscribe(this.handleTimelineChange),
		);
		if (typeof window !== "undefined") {
			window.addEventListener("playback-seek", this.handleSeek);
		}
	}

	dispose(): void {
		this.stopPlayback();
		for (const unsub of this.unsubscribers) {
			unsub();
		}
		this.unsubscribers = [];
		if (typeof window !== "undefined") {
			window.removeEventListener("playback-seek", this.handleSeek);
		}
		this.disposeSinks();
		this.listeners.clear();
		if (this.audioContext) {
			void this.audioContext.close();
			this.audioContext = null;
			this.masterGain = null;
			this.softLimiter = null;
		}
	}

	private handlePlaybackChange = (): void => {
		const isPlaying = this.editor.playback.getIsPlaying();
		const volume = this.editor.playback.getVolume();

		if (volume !== this.lastVolume) {
			this.lastVolume = volume;
			this.updateGain();
		}

		if (isPlaying !== this.lastIsPlaying) {
			this.lastIsPlaying = isPlaying;
			if (isPlaying) {
				void this.startPlayback({
					time: this.editor.playback.getCurrentTime(),
				});
			} else {
				this.stopPlayback();
			}
		}
	};

	private handleSeek = (event: Event): void => {
		const detail = (event as CustomEvent<{ time: number }>).detail;
		if (!detail) return;

		if (this.editor.playback.getIsScrubbing()) {
			this.stopPlayback();
			return;
		}

		if (this.editor.playback.getIsPlaying()) {
			void this.startPlayback({ time: detail.time });
			return;
		}

		this.stopPlayback();
	};

	private handleTimelineChange = (): void => {
		this.disposeSinks();
		this.notify();

		if (!this.editor.playback.getIsPlaying()) return;

		void this.startPlayback({ time: this.editor.playback.getCurrentTime() });
	};

	private ensureAudioContext(): AudioContext | null {
		if (this.audioContext) return this.audioContext;
		if (typeof window === "undefined") return null;

		this.audioContext = createAudioContext();
		this.masterGain = this.audioContext.createGain();
		this.masterGain.gain.value = this.lastVolume;
		this.softLimiter = this.audioContext.createWaveShaper();
		this.softLimiter.oversample = "2x";
		this.masterGain.connect(this.softLimiter);
		this.softLimiter.connect(this.audioContext.destination);
		this.syncAudioPolishNodes();
		return this.audioContext;
	}

	private syncAudioPolishNodes(): void {
		if (!this.softLimiter) return;
		const settings = this.editor.project.getActive()?.settings.audio;
		this.softLimiter.curve = settings?.softLimiterEnabled
			? buildSoftLimiterCurve()
			: null;
	}

	private updateGain(): void {
		if (!this.masterGain) return;
		this.masterGain.gain.value = this.lastVolume;
	}

	private getPlaybackTime(): number {
		if (!this.audioContext) return this.playbackStartTime;
		const elapsed =
			this.audioContext.currentTime - this.playbackStartContextTime;
		return this.playbackStartTime + elapsed;
	}

	private async startPlayback({ time }: { time: number }): Promise<void> {
		const audioContext = this.ensureAudioContext();
		if (!audioContext) return;

		this.stopPlayback();
		this.playbackSessionId++;

		const previewMode = usePreviewStore.getState().previewMode;
		const activeProject = this.editor.project.getActive();
		const tracks =
			previewMode === "project" && activeProject
				? buildProjectAssemblyTracks({ scenes: activeProject.scenes })
				: this.editor.timeline.getTracks();
		const mediaAssets = this.editor.media.getAssets();
		const duration =
			previewMode === "project" && activeProject
				? getProjectDurationFromScenes({ scenes: activeProject.scenes })
				: this.editor.timeline.getTotalDuration();

		if (duration <= 0) return;

		if (audioContext.state === "suspended") {
			await audioContext.resume();
		}
		this.syncAudioPolishNodes();

		this.clips = await collectAudioClips({ tracks, mediaAssets, project: activeProject });
		if (!this.editor.playback.getIsPlaying()) return;

		this.playbackStartTime = time;
		this.playbackStartContextTime = audioContext.currentTime;

		this.scheduleUpcomingClips();

		if (typeof window !== "undefined") {
			this.scheduleTimer = window.setInterval(() => {
				this.scheduleUpcomingClips();
			}, this.scheduleIntervalMs);
		}
	}

	private scheduleUpcomingClips(): void {
		if (!this.editor.playback.getIsPlaying()) return;

		const currentTime = this.getPlaybackTime();
		const windowEnd = currentTime + this.lookaheadSeconds;

		for (const clip of this.clips) {
			if (clip.muted) continue;
			if (this.activeClipIds.has(clip.id)) continue;

			const clipEnd = clip.startTime + clip.duration;
			if (clipEnd <= currentTime) continue;
			if (clip.startTime > windowEnd) continue;

			this.activeClipIds.add(clip.id);
			void this.runClipIterator({
				clip,
				startTime: currentTime,
				sessionId: this.playbackSessionId,
			});
		}
	}

	private stopPlayback(): void {
		if (this.scheduleTimer && typeof window !== "undefined") {
			window.clearInterval(this.scheduleTimer);
		}
		this.scheduleTimer = null;

		for (const iterator of this.clipIterators.values()) {
			void iterator.return();
		}
		this.clipIterators.clear();
		this.activeClipIds.clear();

		for (const source of this.queuedSources) {
			try {
				source.stop();
			} catch {}
			source.disconnect();
		}
		this.queuedSources.clear();
	}

	private async runClipIterator({
		clip,
		startTime,
		sessionId,
	}: {
		clip: AudioClipSource;
		startTime: number;
		sessionId: number;
	}): Promise<void> {
		const audioContext = this.ensureAudioContext();
		if (!audioContext) return;

		const sink = await this.getAudioSink({ clip });
		if (!sink || !this.editor.playback.getIsPlaying()) return;
		if (sessionId !== this.playbackSessionId) return;

		const clipStart = clip.startTime;
		const clipEnd = clip.startTime + clip.duration;

		const iteratorStartTime = Math.max(startTime, clipStart);
		const sourceStartTime =
			clip.trimStart + (iteratorStartTime - clip.startTime) * clip.playbackRate;

		const iterator = sink.buffers(sourceStartTime);
		this.clipIterators.set(clip.id, iterator);

		for await (const { buffer, timestamp } of iterator) {
			if (!this.editor.playback.getIsPlaying()) return;
			if (sessionId !== this.playbackSessionId) return;

			const timelineTime = clip.startTime + (timestamp - clip.trimStart);
			const effectiveTimelineTime =
				clip.startTime + (timestamp - clip.trimStart) / clip.playbackRate;
			if (effectiveTimelineTime >= clipEnd) break;

			const node = audioContext.createBufferSource();
			node.buffer = buffer;
			node.playbackRate.value = clip.playbackRate;
			const clipGain = audioContext.createGain();
			node.connect(clipGain);
			clipGain.connect(this.masterGain ?? audioContext.destination);

			const startTimestamp =
				this.playbackStartContextTime +
				(effectiveTimelineTime - this.playbackStartTime);
			const chunkTimelineDuration = buffer.duration / clip.playbackRate;
			const clipOffset = Math.max(0, effectiveTimelineTime - clip.startTime);
			const chunkEndOffset = Math.min(
				clip.duration,
				clipOffset + chunkTimelineDuration,
			);
			const startGain = getAudioEnvelopeGain({
				timelineOffset: clipOffset,
				duration: clip.duration,
				fadeInDuration: clip.fadeInDuration,
				fadeOutDuration: clip.fadeOutDuration,
			}) *
				clip.volume *
				dbToGain(clip.normalizationGainDb) *
				clip.roleGain *
				clip.trackVolume *
				clip.masterVolume *
				getDuckingGainAtTime({
					time: effectiveTimelineTime,
					ducking: clip.ducking,
				});
			const endGain = getAudioEnvelopeGain({
				timelineOffset: chunkEndOffset,
				duration: clip.duration,
				fadeInDuration: clip.fadeInDuration,
				fadeOutDuration: clip.fadeOutDuration,
			}) *
				clip.volume *
				dbToGain(clip.normalizationGainDb) *
				clip.roleGain *
				clip.trackVolume *
				clip.masterVolume *
				getDuckingGainAtTime({
					time: clip.startTime + chunkEndOffset,
					ducking: clip.ducking,
				});
			clipGain.gain.setValueAtTime(startGain, Math.max(startTimestamp, audioContext.currentTime));
			clipGain.gain.linearRampToValueAtTime(
				endGain,
				Math.max(startTimestamp, audioContext.currentTime) + chunkTimelineDuration,
			);

			if (startTimestamp >= audioContext.currentTime) {
				node.start(startTimestamp);
			} else {
				const offset = audioContext.currentTime - startTimestamp;
				if (offset < buffer.duration) {
					node.start(audioContext.currentTime, offset);
				} else {
					continue;
				}
			}

			this.queuedSources.add(node);
			node.addEventListener("ended", () => {
				node.disconnect();
				this.queuedSources.delete(node);
			});

			const aheadTime = effectiveTimelineTime - this.getPlaybackTime();
			if (aheadTime >= 1) {
				await this.waitUntilCaughtUp({
					timelineTime: effectiveTimelineTime,
					targetAhead: 1,
				});
				if (sessionId !== this.playbackSessionId) return;
			}
		}

		this.clipIterators.delete(clip.id);
		// don't remove from activeClipIds - prevents scheduler from restarting this clip
		// the set is cleared on stopPlayback anyway
	}

	private waitUntilCaughtUp({
		timelineTime,
		targetAhead,
	}: {
		timelineTime: number;
		targetAhead: number;
	}): Promise<void> {
		return new Promise((resolve) => {
			const checkInterval = setInterval(() => {
				if (!this.editor.playback.getIsPlaying()) {
					clearInterval(checkInterval);
					resolve();
					return;
				}

				const playbackTime = this.getPlaybackTime();
				if (timelineTime - playbackTime < targetAhead) {
					clearInterval(checkInterval);
					resolve();
				}
			}, 100);
		});
	}

	private disposeSinks(): void {
		for (const iterator of this.clipIterators.values()) {
			void iterator.return();
		}
		this.clipIterators.clear();
		this.activeClipIds.clear();

		for (const input of this.inputs.values()) {
			input.dispose();
		}
		this.inputs.clear();
		this.sinks.clear();
	}

	private async getAudioSink({
		clip,
	}: {
		clip: AudioClipSource;
	}): Promise<AudioBufferSink | null> {
		const existingSink = this.sinks.get(clip.sourceKey);
		if (existingSink) return existingSink;

		try {
			const input = new Input({
				source: new BlobSource(clip.file),
				formats: ALL_FORMATS,
			});
			const audioTrack = await input.getPrimaryAudioTrack();
			if (!audioTrack) {
				input.dispose();
				return null;
			}

			const sink = new AudioBufferSink(audioTrack);
			this.inputs.set(clip.sourceKey, input);
			this.sinks.set(clip.sourceKey, sink);
			return sink;
		} catch (error) {
			console.warn("Failed to initialize audio sink:", error);
			return null;
		}
	}

	getProjectMixSummary(): ProjectMixSummary {
		const previewMode = usePreviewStore.getState().previewMode;
		const activeProject = this.editor.project.getActive();
		const tracks =
			previewMode === "project" && activeProject
				? buildProjectAssemblyTracks({ scenes: activeProject.scenes })
				: this.editor.timeline.getTracks();
		return buildProjectMixSummary({
			tracks,
			project: activeProject,
		});
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((listener) => listener());
	}

	async analyzeBeatGrid({
		mediaId,
	}: {
		mediaId: string;
	}): Promise<{ bpm: number | null; beatCount: number }> {
		const asset = await this.editor.media.analyzeBeatGrid({ mediaId });
		const beatAnalysis = asset?.beatAnalysis;
		this.notify();
		return {
			bpm: beatAnalysis?.bpm ?? null,
			beatCount: beatAnalysis?.beats.length ?? 0,
		};
	}

	setSelectedBeatSource({
		mediaId,
	}: {
		mediaId: string | null;
	}): void {
		useTimelineStore.getState().setSelectedBeatSourceMediaId(mediaId);
		this.notify();
	}

	getSceneBeatMarkers(): {
		sourceMediaId: string | null;
		bpm: number | null;
		markers: import("@/types/timeline").SceneBeatMarker[];
	} {
		const { selectedBeatSourceMediaId } = useTimelineStore.getState();
		return resolveSceneBeatMarkers({
			tracks: this.editor.timeline.getTracks(),
			selectedBeatSourceMediaId,
			mediaAssets: this.editor.media.getAssets(),
		});
	}

	async normalizeElement({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): Promise<number> {
		const track = this.editor.timeline.getTrackById({ trackId });
		const element = track?.elements.find((candidate) => candidate.id === elementId);
		if (!element || element.type !== "audio") {
			throw new Error("Normalize requires a selected audio clip.");
		}

		let file: File | null = null;
		if (element.sourceType === "upload") {
			const mediaAsset = this.editor.media
				.getAssets()
				.find((asset) => asset.id === element.mediaId);
			file = mediaAsset?.file ?? null;
		} else {
			const response = await fetch(element.sourceUrl);
			if (!response.ok) {
				throw new Error("Failed to download audio for normalization.");
			}
			const blob = await response.blob();
			file = new File([blob], `${element.name}.mp3`, {
				type: blob.type || "audio/mpeg",
			});
		}

		if (!file) {
			throw new Error("Audio source could not be resolved for normalization.");
		}

		const normalizationGainDb = await analyzeNormalizationGainDb({ file });
		this.editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId,
					updates: { normalizationGainDb },
				},
			],
		});
		return normalizationGainDb;
	}

	async recordVoiceoverStart(): Promise<void> {
		if (typeof window === "undefined" || typeof navigator === "undefined") {
			throw new Error("Voiceover recording is only available in the browser.");
		}
		if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
			throw new Error("Voiceover recording is already in progress.");
		}
		if (!navigator.mediaDevices?.getUserMedia) {
			throw new Error("Microphone recording is not supported in this browser.");
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const recorder = new MediaRecorder(stream);
			this.recordingStream = stream;
			this.mediaRecorder = recorder;
			this.recordingChunks = [];
			this.recordingInsertTime = this.editor.playback.getCurrentTime();
			this.recordingStartedAtMs =
				typeof performance !== "undefined" ? performance.now() : Date.now();

			recorder.addEventListener("dataavailable", (event) => {
				if (event.data && event.data.size > 0) {
					this.recordingChunks.push(event.data);
				}
			});
			recorder.addEventListener("stop", () => {
				this.recordingStream?.getTracks().forEach((track) => track.stop());
				this.recordingStream = null;
			});
			recorder.start();
		} catch (error) {
			const message =
				error instanceof DOMException && error.name === "NotAllowedError"
					? "Microphone access was denied."
					: error instanceof DOMException && error.name === "NotFoundError"
						? "No microphone input device was found."
						: error instanceof Error
							? error.message
							: "Unable to start voiceover recording.";
			throw new Error(message);
		}
	}

	async recordVoiceoverStop(): Promise<{
		mediaId: string;
		trackId: string;
		duration: number;
	}> {
		if (!this.mediaRecorder) {
			throw new Error("Voiceover recording has not started.");
		}
		const recorder = this.mediaRecorder;
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("An active project is required for voiceover recording.");
		}

		const stopped = await new Promise<Blob>((resolve, reject) => {
			const cleanup = () => {
				recorder.removeEventListener("stop", handleStop);
				recorder.removeEventListener("error", handleError);
			};
			const handleStop = () => {
				cleanup();
				const blob = new Blob(this.recordingChunks, {
					type: recorder.mimeType || "audio/webm",
				});
				resolve(blob);
			};
			const handleError = () => {
				cleanup();
				reject(new Error("Voiceover recording was interrupted."));
			};
			recorder.addEventListener("stop", handleStop, { once: true });
			recorder.addEventListener("error", handleError, { once: true });
			recorder.stop();
		});

		this.mediaRecorder = null;
		if (stopped.size === 0) {
			throw new Error("Voiceover recording was empty.");
		}

		const file = new File([stopped], `voiceover-${Date.now()}.webm`, {
			type: stopped.type || "audio/webm",
		});
		const elapsedSeconds = Math.max(
			0.1,
			((typeof performance !== "undefined" ? performance.now() : Date.now()) -
				this.recordingStartedAtMs) /
				1000,
		);
		const duration = elapsedSeconds;
		const asset = await this.editor.media.addMediaAsset({
			projectId: activeProject.metadata.id,
			asset: {
				name: file.name,
				type: "audio",
				file,
				url: URL.createObjectURL(file),
				duration,
				mimeType: file.type,
			},
		});
		if (!asset) {
			throw new Error("Failed to save the voiceover recording.");
		}

		const existingAudioTrack = this.editor.timeline
			.getTracks()
			.find((track) => track.type === "audio");
		const trackId =
			existingAudioTrack?.id ??
			this.editor.timeline.addTrack({
				type: "audio",
			});
		const element = buildUploadAudioElement({
			mediaId: asset.id,
			name: "Voiceover",
			duration,
			startTime: this.recordingInsertTime,
		});
		element.role = "voiceover";
		this.editor.timeline.insertElement({
			placement: { mode: "explicit", trackId },
			element,
		});
		this.notify();

		return {
			mediaId: asset.id,
			trackId,
			duration,
		};
	}
}
