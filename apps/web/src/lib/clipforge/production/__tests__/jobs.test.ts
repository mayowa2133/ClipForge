import { describe, expect, test } from "bun:test";
import {
	canTransitionClipForgeJob,
	clampJobProgress,
} from "@/lib/clipforge/production/jobs";

describe("ClipForge production jobs", () => {
	test("allows only deterministic status transitions", () => {
		expect(
			canTransitionClipForgeJob({ from: "queued", to: "processing" }),
		).toBe(true);
		expect(
			canTransitionClipForgeJob({ from: "processing", to: "completed" }),
		).toBe(true);
		expect(canTransitionClipForgeJob({ from: "failed", to: "queued" })).toBe(
			true,
		);
		expect(
			canTransitionClipForgeJob({ from: "completed", to: "queued" }),
		).toBe(false);
	});

	test("clamps progress to a stable percentage", () => {
		expect(clampJobProgress(-20)).toBe(0);
		expect(clampJobProgress(42.6)).toBe(43);
		expect(clampJobProgress(200)).toBe(100);
		expect(clampJobProgress(Number.NaN)).toBe(0);
	});
});
