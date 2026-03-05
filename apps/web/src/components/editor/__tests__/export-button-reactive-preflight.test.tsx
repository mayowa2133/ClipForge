import { describe, expect, test } from "bun:test";
import { isExportBlocked } from "@/components/editor/export-button";
import type { ExportPreflightResult } from "@/types/export";

function buildPreflightResult({
	ready,
	blockingCount,
	warningCount,
}: {
	ready: boolean;
	blockingCount: number;
	warningCount: number;
}): ExportPreflightResult {
	return {
		ready,
		blockingCount,
		warningCount,
		issues: [],
		computedAt: "2026-03-05T15:00:00.000Z",
		healthFingerprint: "health-v1|fixture",
	};
}

describe("reactive export preflight gating", () => {
	test("stale preflight keeps export blocked", () => {
		const blocked = isExportBlocked({
			hasProject: true,
			isExporting: false,
			isPreflightRunning: false,
			isPreflightFresh: false,
			preflightResult: buildPreflightResult({
				ready: true,
				blockingCount: 0,
				warningCount: 0,
			}),
		});
		expect(blocked).toBe(true);
	});

	test("fresh and warning-only preflight allows export", () => {
		const blocked = isExportBlocked({
			hasProject: true,
			isExporting: false,
			isPreflightRunning: false,
			isPreflightFresh: true,
			preflightResult: buildPreflightResult({
				ready: true,
				blockingCount: 0,
				warningCount: 1,
			}),
		});
		expect(blocked).toBe(false);
	});
});
