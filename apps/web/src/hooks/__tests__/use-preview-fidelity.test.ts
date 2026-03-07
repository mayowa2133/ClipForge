import { describe, expect, test } from "bun:test";
import { isPreviewFidelityChecking } from "@/hooks/use-preview-fidelity";
import type { PreviewFidelityReport } from "@/services/renderer/types";

function buildReport({
	graphFingerprint = "graph-v1",
}: {
	graphFingerprint?: string;
} = {}): PreviewFidelityReport {
	return {
		status: "exact",
		checkedAt: "2026-03-06T12:00:00.000Z",
		graphFingerprint,
		previewBackend: "binary-preview",
		exportBackend: "binary-canvas",
		issues: [],
		samples: [],
	};
}

describe("isPreviewFidelityChecking", () => {
	test("returns false when there is no graph fingerprint", () => {
		expect(
			isPreviewFidelityChecking({
				report: null,
				graphFingerprint: null,
			}),
		).toBe(false);
	});

	test("returns true when the current graph has no report yet", () => {
		expect(
			isPreviewFidelityChecking({
				report: null,
				graphFingerprint: "graph-v1",
			}),
		).toBe(true);
	});

	test("returns false when the report matches the current graph", () => {
		expect(
			isPreviewFidelityChecking({
				report: buildReport(),
				graphFingerprint: "graph-v1",
			}),
		).toBe(false);
	});

	test("returns true when the report is stale for the current graph", () => {
		expect(
			isPreviewFidelityChecking({
				report: buildReport({ graphFingerprint: "graph-v1" }),
				graphFingerprint: "graph-v2",
			}),
		).toBe(true);
	});
});
