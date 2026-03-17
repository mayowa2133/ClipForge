import { describe, expect, test } from "bun:test";
import {
	assertClipForgeChatEvalThresholds,
	DEFAULT_CLIPFORGE_CHAT_EVAL_THRESHOLDS,
	runClipForgeChatEvaluationHarness,
} from "@/lib/clipforge/chat";

describe("ClipForge chat evaluation harness", () => {
	test("meets the M54 benchmark thresholds", async () => {
		const report = await runClipForgeChatEvaluationHarness();

		expect(report.suites["single-turn"].totalPrompts).toBe(
			DEFAULT_CLIPFORGE_CHAT_EVAL_THRESHOLDS.expectedSingleTurnPrompts,
		);
		expect(report.suites["multi-turn-memory"].totalPrompts).toBe(
			DEFAULT_CLIPFORGE_CHAT_EVAL_THRESHOLDS.expectedMultiTurnPrompts,
		);
		expect(report.suites["creative-direction"].totalPrompts).toBe(
			DEFAULT_CLIPFORGE_CHAT_EVAL_THRESHOLDS.expectedCreativeDirectionPrompts,
		);
		expect(report.suites.finishing.totalPrompts).toBe(
			DEFAULT_CLIPFORGE_CHAT_EVAL_THRESHOLDS.expectedFinishingPrompts,
		);
		expect(report.suites["reference-video"].totalPrompts).toBe(
			DEFAULT_CLIPFORGE_CHAT_EVAL_THRESHOLDS.expectedReferenceVideoPrompts,
		);
		expect(report.suites["reference-assembly"].totalPrompts).toBe(
			DEFAULT_CLIPFORGE_CHAT_EVAL_THRESHOLDS.expectedReferenceAssemblyPrompts,
		);
		expect(() =>
			assertClipForgeChatEvalThresholds({
				report,
			}),
		).not.toThrow();
	});
});
