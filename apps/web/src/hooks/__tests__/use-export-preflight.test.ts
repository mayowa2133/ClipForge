import { describe, expect, test } from "bun:test";
import { isExportPreflightFresh } from "@/hooks/use-export-preflight";
import type { ExportPreflightResult } from "@/types/export";

function buildResult(): ExportPreflightResult {
	return {
		ready: true,
		issues: [],
		blockingCount: 0,
		warningCount: 0,
		computedAt: "2026-03-05T15:00:00.000Z",
		healthFingerprint: "health-v1|fixture",
	};
}

describe("isExportPreflightFresh", () => {
	test("returns false when there is no result", () => {
		expect(
			isExportPreflightFresh({
				result: null,
				isRunning: false,
				lastComputedRevision: 1,
				currentRevision: 1,
			}),
		).toBe(false);
	});

	test("returns false while running", () => {
		expect(
			isExportPreflightFresh({
				result: buildResult(),
				isRunning: true,
				lastComputedRevision: 1,
				currentRevision: 1,
			}),
		).toBe(false);
	});

	test("returns true when revisions match and run is complete", () => {
		expect(
			isExportPreflightFresh({
				result: buildResult(),
				isRunning: false,
				lastComputedRevision: 2,
				currentRevision: 2,
			}),
		).toBe(true);
	});

	test("returns false when result is stale against revision", () => {
		expect(
			isExportPreflightFresh({
				result: buildResult(),
				isRunning: false,
				lastComputedRevision: 2,
				currentRevision: 3,
			}),
		).toBe(false);
	});
});
