import type { SilenceRegion } from "@/types/clipforge";

export interface SilenceDetectionOptions {
	window_ms?: number;
	rms_threshold?: number;
	min_silence_ms?: number;
	merge_gap_ms?: number;
}

export function detectSilenceRegions({
	samples,
	sampleRate,
	options = {},
}: {
	samples: Float32Array;
	sampleRate: number;
	options?: SilenceDetectionOptions;
}): SilenceRegion[] {
	if (samples.length === 0 || sampleRate <= 0) return [];

	const windowMs = options.window_ms ?? 20;
	const rmsThreshold = options.rms_threshold ?? 0.015;
	const minSilenceMs = options.min_silence_ms ?? 180;
	const mergeGapMs = options.merge_gap_ms ?? 60;

	const windowSize = Math.max(1, Math.floor((sampleRate * windowMs) / 1000));
	const detected: SilenceRegion[] = [];

	let activeStartMs: number | null = null;
	let frameIndex = 0;

	while (frameIndex < samples.length) {
		const frameEnd = Math.min(samples.length, frameIndex + windowSize);
		const rms = calculateRms({
			samples,
			start: frameIndex,
			end: frameEnd,
		});
		const frameStartMs = samplesToMs({
			sampleIndex: frameIndex,
			sampleRate,
		});
		const frameEndMs = samplesToMs({
			sampleIndex: frameEnd,
			sampleRate,
		});

		if (rms < rmsThreshold) {
			if (activeStartMs === null) {
				activeStartMs = frameStartMs;
			}
		} else if (activeStartMs !== null) {
			const duration = frameEndMs - activeStartMs;
			if (duration >= minSilenceMs) {
				detected.push({
					start_ms: activeStartMs,
					end_ms: frameEndMs,
				});
			}
			activeStartMs = null;
		}

		frameIndex = frameEnd;
	}

	if (activeStartMs !== null) {
		const endMs = samplesToMs({
			sampleIndex: samples.length,
			sampleRate,
		});
		const duration = endMs - activeStartMs;
		if (duration >= minSilenceMs) {
			detected.push({ start_ms: activeStartMs, end_ms: endMs });
		}
	}

	return mergeSilenceRegions({
		regions: detected,
		mergeGapMs,
	});
}

function calculateRms({
	samples,
	start,
	end,
}: {
	samples: Float32Array;
	start: number;
	end: number;
}): number {
	if (end <= start) return 0;

	let sum = 0;
	for (let i = start; i < end; i++) {
		const value = samples[i];
		sum += value * value;
	}
	return Math.sqrt(sum / (end - start));
}

function samplesToMs({
	sampleIndex,
	sampleRate,
}: {
	sampleIndex: number;
	sampleRate: number;
}): number {
	return Math.round((sampleIndex / sampleRate) * 1000);
}

function mergeSilenceRegions({
	regions,
	mergeGapMs,
}: {
	regions: SilenceRegion[];
	mergeGapMs: number;
}): SilenceRegion[] {
	if (regions.length <= 1) return regions;

	const merged: SilenceRegion[] = [];
	let current = { ...regions[0] };

	for (let i = 1; i < regions.length; i++) {
		const candidate = regions[i];
		if (candidate.start_ms - current.end_ms <= mergeGapMs) {
			current.end_ms = Math.max(current.end_ms, candidate.end_ms);
			continue;
		}
		merged.push(current);
		current = { ...candidate };
	}

	merged.push(current);
	return merged;
}
