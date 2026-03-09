import type {
	AudioElement,
	LibraryAudioElement,
	TimelineElement,
	TimelineTrack,
} from "@/types/timeline";
import type { MediaAsset } from "@/types/assets";
import type { ProjectAudioSettings, TProject } from "@/types/project";
import {
	canElementHaveAudio,
	getElementPlaybackRate,
} from "@/lib/timeline/element-utils";
import { canTracktHaveAudio } from "@/lib/timeline";
import { mediaSupportsAudio } from "@/lib/media/media-utils";
import { Input, ALL_FORMATS, BlobSource, AudioBufferSink } from "mediabunny";
import { DEFAULT_PROJECT_AUDIO_SETTINGS } from "@/constants/project-constants";

const MAX_AUDIO_CHANNELS = 2;
const EXPORT_SAMPLE_RATE = 44100;

export type CollectedAudioElement = Omit<
	AudioElement,
	"type" | "mediaId" | "name" | "sourceType" | "sourceUrl"
> & {
	buffer: AudioBuffer;
	trackVolume: number;
	role: "voiceover" | "music" | "sfx" | "audio";
	normalizationGainDb: number;
	ducking: AudioDuckingProfile | null;
	masterVolume: number;
};

export function createAudioContext({ sampleRate }: { sampleRate?: number } = {}): AudioContext {
	const AudioContextConstructor =
		window.AudioContext ||
		(window as typeof window & { webkitAudioContext?: typeof AudioContext })
			.webkitAudioContext;

	return new AudioContextConstructor(sampleRate ? { sampleRate } : undefined);
}

export interface DecodedAudio {
	samples: Float32Array;
	sampleRate: number;
}

export async function decodeAudioToFloat32({
	audioBlob,
}: {
	audioBlob: Blob;
}): Promise<DecodedAudio> {
	const audioContext = createAudioContext();
	const arrayBuffer = await audioBlob.arrayBuffer();
	const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

	// mix down to mono
	const numChannels = audioBuffer.numberOfChannels;
	const length = audioBuffer.length;
	const samples = new Float32Array(length);

	for (let i = 0; i < length; i++) {
		let sum = 0;
		for (let channel = 0; channel < numChannels; channel++) {
			sum += audioBuffer.getChannelData(channel)[i];
		}
		samples[i] = sum / numChannels;
	}

	return { samples, sampleRate: audioBuffer.sampleRate };
}

export async function extractMediaAssetAudioToFloat32({
	mediaAsset,
}: {
	mediaAsset: MediaAsset;
}): Promise<DecodedAudio> {
	if (mediaAsset.type === "audio") {
		return decodeAudioToFloat32({ audioBlob: mediaAsset.file });
	}

	if (mediaAsset.type !== "video") {
		throw new Error(`Media type '${mediaAsset.type}' cannot be transcribed.`);
	}

	const audioContext = createAudioContext();
	const audioBuffer = await resolveAudioBufferForVideoElement({
		mediaAsset,
		audioContext,
	});
	if (!audioBuffer) {
		throw new Error("No audio track found in media asset.");
	}

	const samples = mixAudioBufferToMono({ audioBuffer });
	return {
		samples,
		sampleRate: audioBuffer.sampleRate,
	};
}

