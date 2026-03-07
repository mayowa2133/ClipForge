import { describe, expect, test } from "bun:test";
import {
	formatPreviewFidelityStatusLabel,
	getPreviewFidelityBadgeClassName,
	getPreviewFidelityDetailLine,
	getPreviewFidelityStatus,
} from "@/components/editor/panels/preview/toolbar";
import { getPreviewFidelitySummary } from "@/components/editor/export-button";
import type { PreviewFidelityReport } from "@/services/renderer/types";

function buildReport({
	status = "exact",
}: {
	status?: PreviewFidelityReport["status"];
} = {}): PreviewFidelityReport {
	return {
		status,
		checkedAt: "2026-03-06T12:00:00.000Z",
		graphFingerprint: "graph-v1",
		previewBackend: "binary-preview",
		exportBackend: "binary-canvas",
		issues: [],
		samples: [],
	};
}

describe("preview toolbar helpers", () => {
	test("formats status labels for user-facing copy", () => {
		expect(formatPreviewFidelityStatusLabel({ status: "exact" })).toBe("Exact");
		expect(formatPreviewFidelityStatusLabel({ status: "approximate" })).toBe(
			"Approximate",
		);
		expect(formatPreviewFidelityStatusLabel({ status: "unsupported" })).toBe(
			"Unsupported",
		);
		expect(formatPreviewFidelityStatusLabel({ status: "checking" })).toBe(
			"Checking",
		);
	});

	test("prefers checking when a report is still pending", () => {
		expect(
			getPreviewFidelityStatus({
				report: buildReport({ status: "exact" }),
				isChecking: true,
			}),
		).toBe("checking");
	});

	test("returns status-specific badge classes", () => {
		expect(
			getPreviewFidelityBadgeClassName({
				status: "unsupported",
			}),
		).toContain("text-red-700");
		expect(
			getPreviewFidelityBadgeClassName({
				status: "exact",
			}),
		).toContain("text-green-700");
	});

	test("builds export preview fidelity summary copy", () => {
		expect(
			getPreviewFidelitySummary({
				report: null,
				status: "checking",
			}),
		).toContain("Running deterministic sampled parity checks");

		expect(
			getPreviewFidelitySummary({
				report: buildReport(),
				status: "exact",
			}),
		).toContain("Sampled parity matched across different backends");
	});

	test("explains exact parity across different backends", () => {
		const report = buildReport();
		report.previewBackend = "legacy-canvas";
		report.exportBackend = "binary-canvas";

		expect(
			getPreviewFidelityDetailLine({
				report,
				status: "exact",
			}),
		).toContain("Sampled parity matched across different backends");

		expect(
			getPreviewFidelitySummary({
				report,
				status: "exact",
			}),
		).toContain("Sampled parity matched across different backends");
	});
});
