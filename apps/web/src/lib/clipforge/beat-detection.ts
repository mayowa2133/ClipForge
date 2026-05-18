import type { MediaBeatAnalysis } from "@/types/assets";

/**
 * Energy-based beat detection using onset strength.
 *
 * 1. Compute a spectral energy envelope from the audio buffer.
 * 2. Detect onsets where energy spikes above a moving-average threshold.
 * 3. Estimate BPM from the median inter-onset interval.
 * 4. Quantize onsets to a regular grid to separate beats from downbeats.
 */

const HOP_SIZE = 512;
const MIN_BPM = 60;
const MAX_BPM = 200;
const ONSET_THRESHOLD_MULTIPLIER = 1.4;
const MOVING_AVERAGE_WINDOW = 8;

export interface BeatDetectionOptions {
	/**
	 * Minimum inter-onset interval in seconds.
	 * Prevents detecting beats faster than this gap.
	 * @default 0.15
	 */
	minOnsetGap?: number;
}

/**
 * Compute a spectral energy envelope from an AudioBuffer.
 * Mixes to mono, then computes RMS energy per hop window.
 */
function computeEnergyEnvelope({
	channelData,
	sampleRate,
}: {
	channelData: Float32Array;
	sampleRate: number;
}): { envelope: Float32Array; hopDuration: number } {
	const hopCount = Math.floor(channelData.length / HOP_SIZE);
	const envelope = new Float32Array(hopCount);

	for (let i = 0; i < hopCount; i++) {
		const start = i * HOP_SIZE;
		const end = Math.min(start + HOP_SIZE, channelData.length);
		let sum = 0;
		for (let j = start; j < end; j++) {
			sum += channelData[j] * channelData[j];
		}
		envelope[i] = Math.sqrt(sum / (end - start));
	}

	return {
		envelope,
		hopDuration: HOP_SIZE / sampleRate,
	};
}

/**
 * Detect onset frames where energy exceeds a moving-average threshold.
 */
function detectOnsets({
	envelope,
	hopDuration,
	minOnsetGap = 0.15,
}: {
	envelope: Float32Array;
	hopDuration: number;
	minOnsetGap?: number;
}): number[] {
	const onsetTimes: number[] = [];
	const minGapFrames = Math.ceil(minOnsetGap / hopDuration);
	let lastOnsetFrame = -minGapFrames;

	for (let i = MOVING_AVERAGE_WINDOW; i < envelope.length; i++) {
		// Compute local moving average
		let avg = 0;
		for (let j = i - MOVING_AVERAGE_WINDOW; j < i; j++) {
			avg += envelope[j];
		}
		avg /= MOVING_AVERAGE_WINDOW;

		// Onset = current energy exceeds threshold * moving average
		if (
			envelope[i] > avg * ONSET_THRESHOLD_MULTIPLIER &&
			i - lastOnsetFrame >= minGapFrames
		) {
			onsetTimes.push(i * hopDuration);
			lastOnsetFrame = i;
		}
	}

	return onsetTimes;
}

/**
 * Estimate BPM from inter-onset intervals using median.
 */
function estimateBpm(onsets: number[]): number | null {
	if (onsets.length < 3) return null;

	const intervals: number[] = [];
	for (let i = 1; i < onsets.length; i++) {
		intervals.push(onsets[i] - onsets[i - 1]);
	}

	intervals.sort((a, b) => a - b);
	const median = intervals[Math.floor(intervals.length / 2)];
	if (median <= 0) return null;

	let bpm = 60 / median;

	// Normalize BPM to a musical range
	while (bpm < MIN_BPM && bpm > 0) bpm *= 2;
	while (bpm > MAX_BPM) bpm /= 2;

	return Math.round(bpm * 10) / 10;
}

/**
 * Classify onsets into beats and downbeats.
 *
 * Downbeats are the strongest onsets that align to the
 * estimated bar boundaries (every 4 beats at estimated BPM).
 */
function classifyBeats({
	onsets,
	bpm,
}: {
	onsets: number[];
	bpm: number;
}): { beats: number[]; downbeats: number[] } {
	const beatInterval = 60 / bpm;
	const barInterval = beatInterval * 4;

	const beats: number[] = [];
	const downbeats: number[] = [];

	if (onsets.length === 0) return { beats, downbeats };

	// Use the first onset as beat-grid anchor
	const anchor = onsets[0];

	for (const onset of onsets) {
		beats.push(onset);

		// Check if this onset is close to a bar boundary
		const offsetFromAnchor = onset - anchor;
		const barPhase = offsetFromAnchor % barInterval;
		const nearestBarBoundary = Math.min(
			barPhase,
			barInterval - barPhase,
		);

		if (nearestBarBoundary < beatInterval * 0.35) {
			downbeats.push(onset);
		}
	}

	return { beats, downbeats };
}

/**
 * Mix an AudioBuffer down to a mono Float32Array.
 */
function mixToMono(buffer: AudioBuffer): Float32Array {
	const length = buffer.length;
	const channelCount = buffer.numberOfChannels;

	if (channelCount === 1) {
		return buffer.getChannelData(0);
	}

	const mono = new Float32Array(length);
	for (let ch = 0; ch < channelCount; ch++) {
		const channel = buffer.getChannelData(ch);
		for (let i = 0; i < length; i++) {
			mono[i] += channel[i];
		}
	}

	const scale = 1 / channelCount;
	for (let i = 0; i < length; i++) {
		mono[i] *= scale;
	}

	return mono;
}

/**
 * Analyze an AudioBuffer and return beat markers.
 */
export function detectBeats(
	buffer: AudioBuffer,
	options?: BeatDetectionOptions,
): MediaBeatAnalysis {
	const channelData = mixToMono(buffer);
	const sampleRate = buffer.sampleRate;

	const { envelope, hopDuration } = computeEnergyEnvelope({
		channelData,
		sampleRate,
	});

	const onsets = detectOnsets({
		envelope,
		hopDuration,
		minOnsetGap: options?.minOnsetGap ?? 0.15,
	});

	const bpm = estimateBpm(onsets);

	if (bpm === null) {
		return {
			bpm: null,
			downbeats: [],
			beats: onsets,
			analyzedAt: new Date().toISOString(),
			version: 1,
		};
	}

	const { beats, downbeats } = classifyBeats({ onsets, bpm });

	return {
		bpm,
		downbeats,
		beats,
		analyzedAt: new Date().toISOString(),
		version: 1,
	};
}

/**
 * Generate half-beat markers between existing beats.
 */
export function generateHalfBeats(beats: number[]): number[] {
	if (beats.length < 2) return [...beats];

	const halfBeats: number[] = [];
	for (let i = 0; i < beats.length; i++) {
		halfBeats.push(beats[i]);
		if (i < beats.length - 1) {
			halfBeats.push((beats[i] + beats[i + 1]) / 2);
		}
	}
	return halfBeats;
}

/**
 * Find the nearest beat marker to a given time.
 */
export function findNearestBeat(
	time: number,
	beats: number[],
): { beat: number; distance: number } | null {
	if (beats.length === 0) return null;

	let nearest = beats[0];
	let minDistance = Math.abs(time - nearest);

	for (let i = 1; i < beats.length; i++) {
		const distance = Math.abs(time - beats[i]);
		if (distance < minDistance) {
			minDistance = distance;
			nearest = beats[i];
		}
		// Beats are sorted, so once distance starts increasing we can stop
		if (beats[i] > time && distance > minDistance) break;
	}

	return { beat: nearest, distance: minDistance };
}
