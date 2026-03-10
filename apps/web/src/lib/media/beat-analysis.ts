import type { MediaAsset, MediaBeatAnalysis } from "@/types/assets";
import type {
	AudioElement,
	SceneBeatMarker,
	TimelineTrack,
	UploadAudioElement,
} from "@/types/timeline";
import { getElementPlaybackRate } from "@/lib/timeline";
import { decodeAudioToFloat32 } from "@/lib/media/audio";

const BEAT_ANALYSIS_VERSION = 1 as const;
const MIN_BPM = 70;
const MAX_BPM = 170;
const WINDOW_SECONDS = 0.025;
const MIN_PEAK_DISTANCE_SECONDS = 0.18;
const DOWNBEAT_INTERVAL = 4;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[middle - 1] + sorted[middle]) / 2;
	}
	return sorted[middle] ?? null;
}

function buildEnergyEnvelope({
	samples,
	sampleRate,
}: {
	samples: Float32Array;
	sampleRate: number;
}): { times: number[]; energies: number[] } {
	const windowSize = Math.max(128, Math.floor(sampleRate * WINDOW_SECONDS));
	const hopSize = Math.max(64, Math.floor(windowSize / 2));
	const energies: number[] = [];
	const times: number[] = [];

	for (let start = 0; start + windowSize <= samples.length; start += hopSize) {
		let sum = 0;
		for (let i = start; i < start + windowSize; i += 1) {
			const sample = samples[i] ?? 0;
			sum += sample * sample;
		}
		energies.push(Math.sqrt(sum / windowSize));
		times.push(start / sampleRate);
	}

	return { times, energies };
}

function detectOnsetPeaks({
	times,
	energies,
}: {
	times: number[];
	energies: number[];
}): number[] {
	if (energies.length < 4) return [];
	const mean =
		energies.reduce((sum, value) => sum + value, 0) /
		Math.max(1, energies.length);
	const threshold = mean * 1.15;
	const peaks: number[] = [];
	let lastPeakTime = -Infinity;

	for (let i = 1; i < energies.length - 1; i += 1) {
		const previous = energies[i - 1] ?? 0;
		const current = energies[i] ?? 0;
		const next = energies[i + 1] ?? 0;
		const localMean =
			(previous + current + next + (energies[i + 2] ?? next)) / 4;
		const prominence = current - localMean;
		const time = times[i] ?? 0;

		if (
			current > threshold &&
			current >= previous &&
			current >= next &&
			prominence > mean * 0.04 &&
			time - lastPeakTime >= MIN_PEAK_DISTANCE_SECONDS
		) {
			peaks.push(time);
			lastPeakTime = time;
		}
	}

	return peaks;
}

function estimateBpm({ peaks }: { peaks: number[] }): number | null {
	if (peaks.length < 3) return null;
	const candidateBpms: number[] = [];
	for (let i = 1; i < peaks.length; i += 1) {
		const delta = peaks[i] - peaks[i - 1];
		if (delta <= 1e-3) continue;
		let bpm = 60 / delta;
		while (bpm < MIN_BPM) bpm *= 2;
		while (bpm > MAX_BPM) bpm /= 2;
		if (bpm >= MIN_BPM && bpm <= MAX_BPM) {
			candidateBpms.push(bpm);
		}
	}
	const bpm = median(candidateBpms);
	return bpm ? Math.round(bpm) : null;
}

function buildBeatGrid({
	peaks,
	bpm,
	duration,
}: {
	peaks: number[];
	bpm: number | null;
	duration: number;
}): { beats: number[]; downbeats: number[] } {
	if (!bpm || duration <= 0) {
		return { beats: [], downbeats: [] };
	}

	const interval = 60 / bpm;
	const anchor = peaks[0] ?? 0;
	const beats: number[] = [];
	const downbeats: number[] = [];

	let beatIndex = 0;
	for (let time = anchor; time <= duration + interval * 0.5; time += interval) {
		const rounded = Number(time.toFixed(4));
		if (rounded < 0) continue;
		if (rounded > duration + 1e-4) break;
		beats.push(rounded);
		if (beatIndex % DOWNBEAT_INTERVAL === 0) {
			downbeats.push(rounded);
		}
		beatIndex += 1;
	}

	return { beats, downbeats };
}

export async function analyzeBeatGridFromFile({
	file,
}: {
	file: File;
}): Promise<MediaBeatAnalysis> {
	const { samples, sampleRate } = await decodeAudioToFloat32({ audioBlob: file });
	if (samples.length === 0 || sampleRate <= 0) {
		return {
			bpm: null,
			beats: [],
			downbeats: [],
			analyzedAt: new Date().toISOString(),
			version: BEAT_ANALYSIS_VERSION,
		};
	}

	const { times, energies } = buildEnergyEnvelope({ samples, sampleRate });
	const peaks = detectOnsetPeaks({ times, energies });
	const bpm = estimateBpm({ peaks });
	const duration = samples.length / sampleRate;
	const { beats, downbeats } = buildBeatGrid({ peaks, bpm, duration });

	return {
		bpm,
		beats,
		downbeats,
		analyzedAt: new Date().toISOString(),
		version: BEAT_ANALYSIS_VERSION,
	};
}

