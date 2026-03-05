import { describe, expect, test } from "bun:test";
import { getSafeRetryProfile } from "@/components/editor/export-button";
import type { ExportRecoveryRecommendation } from "@/types/export";

describe("export button recovery helpers", () => {
	test("returns safe profile when recommendation exists", () => {
		const recommendation: ExportRecoveryRecommendation = {
			recommendedProfile: "safe-mp4-medium",
			reason: "Retry with safer profile.",
			canRetry: true,
		};
		expect(getSafeRetryProfile({ recommendation })).toBe("safe-mp4-medium");
	});

	test("returns null when recommendation has no profile", () => {
		const recommendation: ExportRecoveryRecommendation = {
			recommendedProfile: null,
			reason: "No profile.",
			canRetry: false,
		};
		expect(getSafeRetryProfile({ recommendation })).toBeNull();
	});

	test("returns null when recommendation is missing", () => {
		expect(getSafeRetryProfile({ recommendation: null })).toBeNull();
	});
});
