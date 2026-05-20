import { describe, expect, test } from "bun:test";
import {
	scoreMusicTrack,
	selectBestMusicTrack,
	selectTopMusicTracks,
} from "../music-auto-select";
import type { AudioLibraryItem } from "@/types/library";
import type { CreativeBrief } from "@/types/clipforge";

function buildTestTrack(overrides: Partial<AudioLibraryItem> = {}): AudioLibraryItem {
	return {
		id: "test-track",
		kind: "music",
		label: "Test Track",
		url: "/test.wav",
		previewUrl: "/test.wav",
		duration: 6,
		mood: "clean",
		bpm: 100,
		usageKind: "music",
		tags: ["clean", "vlog"],
		license: "test",
		source: "test",
		...overrides,
	};
}

function buildTestBrief(overrides: Partial<CreativeBrief> = {}): CreativeBrief {
	return {
		goal: "viral-tiktok",
		tone: "energetic",
		durationTargetS: 24,
		captionStyleId: "bold-center",
		overlayStyleVariantId: null,
		motionPresetId: null,
		beatDivision: 2,
		versionTargets: ["9:16"],
		notes: null,
		...overrides,
	};
}

describe("scoreMusicTrack", () => {
	test("scores higher for matching mood", () => {
		const energeticTrack = buildTestTrack({ mood: "energetic", bpm: 130 });
		const minimalTrack = buildTestTrack({ mood: "minimal", bpm: 90 });
		const brief = buildTestBrief({ goal: "viral-tiktok", tone: "energetic" });

		const energeticResult = scoreMusicTrack({ track: energeticTrack, brief });
		const minimalResult = scoreMusicTrack({ track: minimalTrack, brief });

		expect(energeticResult.score).toBeGreaterThan(minimalResult.score);
	});

	test("scores higher for BPM in ideal range", () => {
		const goodBpm = buildTestTrack({ bpm: 125, mood: "clean" });
		const badBpm = buildTestTrack({ bpm: 75, mood: "clean" });
		const brief = buildTestBrief({ goal: "viral-tiktok" });

		const goodResult = scoreMusicTrack({ track: goodBpm, brief });
		const badResult = scoreMusicTrack({ track: badBpm, brief });

		expect(goodResult.score).toBeGreaterThan(badResult.score);
	});

	test("includes tag overlap bonus", () => {
		const tagMatch = buildTestTrack({ tags: ["energetic", "tiktok"] });
		const noTags = buildTestTrack({ tags: [] });
		const brief = buildTestBrief({ goal: "viral-tiktok", tone: "energetic" });

		const matchResult = scoreMusicTrack({ track: tagMatch, brief });
		const noTagResult = scoreMusicTrack({ track: noTags, brief });

		expect(matchResult.score).toBeGreaterThan(noTagResult.score);
	});

	test("provides reasons for scoring decisions", () => {
		const track = buildTestTrack({ mood: "energetic", bpm: 120 });
		const brief = buildTestBrief({ goal: "viral-tiktok", tone: "energetic" });

		const result = scoreMusicTrack({ track, brief });

		expect(result.reasons.length).toBeGreaterThan(0);
		expect(result.reasons.some((r) => r.includes("Mood"))).toBe(true);
	});

	test("luxury brief prefers luxury mood", () => {
		const luxuryTrack = buildTestTrack({ id: "luxury", mood: "luxury", bpm: 88 });
		const energeticTrack = buildTestTrack({ id: "energetic", mood: "energetic", bpm: 130 });
		const brief = buildTestBrief({ goal: "luxury-routine", tone: "luxury" });

		const luxuryResult = scoreMusicTrack({ track: luxuryTrack, brief });
		const energeticResult = scoreMusicTrack({ track: energeticTrack, brief });

		expect(luxuryResult.score).toBeGreaterThan(energeticResult.score);
	});

	test("talking-head brief prefers slower BPM", () => {
		const slow = buildTestTrack({ bpm: 92, mood: "minimal" });
		const fast = buildTestTrack({ bpm: 140, mood: "minimal" });
		const brief = buildTestBrief({ goal: "talking-head", tone: "minimal" });

		const slowResult = scoreMusicTrack({ track: slow, brief });
		const fastResult = scoreMusicTrack({ track: fast, brief });

		expect(slowResult.score).toBeGreaterThan(fastResult.score);
	});
});

describe("selectBestMusicTrack", () => {
	test("returns null for empty library", () => {
		const brief = buildTestBrief();
		const result = selectBestMusicTrack({ musicLibrary: [], brief });
		expect(result).toBeNull();
	});

	test("returns the highest-scoring track", () => {
		const library: AudioLibraryItem[] = [
			buildTestTrack({ id: "low", mood: "minimal", bpm: 80 }),
			buildTestTrack({ id: "high", mood: "energetic", bpm: 125, tags: ["energetic", "viral"] }),
			buildTestTrack({ id: "mid", mood: "clean", bpm: 100 }),
		];
		const brief = buildTestBrief({ goal: "viral-tiktok", tone: "energetic" });

		const result = selectBestMusicTrack({ musicLibrary: library, brief });

		expect(result).not.toBeNull();
		expect(result!.track.id).toBe("high");
	});

	test("selects appropriate track for different goals", () => {
		const library: AudioLibraryItem[] = [
			buildTestTrack({ id: "luxury", mood: "luxury", bpm: 88 }),
			buildTestTrack({ id: "energetic", mood: "energetic", bpm: 130 }),
		];

		const luxuryBrief = buildTestBrief({ goal: "luxury-routine", tone: "luxury" });
		const viralBrief = buildTestBrief({ goal: "viral-tiktok", tone: "energetic" });

		const luxuryResult = selectBestMusicTrack({ musicLibrary: library, brief: luxuryBrief });
		const viralResult = selectBestMusicTrack({ musicLibrary: library, brief: viralBrief });

		expect(luxuryResult!.track.id).toBe("luxury");
		expect(viralResult!.track.id).toBe("energetic");
	});
});

describe("selectTopMusicTracks", () => {
	test("returns up to count tracks", () => {
		const library: AudioLibraryItem[] = [
			buildTestTrack({ id: "a", mood: "energetic", bpm: 120 }),
			buildTestTrack({ id: "b", mood: "upbeat", bpm: 115 }),
			buildTestTrack({ id: "c", mood: "clean", bpm: 100 }),
			buildTestTrack({ id: "d", mood: "minimal", bpm: 90 }),
		];
		const brief = buildTestBrief({ goal: "viral-tiktok" });

		const results = selectTopMusicTracks({ musicLibrary: library, brief, count: 2 });

		expect(results.length).toBe(2);
		expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
	});

	test("returns empty array for empty library", () => {
		const brief = buildTestBrief();
		const results = selectTopMusicTracks({ musicLibrary: [], brief });
		expect(results).toEqual([]);
	});
});