export async function collectAudioElements({
	tracks,
	mediaAssets,
	audioContext,
	project,
}: {
	tracks: TimelineTrack[];
	mediaAssets: MediaAsset[];
	audioContext: AudioContext;
	project?: TProject | null;
}): Promise<CollectedAudioElement[]> {
	const mediaMap = new Map<string, MediaAsset>(
		mediaAssets.map((media) => [media.id, media]),
	);
	const pendingElements: Array<Promise<CollectedAudioElement | null>> = [];
	const mixSettings = getProjectAudioSettings({ project });
	const duckingProfile = buildAudioDuckingProfile({
		tracks,
		project,
		mixSettings,
	});

	for (const track of tracks) {
		if (canTracktHaveAudio(track) && track.muted) continue;
		const trackVolume = track.type === "audio" ? track.volume ?? 1 : 1;

		for (const element of track.elements) {
			if (!canElementHaveAudio(element)) continue;
			if (element.duration <= 0) continue;

			const isTrackMuted = canTracktHaveAudio(track) && track.muted;

			if (element.type === "audio") {
				pendingElements.push(
					resolveAudioBufferForElement({
						element,
						mediaMap,
						audioContext,
					}).then((audioBuffer) => {
						if (!audioBuffer) return null;
						return {
							id: element.id,
							buffer: audioBuffer,
							startTime: element.startTime,
							duration: element.duration,
							trimStart: element.trimStart,
							trimEnd: element.trimEnd,
							playbackRate: getElementPlaybackRate({ element }),
							volume: element.volume,
							muted: element.muted || isTrackMuted,
							role: element.role ?? "audio",
							normalizationGainDb: element.normalizationGainDb ?? 0,
							trackVolume,
							masterVolume: mixSettings.masterVolume,
							fadeInDuration: element.fadeInDuration ?? 0,
							fadeOutDuration: element.fadeOutDuration ?? 0,
							ducking: shouldDuckAudioElement({ element, duckingProfile })
								? duckingProfile
								: null,
						};
					}),
				);
				continue;
			}

			if (element.type === "video") {
				const mediaAsset = mediaMap.get(element.mediaId);
				if (!mediaAsset || !mediaSupportsAudio({ media: mediaAsset })) continue;

				pendingElements.push(
					resolveAudioBufferForVideoElement({
						mediaAsset,
						audioContext,
					}).then((audioBuffer) => {
						if (!audioBuffer) return null;
						const elementMuted = element.muted ?? false;
						return {
							id: element.id,
							buffer: audioBuffer,
							startTime: element.startTime,
							duration: element.duration,
							trimStart: element.trimStart,
							trimEnd: element.trimEnd,
							playbackRate: getElementPlaybackRate({ element }),
							volume: 1,
							muted: elementMuted || isTrackMuted,
							role: "audio",
							normalizationGainDb: 0,
							trackVolume,
							masterVolume: mixSettings.masterVolume,
							fadeInDuration: 0,
							fadeOutDuration: 0,
							ducking: null,
						};
					}),
				);
			}
		}
	}

	const resolvedElements = await Promise.all(pendingElements);
	const audioElements: CollectedAudioElement[] = [];
	for (const element of resolvedElements) {
		if (element) audioElements.push(element);
	}
	return audioElements;
}

