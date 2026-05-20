import { describe, expect, test } from "bun:test";
import {
	scoreThumbnailCandidate,
	selectBestThumbnail,
	thumbnailFromHookCandidate,
} from "../thumbnail-optimizer";
import type {
	FootageIntelligenceReport,
	FootageMomentScore,
	HookCandidate,
} from "@/types/clipforge";

function buildMoment(overrides: Partial<FootageMomentScore> = {}): FootageMomentScore {
	return {
		id: "moment-1",
		trackId: "track-1",
		elementId: "elem-1",
		startTime: 1,
		endTime: 3,
		totalScore: 3.5,
		reasons: ["Visual change is strong here."],
		...overrides,
	};
}

function buildHook(overrides: Partial<HookCandidate> = {}): HookCandidate {
	return {
		id: "hook:moment-1",
		trackId: "track-1",
		elementId: "elem-1",
		startTime: 0.5,
		endTime: 2.5,
		score: 4.0,
		reasons: ["Visual change is strong here.", "Starts early in the scene."],
		...overrides,
	};
}

describe("scoreThumbnailCandidate", () => {
	test("scores higher for hook-aligned moments", () => {
		const moment = buildMoment({ id: "moment-1", totalScore: 3.5 });
		const hookIds = new Set(["hook:moment-1"]);
		const noHookIds = new Set<string>();

		const withHook = scoreThumbnailCandidate({
			moment,
			hookCandidateIds: hookIds,
			totalDurationS: 30,
		});
		const withoutHook = scoreThumbnailCandidate({
			moment,
			hookCandidateIds: noHookIds,
			totalDurationS: 30,
		});

		expect(withHook.score).toBeGreaterThan(withoutHook.score);
		expect(withHook.reasons.some((r) => r.includes("hook"))).toBe(true);
	});

	test("scores higher for early moments", () => {
		const earlyMoment = buildMoment({ startTime: 0.5, endTime: 2.5, totalScore: 3 });
		const lateMoment = buildMoment({ startTime: 20, endTime: 22, totalScore: 3 });
		const hookIds = new Set<string>();

		const early = scoreThumbnailCandidate({
			moment: earlyMoment,
			hookCandidateIds: hookIds,
			totalDurationS: 30,
		});
		const late = scoreThumbnailCandidate({
			moment: lateMoment,
			hookCandidateIds: hookIds,
			totalDurationS: 30,
		});

		expect(early.score).toBeGreaterThan(late.score);
	});

	test("includes speech density signal", () => {
		const withSpeech = buildMoment({
			reasons: ["Visual change is strong here.", "Speech is dense in this window."],
		});
		const withoutSpeech = buildMoment({
			reasons: ["Visual change is strong here."],
		});
		const hookIds = new Set<string>();

		const speechResult = scoreThumbnailCandidate({
			moment: withSpeech,
			hookCandidateIds: hookIds,
			totalDurationS: 30,
		});
		const noSpeechResult = scoreThumbnailCandidate({
			moment: withoutSpeech,
			hookCandidateIds: hookIds,
			totalDurationS: 30,
		});

		expect(speechResult.score).toBeGreaterThan(noSpeechResult.score);
	});

	test("computes time at midpoint of moment", () => {
		const moment = buildMoment({ startTime: 4, endTime: 8 });

		const candidate = scoreThumbnailCandidate({
			moment,
			hookCandidateIds: new Set(),
			totalDurationS: 30,
		});

		expect(candidate.timeS).toBe(6);
	});
});

describe("selectBestThumbnail", () => {
	test("returns null for empty moment scores", () => {
		const report: FootageIntelligenceReport = {
			generatedAt: new Date().toISOString(),
			hookCandidates: [],
			momentScores: [],
			keepCutRecommendations: [],
			warnings: [],
		};

		const result = selectBestThumbnail({ footageReport: report, totalDurationS: 30 });
		expect(result).toBeNull();
	});

	test("returns primary and alternatives", () => {
		const report: FootageIntelligenceReport = {
			generatedAt: new Date().toISOString(),
			hookCandidates: [buildHook()],
			momentScores: [
				buildMoment({ id: "m1", elementId: "e1", startTime: 0.5, endTime: 2.5, totalScore: 4 }),
				buildMoment({ id: "m2", elementId: "e2", startTime: 5, endTime: 7, totalScore: 3 }),
				buildMoment({ id: "m3", elementId: "e3", startTime: 12, endTime: 14, totalScore: 2.5 }),
			],
			keepCutRecommendations: [],
			warnings: [],
		};

		const result = selectBestThumbnail({ footageReport: report, totalDurationS: 30 });

		expect(result).not.toBeNull();
		expect(result!.primary.score).toBeGreaterThan(0);
		expect(result!.alternatives.length).toBeLessThanOrEqual(2);
	});

	test("primary has highest score", () => {
		const report: FootageIntelligenceReport = {
			generatedAt: new Date().toISOString(),
			hookCandidates: [],
			momentScores: [
				buildMoment({ id: "m1", startTime: 10, endTime: 12, totalScore: 2 }),
				buildMoment({ id: "m2", startTime: 0.5, endTime: 2.5, totalScore: 5 }),
			],
			keepCutRecommendations: [],
			warnings: [],
		};

		const result = selectBestThumbnail({ footageReport: report, totalDurationS: 30 });

		expect(result).not.toBeNull();
		expect(result!.primary.score).toBeGreaterThanOrEqual(
			result!.alternatives[0]?.score ?? 0,
		);
	});

	test("warns when primary score is low", () => {
		const report: FootageIntelligenceReport = {
			generatedAt: new Date().toISOString(),
			hookCandidates: [],
			momentScores: [
				buildMoment({ id: "m1", startTime: 20, endTime: 22, totalScore: 0.5 }),
			],
			keepCutRecommendations: [],
			warnings: [],
		};

		const result = selectBestThumbnail({ footageReport: report, totalDurationS: 30 });

		expect(result).not.toBeNull();
		expect(result!.warnings.some((w) => w.includes("compelling"))).toBe(true);
	});

	test("warns when no hook candidates exist", () => {
		const report: FootageIntelligenceReport = {
			generatedAt: new Date().toISOString(),
			hookCandidates: [],
			momentScores: [
				buildMoment({ id: "m1", startTime: 1, endTime: 3, totalScore: 3 }),
			],
			keepCutRecommendations: [],
			warnings: [],
		};

		const result = selectBestThumbnail({ footageReport: report, totalDurationS: 30 });
		expect(result!.warnings.some((w) => w.includes("hook"))).toBe(true);
	});
});

describe("thumbnailFromHookCandidate", () => {
	test("creates thumbnail at hook midpoint", () => {
		const hook = buildHook({ startTime: 2, endTime: 6, score: 4.5 });

		const result = thumbnailFromHookCandidate({ hookCandidate: hook });

		expect(result.timeS).toBe(4);
		expect(result.score).toBe(4.5 * 0.8);
		expect(result.id).toContain("hook");
	});
});
