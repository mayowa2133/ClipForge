import { describe, expect, test } from "bun:test";
import {
	planMultiVersionDraft,
	buildMusicDraftSteps,
	buildPipelineSummary,
} from "../multi-version-generator";
import type { CreativeBrief } from "@/types/clipforge";
import type { MusicSelectionResult } from "../music-auto-select";
import type { ThumbnailRecommendation } from "../thumbnail-optimizer";
import type { FullPipelineResult } from "../multi-version-generator";
import type { AudioLibraryItem } from "@/types/library";

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

describe("planMultiVersionDraft", () => {
	test("generates all three formats when enableAllFormats is true", () => {
		const brief = buildTestBrief();
		const plan = planMultiVersionDraft({ brief, enableAllFormats: true });

		expect(plan.allTargets).toEqual(["9:16", "1:1", "16:9"]);
		expect(plan.primaryTarget).toBe("9:16");
	});

	test("uses brief versionTargets when enableAllFormats is false", () => {
		const brief = buildTestBrief({ versionTargets: ["1:1"] });
		const plan = planMultiVersionDraft({ brief, enableAllFormats: false });

		expect(plan.allTargets).toEqual(["1:1"]);
		expect(plan.primaryTarget).toBe("1:1");
	});

	test("includes version pack and safe layout steps", () => {
		const brief = buildTestBrief();
		const plan = planMultiVersionDraft({ brief, enableAllFormats: true });

		const stepKinds = plan.additionalSteps.map((s) => s.kind);
		expect(stepKinds).toContain("apply-version-pack");
		expect(stepKinds).toContain("apply-safe-layout");
	});

	test("safe layout targets exclude primary target", () => {
		const brief = buildTestBrief();
		const plan = planMultiVersionDraft({ brief, enableAllFormats: true });

		const safeLayoutStep = plan.additionalSteps.find(
			(s) => s.kind === "apply-safe-layout",
		);
		expect(safeLayoutStep).toBeDefined();
		const targets = safeLayoutStep!.params.targetVersionIds as string[];
		expect(targets).not.toContain("9:16"); // Primary target excluded
		expect(targets).toContain("1:1");
		expect(targets).toContain("16:9");
	});

	test("no safe layout when only one target", () => {
		const brief = buildTestBrief({ versionTargets: ["9:16"] });
		const plan = planMultiVersionDraft({ brief, enableAllFormats: false });

		const safeLayoutStep = plan.additionalSteps.find(
			(s) => s.kind === "apply-safe-layout",
		);
		expect(safeLayoutStep).toBeUndefined();
	});

	test("uses goal-appropriate primary for viral-tiktok", () => {
		const brief = buildTestBrief({ goal: "viral-tiktok", versionTargets: [] });
		const plan = planMultiVersionDraft({ brief, enableAllFormats: false });

		expect(plan.primaryTarget).toBe("9:16");
	});

	test("uses goal-appropriate primary for vlog", () => {
		const brief = buildTestBrief({ goal: "vlog", versionTargets: [] });
		const plan = planMultiVersionDraft({ brief, enableAllFormats: false });

		expect(plan.primaryTarget).toBe("16:9");
	});

	test("warns about multi-version output", () => {
		const brief = buildTestBrief();
		const plan = planMultiVersionDraft({ brief, enableAllFormats: true });

		expect(plan.warnings.some((w) => w.includes("Multi-version"))).toBe(true);
	});
});

describe("buildMusicDraftSteps", () => {
	test("creates a select-music step", () => {
		const musicSelection: MusicSelectionResult = {
			track: {
				id: "track-1",
				kind: "music",
				label: "Test Track",
				url: "/test.wav",
				previewUrl: "/test.wav",
				duration: 6,
				usageKind: "music",
				tags: [],
				license: "test",
				source: "test",
			} as AudioLibraryItem,
			score: 7.5,
			reasons: ["Good match"],
		};

		const steps = buildMusicDraftSteps({ musicSelection });

		expect(steps.length).toBe(1);
		expect(steps[0].params.musicAssetId).toBe("track-1");
		expect(steps[0].params.score).toBe(7.5);
	});
});

describe("buildPipelineSummary", () => {
	test("includes all pipeline components in summary", () => {
		const result: FullPipelineResult = {
			draftAppliedSteps: 8,
			draftSkippedSteps: 1,
			versionsGenerated: 3,
			musicSelection: {
				track: {
					id: "t1",
					kind: "music",
					label: "Energetic Bounce",
					url: "/test.wav",
					previewUrl: "/test.wav",
					duration: 5,
					usageKind: "music",
					tags: [],
					license: "test",
					source: "test",
				} as AudioLibraryItem,
				score: 6.5,
				reasons: [],
			},
			thumbnailRecommendation: {
				primary: {
					id: "thumb-1",
					timeS: 2.5,
					elementId: "elem-1",
					trackId: "track-1",
					score: 5.2,
					reasons: ["Strong visual"],
				},
				alternatives: [],
				warnings: [],
			},
			sceneAnalysisPerformed: true,
			messages: [],
			warnings: [],
		};

		const summary = buildPipelineSummary({ result });

		expect(summary).toContain("8 steps applied");
		expect(summary).toContain("1 skipped");
		expect(summary).toContain("3 platform formats");
		expect(summary).toContain("Energetic Bounce");
		expect(summary).toContain("2.5s");
		expect(summary).toContain("Scene analysis");
	});

	test("omits missing components", () => {
		const result: FullPipelineResult = {
			draftAppliedSteps: 5,
			draftSkippedSteps: 0,
			versionsGenerated: 1,
			musicSelection: null,
			thumbnailRecommendation: null,
			sceneAnalysisPerformed: false,
			messages: [],
			warnings: [],
		};

		const summary = buildPipelineSummary({ result });

		expect(summary).toContain("5 steps applied");
		expect(summary).not.toContain("Music");
		expect(summary).not.toContain("Thumbnail");
		expect(summary).not.toContain("Scene analysis");
		expect(summary).not.toContain("platform formats");
	});
});
