import { describe, expect, test } from "bun:test";
import { detectSilenceRegions } from "@/lib/clipforge";

function buildSamples({
	parts,
	sampleRate,
}: {
	parts: Array<{ durationMs: number; amplitude: number }>;
	sampleRate: number;
}): Float32Array {
	const values: number[] = [];
	for (const part of parts) {
		const totalSamples = Math.floor((part.durationMs / 1000) * sampleRate);
		for (let i = 0; i < totalSamples; i++) {
			values.push(part.amplitude);
		}
	}
	return new Float32Array(values);
}

describe("detectSilenceRegions", () => {
	test("finds silence windows in synthetic audio", () => {
		const sampleRate = 1000;
		const samples = buildSamples({
			sampleRate,
			parts: [
				{ durationMs: 500, amplitude: 0.25 },
				{ durationMs: 320, amplitude: 0.001 },
				{ durationMs: 400, amplitude: 0.3 },
			],
		});

		const silenceRegions = detectSilenceRegions({
			samples,
			sampleRate,
			options: {
				window_ms: 20,
				rms_threshold: 0.01,
				min_silence_ms: 200,
			},
		});

		expect(silenceRegions.length).toBe(1);
		expect(silenceRegions[0]).toEqual({
			start_ms: 500,
			end_ms: 840,
		});
	});

	test("ignores short silence below minimum duration", () => {
		const sampleRate = 1000;
		const samples = buildSamples({
			sampleRate,
			parts: [
				{ durationMs: 500, amplitude: 0.25 },
				{ durationMs: 80, amplitude: 0.0005 },
				{ durationMs: 500, amplitude: 0.25 },
			],
		});

		const silenceRegions = detectSilenceRegions({
			samples,
			sampleRate,
			options: {
				window_ms: 20,
				rms_threshold: 0.01,
				min_silence_ms: 120,
			},
		});

		expect(silenceRegions).toEqual([]);
	});

	test("merges silence regions separated by short gaps", () => {
		const sampleRate = 1000;
		const samples = buildSamples({
			sampleRate,
			parts: [
				{ durationMs: 300, amplitude: 0.2 },
				{ durationMs: 200, amplitude: 0.0001 },
				{ durationMs: 30, amplitude: 0.3 },
				{ durationMs: 220, amplitude: 0.0002 },
				{ durationMs: 200, amplitude: 0.25 },
			],
		});

		const silenceRegions = detectSilenceRegions({
			samples,
			sampleRate,
			options: {
				window_ms: 10,
				rms_threshold: 0.01,
				min_silence_ms: 120,
				merge_gap_ms: 40,
			},
		});

		expect(silenceRegions).toEqual([
			{
				start_ms: 300,
				end_ms: 760,
			},
		]);
	});
});
