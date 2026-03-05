import { describe, expect, test } from "bun:test";
import { getFixAllActions } from "@/components/editor/export-button";
import type { ExportPreflightResult } from "@/types/export";

describe("export button compatibility fix-all policy", () => {
	test("includes compatibility scan and excludes destructive missing-media removal", () => {
		const preflightResult: ExportPreflightResult = {
			ready: false,
			blockingCount: 3,
			warningCount: 0,
			issues: [
				{
					id: "issue-v1|media-compatibility-unverified|media-1|none|none",
					code: "media-compatibility-unverified",
					severity: "error",
					message: "Unverified compatibility",
					actionable: true,
					action: "scan-media-compatibility",
					mediaId: "media-1",
				},
				{
					id: "issue-v1|unsupported-audio-decode|media-2|none|none",
					code: "unsupported-audio-decode",
					severity: "error",
					message: "Audio decode unsupported",
					actionable: true,
					action: "disable-export-audio",
					mediaId: "media-2",
				},
				{
					id: "issue-v1|missing-media-asset|media-3|none|none",
					code: "missing-media-asset",
					severity: "error",
					message: "Missing media",
					actionable: true,
					action: "remove-missing-segments",
					mediaId: "media-3",
				},
			],
			computedAt: "2026-03-05T15:00:00.000Z",
			healthFingerprint: "health-v1|fixture",
		};

		const actions = getFixAllActions({
			preflightResult,
		});

		expect(actions).toEqual([
			"scan-media-compatibility",
			"disable-export-audio",
		]);
	});
});