async function resolveAudioBufferForElement({
	element,
	mediaMap,
	audioContext,
}: {
	element: AudioElement;
	mediaMap: Map<string, MediaAsset>;
	audioContext: AudioContext;
}): Promise<AudioBuffer | null> {
	try {
		if (element.sourceType === "upload") {
			const asset = mediaMap.get(element.mediaId);
			if (!asset || asset.type !== "audio") return null;

			const arrayBuffer = await asset.file.arrayBuffer();
			return await audioContext.decodeAudioData(arrayBuffer.slice(0));
		}

		if (element.buffer) return element.buffer;

		const response = await fetch(element.sourceUrl);
		if (!response.ok) {
			throw new Error(`Library audio fetch failed: ${response.status}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		return await audioContext.decodeAudioData(arrayBuffer.slice(0));
	} catch (error) {
		console.warn("Failed to decode audio:", error);
		return null;
	}
}

async function resolveAudioBufferForVideoElement({
	mediaAsset,
	audioContext,
}: {
	mediaAsset: MediaAsset;
	audioContext: AudioContext;
}): Promise<AudioBuffer | null> {
	const input = new Input({
		source: new BlobSource(mediaAsset.file),
		formats: ALL_FORMATS,
	});

	try {
		const audioTrack = await input.getPrimaryAudioTrack();
		if (!audioTrack) return null;

		const sink = new AudioBufferSink(audioTrack);
		const targetSampleRate = audioContext.sampleRate;

		const chunks: AudioBuffer[] = [];
		let totalSamples = 0;

		for await (const { buffer } of sink.buffers(0)) {
			chunks.push(buffer);
			totalSamples += buffer.length;
		}

		if (chunks.length === 0) return null;

		const nativeSampleRate = chunks[0].sampleRate;
		const numChannels = Math.min(MAX_AUDIO_CHANNELS, chunks[0].numberOfChannels);

		const nativeChannels = Array.from(
			{ length: numChannels },
			() => new Float32Array(totalSamples),
		);
		let offset = 0;
		for (const chunk of chunks) {
			for (let channel = 0; channel < numChannels; channel++) {
				const sourceData = chunk.getChannelData(Math.min(channel, chunk.numberOfChannels - 1));
				nativeChannels[channel].set(sourceData, offset);
			}
			offset += chunk.length;
		}

		// use OfflineAudioContext for high-quality resampling to target rate
		const outputSamples = Math.ceil(totalSamples * (targetSampleRate / nativeSampleRate));
		const offlineContext = new OfflineAudioContext(numChannels, outputSamples, targetSampleRate);

		const nativeBuffer = audioContext.createBuffer(numChannels, totalSamples, nativeSampleRate);
		for (let ch = 0; ch < numChannels; ch++) {
			nativeBuffer.copyToChannel(nativeChannels[ch], ch);
		}

		const sourceNode = offlineContext.createBufferSource();
		sourceNode.buffer = nativeBuffer;
		sourceNode.connect(offlineContext.destination);
		sourceNode.start(0);

		return await offlineContext.startRendering();
	} catch (error) {
		console.warn("Failed to decode video audio:", error);
		return null;
	} finally {
		input.dispose();
	}
}

function mixAudioBufferToMono({
	audioBuffer,
}: {
	audioBuffer: AudioBuffer;
}): Float32Array {
	const numChannels = audioBuffer.numberOfChannels;
	const length = audioBuffer.length;
	const samples = new Float32Array(length);

	for (let i = 0; i < length; i++) {
		let sum = 0;
		for (let channel = 0; channel < numChannels; channel++) {
			sum += audioBuffer.getChannelData(channel)[i];
		}
		samples[i] = sum / Math.max(1, numChannels);
	}

	return samples;
}

interface AudioMixSource {
	file: File;
	startTime: number;
	duration: number;
	trimStart: number;
	trimEnd: number;
	playbackRate: number;
	volume: number;
	muted: boolean;
	role: "voiceover" | "music" | "sfx" | "audio";
	normalizationGainDb: number;
	trackVolume: number;
	masterVolume: number;
	fadeInDuration: number;
	fadeOutDuration: number;
	ducking: AudioDuckingProfile | null;
}

export interface AudioClipSource {
	id: string;
	sourceKey: string;
	file: File;
	startTime: number;
	duration: number;
	trimStart: number;
	trimEnd: number;
	playbackRate: number;
	volume: number;
	muted: boolean;
	role: "voiceover" | "music" | "sfx" | "audio";
	normalizationGainDb: number;
	trackVolume: number;
	masterVolume: number;
	fadeInDuration: number;
	fadeOutDuration: number;
	ducking: AudioDuckingProfile | null;
}

export interface AudioDialogueWindow {
	startTime: number;
	endTime: number;
}

export interface AudioDuckingProfile {
	enabled: boolean;
	amount: number;
	attackMs: number;
	releaseMs: number;
	dialogueWindows: AudioDialogueWindow[];
}

export interface ProjectMixSummary {
	masterVolume: number;
	duckingEnabled: boolean;
	duckingAmount: number;
	dialogueWindowCount: number;
	musicClipCount: number;
	voiceoverClipCount: number;
}

async function fetchLibraryAudioSource({
	element,
	trackVolume,
	masterVolume,
	ducking,
}: {
	element: LibraryAudioElement;
	trackVolume: number;
	masterVolume: number;
	ducking: AudioDuckingProfile | null;
}): Promise<AudioMixSource | null> {
	try {
		const response = await fetch(element.sourceUrl);
		if (!response.ok) {
			throw new Error(`Library audio fetch failed: ${response.status}`);
		}

		const blob = await response.blob();
		const file = new File([blob], `${element.name}.mp3`, {
			type: "audio/mpeg",
		});

		return {
			file,
			startTime: element.startTime,
			duration: element.duration,
			trimStart: element.trimStart,
			trimEnd: element.trimEnd,
			playbackRate: getElementPlaybackRate({ element }),
			volume: element.volume,
			muted: element.muted ?? false,
			role: element.role ?? "audio",
			normalizationGainDb: element.normalizationGainDb ?? 0,
			trackVolume,
			masterVolume,
			fadeInDuration: element.fadeInDuration ?? 0,
			fadeOutDuration: element.fadeOutDuration ?? 0,
			ducking,
		};
	} catch (error) {
		console.warn("Failed to fetch library audio:", error);
		return null;
	}
}

async function fetchLibraryAudioClip({
	element,
	muted,
	trackVolume,
	masterVolume,
	ducking,
}: {
	element: LibraryAudioElement;
	muted: boolean;
	trackVolume: number;
	masterVolume: number;
	ducking: AudioDuckingProfile | null;
}): Promise<AudioClipSource | null> {
	try {
		const response = await fetch(element.sourceUrl);
		if (!response.ok) {
			throw new Error(`Library audio fetch failed: ${response.status}`);
		}

		const blob = await response.blob();
		const file = new File([blob], `${element.name}.mp3`, {
			type: "audio/mpeg",
		});

		return {
			id: element.id,
			sourceKey: element.id,
			file,
			startTime: element.startTime,
			duration: element.duration,
			trimStart: element.trimStart,
			trimEnd: element.trimEnd,
			playbackRate: getElementPlaybackRate({ element }),
			volume: element.volume,
			muted,
			role: element.role ?? "audio",
			normalizationGainDb: element.normalizationGainDb ?? 0,
			trackVolume,
			masterVolume,
			fadeInDuration: element.fadeInDuration ?? 0,
			fadeOutDuration: element.fadeOutDuration ?? 0,
			ducking,
		};
	} catch (error) {
		console.warn("Failed to fetch library audio:", error);
		return null;
	}
}

function collectMediaAudioSource({
	element,
	mediaAsset,
	trackVolume,
	masterVolume,
	ducking,
}: {
	element: TimelineElement;
	mediaAsset: MediaAsset;
	trackVolume: number;
	masterVolume: number;
	ducking: AudioDuckingProfile | null;
}): AudioMixSource {
	const volume = element.type === "audio" ? element.volume : 1;
	const fadeInDuration = element.type === "audio" ? element.fadeInDuration ?? 0 : 0;
	const fadeOutDuration = element.type === "audio" ? element.fadeOutDuration ?? 0 : 0;
	const muted = "muted" in element ? (element.muted ?? false) : false;
	return {
		file: mediaAsset.file,
		startTime: element.startTime,
		duration: element.duration,
		trimStart: element.trimStart,
		trimEnd: element.trimEnd,
		playbackRate: getElementPlaybackRate({ element }),
		volume,
		muted,
		role: element.type === "audio" ? (element.role ?? "audio") : "audio",
		normalizationGainDb:
			element.type === "audio" ? (element.normalizationGainDb ?? 0) : 0,
		trackVolume,
		masterVolume,
		fadeInDuration,
		fadeOutDuration,
		ducking,
	};
}

function collectMediaAudioClip({
	element,
	mediaAsset,
	muted,
	trackVolume,
	masterVolume,
	ducking,
}: {
	element: TimelineElement;
	mediaAsset: MediaAsset;
	muted: boolean;
	trackVolume: number;
	masterVolume: number;
	ducking: AudioDuckingProfile | null;
}): AudioClipSource {
	const volume = element.type === "audio" ? element.volume : 1;
	const fadeInDuration = element.type === "audio" ? element.fadeInDuration ?? 0 : 0;
	const fadeOutDuration = element.type === "audio" ? element.fadeOutDuration ?? 0 : 0;
	return {
		id: element.id,
		sourceKey: mediaAsset.id,
		file: mediaAsset.file,
		startTime: element.startTime,
		duration: element.duration,
		trimStart: element.trimStart,
		trimEnd: element.trimEnd,
		playbackRate: getElementPlaybackRate({ element }),
		volume,
		muted,
		role: element.type === "audio" ? (element.role ?? "audio") : "audio",
		normalizationGainDb:
			element.type === "audio" ? (element.normalizationGainDb ?? 0) : 0,
		trackVolume,
		masterVolume,
		fadeInDuration,
		fadeOutDuration,
		ducking,
	};
}

export async function collectAudioMixSources({
	tracks,
	mediaAssets,
	project,
}: {
	tracks: TimelineTrack[];
	mediaAssets: MediaAsset[];
	project?: TProject | null;
}): Promise<AudioMixSource[]> {
	const audioMixSources: AudioMixSource[] = [];
	const mediaMap = new Map<string, MediaAsset>(
		mediaAssets.map((asset) => [asset.id, asset]),
	);
	const pendingLibrarySources: Array<Promise<AudioMixSource | null>> = [];
	const mixSettings = getProjectAudioSettings({ project });
	const duckingProfile = buildAudioDuckingProfile({
		tracks,
		project,
		mixSettings,
	});

	for (const track of tracks) {
		if (canTracktHaveAudio(track) && track.muted) continue;
		const trackVolume = track.type === "audio" ? track.volume ?? 1 : 1;

		for (const element of track.elements) {
			if (!canElementHaveAudio(element)) continue;
			if ("muted" in element && element.muted) continue;
			const ducking = shouldDuckAudioElement({ element, duckingProfile })
				? duckingProfile
				: null;

			if (element.type === "audio") {
				if (element.sourceType === "upload") {
					const mediaAsset = mediaMap.get(element.mediaId);
					if (!mediaAsset) continue;

					audioMixSources.push(
						collectMediaAudioSource({
							element,
							mediaAsset,
							trackVolume,
							masterVolume: mixSettings.masterVolume,
							ducking,
						}),
					);
				} else {
					pendingLibrarySources.push(
						fetchLibraryAudioSource({
							element,
							trackVolume,
							masterVolume: mixSettings.masterVolume,
							ducking,
						}),
					);
				}
				continue;
			}

			if (element.type === "video") {
				const mediaAsset = mediaMap.get(element.mediaId);
				if (!mediaAsset) continue;

				if (mediaSupportsAudio({ media: mediaAsset })) {
					audioMixSources.push(
						collectMediaAudioSource({
							element,
							mediaAsset,
							trackVolume,
							masterVolume: mixSettings.masterVolume,
							ducking,
						}),
					);
				}
			}
		}
	}

	const resolvedLibrarySources = await Promise.all(pendingLibrarySources);
	for (const source of resolvedLibrarySources) {
		if (source && !source.muted) audioMixSources.push(source);
	}

	return audioMixSources;
}

export async function collectAudioClips({
	tracks,
	mediaAssets,
	project,
}: {
	tracks: TimelineTrack[];
	mediaAssets: MediaAsset[];
	project?: TProject | null;
}): Promise<AudioClipSource[]> {
	const clips: AudioClipSource[] = [];
	const mediaMap = new Map<string, MediaAsset>(
		mediaAssets.map((asset) => [asset.id, asset]),
	);
	const pendingLibraryClips: Array<Promise<AudioClipSource | null>> = [];
	const mixSettings = getProjectAudioSettings({ project });
	const duckingProfile = buildAudioDuckingProfile({
		tracks,
		project,
		mixSettings,
	});

	for (const track of tracks) {
		const isTrackMuted = canTracktHaveAudio(track) && track.muted;
		const trackVolume = track.type === "audio" ? track.volume ?? 1 : 1;

		for (const element of track.elements) {
			if (!canElementHaveAudio(element)) continue;

			const isElementMuted =
				"muted" in element ? (element.muted ?? false) : false;
			const muted = isTrackMuted || isElementMuted;
			const ducking = shouldDuckAudioElement({ element, duckingProfile })
				? duckingProfile
				: null;

			if (element.type === "audio") {
				if (element.sourceType === "upload") {
					const mediaAsset = mediaMap.get(element.mediaId);
					if (!mediaAsset) continue;

					clips.push(
						collectMediaAudioClip({
							element,
							mediaAsset,
							muted,
							trackVolume,
							masterVolume: mixSettings.masterVolume,
							ducking,
						}),
					);
				} else {
					pendingLibraryClips.push(
						fetchLibraryAudioClip({
							element,
							muted,
							trackVolume,
							masterVolume: mixSettings.masterVolume,
							ducking,
						}),
					);
				}
				continue;
			}

			if (element.type === "video") {
				const mediaAsset = mediaMap.get(element.mediaId);
				if (!mediaAsset) continue;

				if (mediaSupportsAudio({ media: mediaAsset })) {
					clips.push(
						collectMediaAudioClip({
							element,
							mediaAsset,
							muted,
							trackVolume,
							masterVolume: mixSettings.masterVolume,
							ducking,
						}),
					);
				}
			}
		}
	}

	const resolvedLibraryClips = await Promise.all(pendingLibraryClips);
	for (const clip of resolvedLibraryClips) {
		if (clip) clips.push(clip);
	}

	return clips;
}

export async function createTimelineAudioBuffer({
	tracks,
	mediaAssets,
	duration,
	sampleRate = EXPORT_SAMPLE_RATE,
	audioContext,
	project,
}: {
	tracks: TimelineTrack[];
	mediaAssets: MediaAsset[];
	duration: number;
	sampleRate?: number;
	audioContext?: AudioContext;
	project?: TProject | null;
}): Promise<AudioBuffer | null> {
	const context = audioContext ?? createAudioContext({ sampleRate });

	const audioElements = await collectAudioElements({
		tracks,
		mediaAssets,
		audioContext: context,
		project,
	});

	if (audioElements.length === 0) return null;

	const outputChannels = 2;
	const outputLength = Math.ceil(duration * sampleRate);
	const outputBuffer = context.createBuffer(
		outputChannels,
		outputLength,
		sampleRate,
	);

	for (const element of audioElements) {
		if (element.muted) continue;

		mixAudioChannels({
			element: {
				...element,
				volume: element.volume * dbToGain(element.normalizationGainDb),
			},
			trackVolume: element.trackVolume,
			masterVolume: element.masterVolume,
			ducking: element.ducking,
			outputBuffer,
			outputLength,
			sampleRate,
		});
	}

	return outputBuffer;
}

function mixAudioChannels({
	element,
	trackVolume,
	masterVolume,
	ducking,
	outputBuffer,
	outputLength,
	sampleRate,
}: {
	element: CollectedAudioElement;
	trackVolume: number;
	masterVolume: number;
	ducking: AudioDuckingProfile | null;
	outputBuffer: AudioBuffer;
	outputLength: number;
	sampleRate: number;
}): void {
	const { buffer, startTime, trimStart, duration: elementDuration } = element;
	const playbackRate = Math.max(0.25, element.playbackRate ?? 1);
	const sourceStartSample = Math.floor(trimStart * buffer.sampleRate);
	const outputStartSample = Math.floor(startTime * sampleRate);
	const outputSampleCount = Math.floor(elementDuration * sampleRate);

	const outputChannels = 2;
	for (let channel = 0; channel < outputChannels; channel++) {
		const outputData = outputBuffer.getChannelData(channel);
		const sourceChannel = Math.min(channel, buffer.numberOfChannels - 1);
		const sourceData = buffer.getChannelData(sourceChannel);

		for (let i = 0; i < outputSampleCount; i++) {
			const outputIndex = outputStartSample + i;
			if (outputIndex >= outputLength) break;

			const sourceIndex =
				sourceStartSample + Math.floor((i * playbackRate * buffer.sampleRate) / sampleRate);
			if (sourceIndex >= sourceData.length) break;

			const timelineOffset = i / sampleRate;
			const absoluteTimelineTime = startTime + timelineOffset;
			outputData[outputIndex] +=
				sourceData[sourceIndex] *
				(element.volume ?? 1) *
				trackVolume *
				masterVolume *
				getDuckingGainAtTime({
					time: absoluteTimelineTime,
					ducking,
				}) *
				getAudioEnvelopeGain({
					timelineOffset,
					duration: elementDuration,
					fadeInDuration: element.fadeInDuration ?? 0,
					fadeOutDuration: element.fadeOutDuration ?? 0,
				});
		}
	}
}

export function getAudioEnvelopeGain({
	timelineOffset,
	duration,
	fadeInDuration,
	fadeOutDuration,
}: {
	timelineOffset: number;
	duration: number;
	fadeInDuration: number;
	fadeOutDuration: number;
}): number {
	const safeFadeIn = Math.max(0, Math.min(fadeInDuration, duration));
	const safeFadeOut = Math.max(0, Math.min(fadeOutDuration, duration));
	let gain = 1;

	if (safeFadeIn > 0 && timelineOffset < safeFadeIn) {
		gain = Math.min(gain, timelineOffset / safeFadeIn);
	}

	const fadeOutStart = Math.max(0, duration - safeFadeOut);
	if (safeFadeOut > 0 && timelineOffset > fadeOutStart) {
		gain = Math.min(gain, (duration - timelineOffset) / safeFadeOut);
	}

	return Math.max(0, Math.min(1, gain));
}

export function dbToGain(db: number): number {
	return Math.pow(10, db / 20);
}

export function getProjectAudioSettings({
	project,
}: {
	project?: TProject | null;
}): ProjectAudioSettings {
	return {
		...DEFAULT_PROJECT_AUDIO_SETTINGS,
		...(project?.settings.audio ?? {}),
	};
}

export async function analyzeNormalizationGainDb({
	file,
}: {
	file: File;
}): Promise<number> {
	const { samples } = await decodeAudioToFloat32({ audioBlob: file });
	if (samples.length === 0) return 0;

	let peak = 0;
	let sumSquares = 0;
	for (let i = 0; i < samples.length; i++) {
		const sample = samples[i] ?? 0;
		const abs = Math.abs(sample);
		if (abs > peak) peak = abs;
		sumSquares += sample * sample;
	}

	if (peak <= 1e-6) return 0;

	const rms = Math.sqrt(sumSquares / samples.length);
	const peakDb = 20 * Math.log10(peak);
	const rmsDb = rms > 1e-6 ? 20 * Math.log10(rms) : -60;
	const targetPeakDb = -1;
	const targetRmsDb = -18;
	const gainDb = Math.min(targetPeakDb - peakDb, targetRmsDb - rmsDb);
	return Math.max(-24, Math.min(24, gainDb));
}

export function buildAudioDuckingProfile({
	tracks,
	project,
	mixSettings,
	}: {
		tracks: TimelineTrack[];
		project?: TProject | null;
		mixSettings: ProjectAudioSettings;
	}): AudioDuckingProfile | null {
	if (!mixSettings.duckingEnabled) return null;
	const dialogueWindows = collectDialogueWindows({ tracks, project });
	if (dialogueWindows.length === 0) return null;
	return {
		enabled: true,
		amount: Math.max(0, Math.min(1, mixSettings.duckingAmount)),
		attackMs: Math.max(0, mixSettings.duckingAttackMs),
		releaseMs: Math.max(0, mixSettings.duckingReleaseMs),
		dialogueWindows,
	};
}

export function getDuckingGainAtTime({
	time,
	ducking,
}: {
	time: number;
	ducking: AudioDuckingProfile | null;
}): number {
	if (!ducking?.enabled || ducking.dialogueWindows.length === 0) return 1;
	const targetGain = 1 - ducking.amount;
	const attackSeconds = ducking.attackMs / 1000;
	const releaseSeconds = ducking.releaseMs / 1000;
	let gain = 1;

	for (const window of ducking.dialogueWindows) {
		if (time >= window.startTime && time <= window.endTime) {
			gain = Math.min(gain, targetGain);
			continue;
		}
		if (attackSeconds > 0 && time >= window.startTime - attackSeconds && time < window.startTime) {
			const progress = (time - (window.startTime - attackSeconds)) / attackSeconds;
			gain = Math.min(gain, 1 - ducking.amount * Math.max(0, Math.min(1, progress)));
		}
		if (releaseSeconds > 0 && time > window.endTime && time <= window.endTime + releaseSeconds) {
			const progress = (time - window.endTime) / releaseSeconds;
			gain = Math.min(
				gain,
				targetGain + (1 - targetGain) * Math.max(0, Math.min(1, progress)),
			);
		}
	}

	return Math.max(0, Math.min(1, gain));
}

export function buildProjectMixSummary({
	tracks,
	project,
}: {
	tracks: TimelineTrack[];
	project?: TProject | null;
}): ProjectMixSummary {
	const mixSettings = getProjectAudioSettings({ project });
	const duckingProfile = buildAudioDuckingProfile({
		tracks,
		project,
		mixSettings,
	});
	let musicClipCount = 0;
	let voiceoverClipCount = 0;
	for (const track of tracks) {
		for (const element of track.elements) {
			if (element.type !== "audio") continue;
			if ((element.role ?? "audio") === "music") musicClipCount += 1;
			if ((element.role ?? "audio") === "voiceover") voiceoverClipCount += 1;
		}
	}
	return {
		masterVolume: mixSettings.masterVolume,
		duckingEnabled: mixSettings.duckingEnabled,
		duckingAmount: mixSettings.duckingAmount,
		dialogueWindowCount: duckingProfile?.dialogueWindows.length ?? 0,
		musicClipCount,
		voiceoverClipCount,
	};
}

function shouldDuckAudioElement({
	element,
	duckingProfile,
}: {
	element: TimelineElement;
	duckingProfile: AudioDuckingProfile | null;
}): boolean {
	return Boolean(
		duckingProfile &&
			element.type === "audio" &&
			(element.role ?? "audio") === "music",
	);
}

function collectDialogueWindows({
	tracks,
	project,
}: {
	tracks: TimelineTrack[];
	project?: TProject | null;
}): AudioDialogueWindow[] {
	const windows: AudioDialogueWindow[] = [];
	const transcriptByMediaId = project?.clipforge?.mediaMetadataById ?? {};

	for (const track of tracks) {
		if (canTracktHaveAudio(track) && track.muted) continue;
		for (const element of track.elements) {
			if (!canElementHaveAudio(element)) continue;
			if ("muted" in element && element.muted) continue;

			if (element.type === "audio" && (element.role ?? "audio") === "voiceover") {
				windows.push({
					startTime: element.startTime,
					endTime: element.startTime + element.duration,
				});
				continue;
			}

			const mediaId = "mediaId" in element ? element.mediaId : null;
			const metadata = mediaId ? transcriptByMediaId[mediaId] : null;
			const words = metadata?.words ?? [];
			if (words.length === 0) continue;
			const playbackRate = getElementPlaybackRate({ element });
			const visibleEnd = element.trimStart + element.duration * playbackRate;

			for (const word of words) {
				const wordStart = word.start_ms / 1000;
				const wordEnd = word.end_ms / 1000;
				if (wordEnd <= element.trimStart || wordStart >= visibleEnd) {
					continue;
				}
				const localStart = Math.max(0, (wordStart - element.trimStart) / playbackRate);
				const localEnd = Math.max(localStart, (wordEnd - element.trimStart) / playbackRate);
				windows.push({
					startTime: element.startTime + localStart,
					endTime: element.startTime + Math.min(element.duration, localEnd),
				});
			}
		}
	}

	return mergeDialogueWindows({ windows });
}

function mergeDialogueWindows({
	windows,
}: {
	windows: AudioDialogueWindow[];
}): AudioDialogueWindow[] {
	if (windows.length === 0) return [];
	const sorted = [...windows]
		.filter((window) => window.endTime > window.startTime)
		.sort((a, b) => a.startTime - b.startTime);
	const merged: AudioDialogueWindow[] = [sorted[0] as AudioDialogueWindow];
	for (let index = 1; index < sorted.length; index += 1) {
		const current = sorted[index] as AudioDialogueWindow;
		const previous = merged[merged.length - 1] as AudioDialogueWindow;
		if (current.startTime <= previous.endTime + 0.05) {
			previous.endTime = Math.max(previous.endTime, current.endTime);
			continue;
		}
		merged.push({ ...current });
	}
	return merged;
}
