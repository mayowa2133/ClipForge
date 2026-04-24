import { describe, expect, test } from "bun:test";
import {
	buildExportIssueTechnicalDetails,
	getExportIssueTitle,
	getFixAllActions,
	isExportBlocked,
} from "@/components/editor/export-button";
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

describe("export button preflight helpers", () => {
	test("preflight blockers keep export disabled", () => {
		const blocked = isExportBlocked({
			hasProject: true,
			isExporting: false,
			isPreflightRunning: false,
			isPreflightFresh: true,
			preflightResult: buildPreflightResult({
				ready: false,
				blockingCount: 1,
				warningCount: 0,
			}),
		});

		expect(blocked).toBe(true);
	});

	test("warning-only preflight allows export", () => {
		const blocked = isExportBlocked({
			hasProject: true,
			isExporting: false,
			isPreflightRunning: false,
			isPreflightFresh: true,
			preflightResult: buildPreflightResult({
				ready: true,
				blockingCount: 0,
				warningCount: 2,
			}),
		});

		expect(blocked).toBe(false);
	});

	test("fix-all action list only includes actionable blockers", () => {
		const actions = getFixAllActions({
			preflightResult: {
				ready: false,
				blockingCount: 2,
				warningCount: 1,
				issues: [
					{
						id: "issue-v1|missing-media-asset|missing-1|none|none",
						code: "missing-media-asset",
						severity: "error",
						message: "Missing media",
						actionable: true,
						action: "remove-missing-segments",
						mediaId: "missing-1",
					},
					{
						id: "issue-v1|invalid-segment-range|none|none|none",
						code: "invalid-segment-range",
						severity: "error",
						message: "Invalid range",
						actionable: true,
						action: "remove-invalid-ranges",
					},
					{
						id: "issue-v1|webm-compat-warning|none|none|none",
						code: "webm-compat-warning",
						severity: "warning",
						message: "Compatibility warning",
						actionable: true,
						action: "switch-format-mp4",
					},
				],
				computedAt: "2026-03-05T15:00:00.000Z",
				healthFingerprint: "health-v1|fixture",
			},
		});

		expect(actions).toEqual(["remove-invalid-ranges"]);
	});

	test("formats human-readable preflight issue titles and hides diagnostics behind a helper", () => {
		const issue = {
			id: "issue-v1|missing-media-asset|missing-1|none|none",
			code: "missing-media-asset",
			severity: "error",
			message: "Missing media",
			actionable: true,
			action: "remove-missing-segments",
			mediaId: "missing-1",
			referenceCount: 2,
		} as const;

		expect(getExportIssueTitle({ issue })).toBe("Missing media file");
		expect(buildExportIssueTechnicalDetails({ issue })).toContain("missing-media-asset");
		expect(buildExportIssueTechnicalDetails({ issue })).toContain("media=missing-1");
	});
});