export function mapBeatAnalysisToTimeline({
	element,
	beatAnalysis,
}: {
	element: AudioElement;
	beatAnalysis: MediaBeatAnalysis | null | undefined;
}): SceneBeatMarker[] {
	if (element.sourceType !== "upload") {
		return [];
	}
	if (!beatAnalysis || beatAnalysis.beats.length === 0) {
		return [];
	}

	const playbackRate = getElementPlaybackRate({ element });
	const visibleSourceStart = element.trimStart;
	const visibleSourceEnd = visibleSourceStart + element.duration * playbackRate;
	const downbeatSet = new Set(beatAnalysis.downbeats.map((time) => Number(time.toFixed(4))));
	const markers: SceneBeatMarker[] = [];

	for (const beat of beatAnalysis.beats) {
		if (beat < visibleSourceStart - 1e-4 || beat > visibleSourceEnd + 1e-4) {
			continue;
		}
		const timelineTime = element.startTime + (beat - visibleSourceStart) / playbackRate;
		markers.push({
			time: Number(timelineTime.toFixed(4)),
			kind: downbeatSet.has(Number(beat.toFixed(4))) ? "downbeat" : "beat",
			sourceMediaId: element.mediaId,
		});
	}

	return markers;
}

export function resolveSceneBeatMarkers({
	tracks,
	selectedBeatSourceMediaId,
	mediaAssets,
}: {
	tracks: TimelineTrack[];
	selectedBeatSourceMediaId: string | null;
	mediaAssets: MediaAsset[];
}): {
	sourceMediaId: string | null;
	bpm: number | null;
	markers: SceneBeatMarker[];
} {
	const musicElements = tracks
		.flatMap((track) =>
			track.type === "audio"
				? track.elements.filter(
						(element): element is UploadAudioElement =>
							element.type === "audio" &&
							element.sourceType === "upload" &&
							(element.role ?? "audio") === "music",
					)
				: [],
		)
		.sort((a, b) => a.startTime - b.startTime);

	const targetSourceMediaId =
		selectedBeatSourceMediaId &&
		musicElements.some((element) => element.mediaId === selectedBeatSourceMediaId)
			? selectedBeatSourceMediaId
			: (musicElements[0]?.mediaId ?? null);

	if (!targetSourceMediaId) {
		return { sourceMediaId: null, bpm: null, markers: [] };
	}
	const assetMap = new Map(mediaAssets.map((asset) => [asset.id, asset]));
	const targetAsset = assetMap.get(targetSourceMediaId);
	const targetElements = musicElements.filter(
		(element) => element.mediaId === targetSourceMediaId,
	);
	const markerMap = new Map<string, SceneBeatMarker>();
	for (const element of targetElements) {
		const markers = mapBeatAnalysisToTimeline({
			element,
			beatAnalysis: targetAsset?.beatAnalysis,
		});
		for (const marker of markers) {
			markerMap.set(`${marker.kind}:${marker.time.toFixed(4)}`, marker);
		}
	}

	return {
		sourceMediaId: targetSourceMediaId,
		bpm: targetAsset?.beatAnalysis?.bpm ?? null,
		markers: [...markerMap.values()].sort((a, b) => a.time - b.time),
	};
}

export function quantizeTimeToMarkers({
	time,
	markers,
}: {
	time: number;
	markers: SceneBeatMarker[];
}): number {
	if (markers.length === 0) return time;
	let closest = markers[0]?.time ?? time;
	let closestDistance = Math.abs(time - closest);
	for (const marker of markers) {
		const distance = Math.abs(time - marker.time);
		if (distance < closestDistance) {
			closest = marker.time;
			closestDistance = distance;
		}
	}
	return closest;
}

export function buildAutoMontageWindows({
	markers,
	beatDivision,
}: {
	markers: SceneBeatMarker[];
	beatDivision: number;
}): Array<{ startTime: number; duration: number }> {
	const windows: Array<{ startTime: number; duration: number }> = [];
	const safeDivision = clamp(Math.round(beatDivision), 1, 4);
	for (let i = 0; i + safeDivision < markers.length; i += safeDivision) {
		const start = markers[i]?.time ?? 0;
		const end = markers[i + safeDivision]?.time ?? start;
		if (end - start > 1e-3) {
			windows.push({
				startTime: start,
				duration: Number((end - start).toFixed(4)),
			});
		}
	}
	return windows;
}
