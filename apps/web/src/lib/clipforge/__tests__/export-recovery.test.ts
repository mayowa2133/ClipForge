import { describe, expect, test } from "bun:test";
import {
	applyRetryProfile,
	buildExportIncidentBundle,
	getExportRecoveryRecommendation,
} from "@/lib/clipforge/export-recovery";
import type { ExportDiagnostics } from "@/types/export";
import type { TProject } from "@/types/project";

function buildDiagnostics({
	failureCode,
}: {
	failureCode: ExportDiagnostics["failureCode"];
}): ExportDiagnostics {
	return {
		failureCode,
		backendUsed: "binary-canvas",
		audioIncluded: true,
		format: "webm",
		quality: "high",
	};
}

function buildProjectFixture(): TProject {
	return {
		metadata: {
			id: "project-1",
			name: "Export Project",
			duration: 6,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-1",
				name: "Main",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				updatedAt: new Date("2026-01-01T00:00:00.000Z"),
				tracks: [],
			},
		],
		currentSceneId: "scene-1",
		settings: {
			fps: 30,
			canvasSize: { width: 1080, height: 1920 },
			background: { type: "color", color: "#000000" },
		},
		version: 8,
	};
}

describe("getExportRecoveryRecommendation", () => {
	test("audio-mix-failed recommends safe no-audio profile", () => {
		const recommendation = getExportRecoveryRecommendation({
			diagnostics: buildDiagnostics({ failureCode: "audio-mix-failed" }),
			options: {
				format: "webm",
				quality: "high",
				includeAudio: true,
			},
		});

		expect(recommendation.recommendedProfile).toBe("safe-mp4-medium-no-audio");
		expect(recommendation.canRetry).toBe(true);
	});

	test("render-frame-failed recommends mp4 medium first", () => {
		const recommendation = getExportRecoveryRecommendation({
			diagnostics: buildDiagnostics({ failureCode: "render-frame-failed" }),
			options: {
				format: "webm",
				quality: "high",
				includeAudio: true,
			},
		});

		expect(recommendation.recommendedProfile).toBe("safe-mp4-medium");
		expect(recommendation.canRetry).toBe(true);
	});

	test("mp4 medium with audio recommends no-audio fallback on encode failure", () => {
		const recommendation = getExportRecoveryRecommendation({
			diagnostics: buildDiagnostics({ failureCode: "encoder-finalize-failed" }),
			options: {
				format: "mp4",
				quality: "medium",
				includeAudio: true,
			},
		});

		expect(recommendation.recommendedProfile).toBe("safe-mp4-medium-no-audio");
	});

	test("mp4 medium no-audio returns no further deterministic profile", () => {
		const recommendation = getExportRecoveryRecommendation({
			diagnostics: buildDiagnostics({ failureCode: "encoder-init-failed" }),
			options: {
				format: "mp4",
				quality: "medium",
				includeAudio: false,
			},
		});

		expect(recommendation.recommendedProfile).toBeNull();
		expect(recommendation.canRetry).toBe(false);
	});

	test("cancelled export returns no safe retry recommendation", () => {
		const recommendation = getExportRecoveryRecommendation({
			diagnostics: buildDiagnostics({ failureCode: "cancelled" }),
			options: {
				format: "mp4",
				quality: "high",
				includeAudio: true,
			},
		});

		expect(recommendation.recommendedProfile).toBeNull();
		expect(recommendation.canRetry).toBe(false);
	});
});

describe("applyRetryProfile", () => {
	test("safe-mp4-medium sets mp4 medium and keeps audio", () => {
		const next = applyRetryProfile({
			profile: "safe-mp4-medium",
			options: {
				format: "webm",
				quality: "low",
				includeAudio: true,
			},
		});
		expect(next).toEqual({
			format: "mp4",
			quality: "medium",
			includeAudio: true,
		});
	});

	test("safe-mp4-medium-no-audio sets mp4 medium and disables audio", () => {
		const next = applyRetryProfile({
			profile: "safe-mp4-medium-no-audio",
			options: {
				format: "webm",
				quality: "very_high",
				includeAudio: true,
			},
		});
		expect(next).toEqual({
			format: "mp4",
			quality: "medium",
			includeAudio: false,
		});
	});

	test("same-settings returns original options", () => {
		const next = applyRetryProfile({
			profile: "same-settings",
			options: {
				format: "webm",
				quality: "high",
				includeAudio: false,
			},
		});
		expect(next).toEqual({
			format: "webm",
			quality: "high",
			includeAudio: false,
		});
	});
});

describe("buildExportIncidentBundle", () => {
	test("includes attempts and preflight snapshot", () => {
		const bundle = buildExportIncidentBundle({
			project: buildProjectFixture(),
			preflightResult: {
				ready: false,
				issues: [],
				blockingCount: 1,
				warningCount: 0,
				computedAt: "2026-01-01T00:00:00.000Z",
				healthFingerprint: "health-v1|fixture",
			},
			attempts: [
				{
					attemptIndex: 1,
					timestamp: "2026-01-01T00:00:00.000Z",
					format: "mp4",
					quality: "high",
					includeAudio: true,
					result: "failed",
					error: "render failed",
				},
			],
			finalFailure: {
				error: "render failed",
				diagnostics: buildDiagnostics({ failureCode: "render-frame-failed" }),
			},
		});

		expect(bundle.bundleVersion).toBe(1);
		expect(bundle.projectId).toBe("project-1");
		expect(bundle.attempts).toHaveLength(1);
		expect(bundle.preflightResult?.blockingCount).toBe(1);
		expect(bundle.finalFailure?.diagnostics?.failureCode).toBe(
			"render-frame-failed",
		);
		expect("openaiApiKey" in (bundle as unknown as Record<string, unknown>)).toBe(
			false,
		);
	});
});
