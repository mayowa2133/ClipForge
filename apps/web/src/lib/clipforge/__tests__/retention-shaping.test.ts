import { describe, expect, test } from "bun:test";
import { buildDefaultProjectVersionPack } from "@/constants/project-constants";
import { buildDefaultClipForgeProjectData } from "@/lib/clipforge";
import { buildRetentionShapePlan } from "@/lib/clipforge/retention-shaping";
import type { CreativeBrief, FootageIntelligenceReport } from "@/types/clipforge";
import type { TProject } from "@/types/project";

function buildProjectFixture(): TProject {
	const canvasSize = { width: 1080, height: 1920 };
	return {
		metadata: {
			id: "project-retention-1",
			name: "Retention Fixture",
			duration: 30,
			createdAt: new Date("2026-03-12T00:00:00.000Z"),
			updatedAt: new Date("2026-03-12T00:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-1",
				name: "Main",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-03-12T00:00:00.000Z"),
				updatedAt: new Date("2026-03-12T00:00:00.000Z"),
				tracks: [
					{
						id: "video-track-1",
						type: "video",
						name: "Main",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [
							{
								id: "video-1",
								type: "video",
								name: "Clip 1",
								mediaId: "video-1",
								startTime: 0,
								duration: 30,
								trimStart: 0,
								trimEnd: 0,
								transform: {
									scale: 1,
									position: { x: 0, y: 0 },
									rotate: 0,
								},
								opacity: 1,
							},
						],
					},
				],
			},
		],
		currentSceneId: "scene-1",
		settings: {
			fps: 30,
			canvasSize,
			versionPack: buildDefaultProjectVersionPack({ canvasSize }),
			background: { type: "color", color: "#000000" },
		},
		version: 18,
		clipforge: buildDefaultClipForgeProjectData(),
	};
}

function buildBrief(overrides: Partial<CreativeBrief> = {}): CreativeBrief {
	return {
		goal: "viral-tiktok",
		tone: "clean",
		durationTargetS: 24,
		captionStyleId: "bold-center",
		overlayStyleVariantId: "clean-vlog",
		motionPresetId: "fade-up",
		beatDivision: 2,
		versionTargets: ["9:16"],
		notes: "make me a viral TikTok from this",
		...overrides,
	};
}

function buildReport(): FootageIntelligenceReport {
	return {
		generatedAt: "2026-03-12T00:00:00.000Z",
		hookCandidates: [
			{
				id: "hook-1",
				trackId: "video-track-1",
				elementId: "video-1",
				startTime: 0.8,
				endTime: 2.4,
				score: 4.4,
				reasons: ["Starts early in the scene.", "Strong transcript density."],
			},
		],
		momentScores: [
			{
				id: "moment-hook",
				trackId: "video-track-1",
				elementId: "video-1",
				startTime: 0.8,
				endTime: 2.4,
				totalScore: 4.4,
				reasons: ["Strong opener."],
			},
			{
				id: "moment-body",
				trackId: "video-track-1",
				elementId: "video-1",
				startTime: 8,
				endTime: 10.4,
				totalScore: 3.3,
				reasons: ["Useful body material."],
			},
			{
				id: "moment-payoff",
				trackId: "video-track-1",
				elementId: "video-1",
				startTime: 18.2,
				endTime: 21.2,
				totalScore: 4.9,
				reasons: ["Strong later reveal.", "Distinct payoff beat."],
			},
		],
		keepCutRecommendations: [
			{
				id: "trim-early",
				trackId: "video-track-1",
				elementId: "video-1",
				action: "trim",
				startTime: 1.9,
				endTime: 3.6,
				score: 1.8,
				reasons: ["Opening lacks forward motion."],
			},
			{
				id: "trim-body",
				trackId: "video-track-1",
				elementId: "video-1",
				action: "trim",
				startTime: 9.8,
				endTime: 12.1,
				score: 1.5,
				reasons: ["Body section gets repetitive."],
			},
		],
		warnings: [],
	};
}

describe("buildRetentionShapePlan", () => {
	test("prefers a later payoff over reusing the opener", () => {
		const plan = buildRetentionShapePlan({
			brief: buildBrief(),
			footageReport: buildReport(),
			project: buildProjectFixture(),
			beatMarkerCount: 12,
		});

		expect(plan.hookCandidateId).toBe("hook-1");
		expect(plan.payoffMomentIds).toEqual(["moment-payoff"]);
		expect(plan.beats.find((beat) => beat.kind === "payoff")?.startTime).toBeGreaterThan(
			plan.beats.find((beat) => beat.kind === "hook")?.endTime ?? 0,
		);
	});

	test("weak early setup creates trim and delay-context steps", () => {
		const plan = buildRetentionShapePlan({
			brief: buildBrief(),
			footageReport: buildReport(),
			project: buildProjectFixture(),
			beatMarkerCount: 0,
		});

		expect(plan.steps.some((step) => step.kind === "trim-setup")).toBe(true);
		expect(plan.steps.some((step) => step.kind === "delay-context")).toBe(true);
	});

	test("CTA is reserved only when the brief implies one", () => {
		const basePlan = buildRetentionShapePlan({
			brief: buildBrief(),
			footageReport: buildReport(),
			project: buildProjectFixture(),
			beatMarkerCount: 0,
		});
		const ctaPlan = buildRetentionShapePlan({
			brief: buildBrief({
				goal: "product-highlight",
				notes: "make this a product highlight and add a CTA at the end",
			}),
			footageReport: buildReport(),
			project: buildProjectFixture(),
			beatMarkerCount: 0,
		});

		expect(basePlan.steps.some((step) => step.kind === "reserve-cta")).toBe(false);
		expect(ctaPlan.steps.some((step) => step.kind === "reserve-cta")).toBe(true);
		expect(ctaPlan.beats.at(-1)?.kind).toBe("cta");
	});

	test("fallback without footage data is warning-first and conservative", () => {
		const plan = buildRetentionShapePlan({
			brief: buildBrief(),
			footageReport: null,
			project: buildProjectFixture(),
			beatMarkerCount: 0,
		});

		expect(plan.steps).toHaveLength(0);
		expect(plan.warnings).toContain(
			"Retention shaping is unavailable, so structure falls back to clip order and basic duration tightening.",
		);
	});

	test("reason tags stay explainable and deterministic", () => {
		const plan = buildRetentionShapePlan({
			brief: buildBrief(),
			footageReport: buildReport(),
			project: buildProjectFixture(),
			beatMarkerCount: 8,
		});

		expect(plan.beats[0]?.reasons[0]).toContain("Promote");
		expect(plan.steps[0]?.reasons.length).toBeGreaterThan(0);
	});
});
