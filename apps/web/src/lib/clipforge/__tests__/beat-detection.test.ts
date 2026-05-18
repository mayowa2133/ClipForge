import { describe, expect, test } from "bun:test";
import {
	findNearestBeat,
	generateHalfBeats,
} from "@/lib/clipforge/beat-detection";

describe("findNearestBeat", () => {
	test("finds the closest beat marker", () => {
		const beats = [0.5, 1.0, 1.5, 2.0, 2.5];
		const result = findNearestBeat(1.2, beats);
		expect(result).not.toBeNull();
		expect(result!.beat).toBe(1.0);
		expect(result!.distance).toBeCloseTo(0.2, 5);
	});

	test("returns exact match with zero distance", () => {
		const beats = [1.0, 2.0, 3.0];
		const result = findNearestBeat(2.0, beats);
		expect(result!.beat).toBe(2.0);
		expect(result!.distance).toBe(0);
	});

	test("returns null for empty beats array", () => {
		expect(findNearestBeat(1.0, [])).toBeNull();
	});

	test("returns first beat when time is before all beats", () => {
		const beats = [1.0, 2.0, 3.0];
		const result = findNearestBeat(0.1, beats);
		expect(result!.beat).toBe(1.0);
	});

	test("returns last beat when time is after all beats", () => {
		const beats = [1.0, 2.0, 3.0];
		const result = findNearestBeat(5.0, beats);
		expect(result!.beat).toBe(3.0);
	});
});

describe("generateHalfBeats", () => {
	test("inserts midpoints between beats", () => {
		const beats = [1.0, 2.0, 3.0];
		const half = generateHalfBeats(beats);
		expect(half).toEqual([1.0, 1.5, 2.0, 2.5, 3.0]);
	});

	test("handles single beat", () => {
		const half = generateHalfBeats([1.0]);
		expect(half).toEqual([1.0]);
	});

	test("handles empty array", () => {
		expect(generateHalfBeats([])).toEqual([]);
	});

	test("handles two beats", () => {
		const half = generateHalfBeats([0, 1.0]);
		expect(half).toEqual([0, 0.5, 1.0]);
	});
});
