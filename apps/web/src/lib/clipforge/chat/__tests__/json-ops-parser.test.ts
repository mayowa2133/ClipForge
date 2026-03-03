import { describe, expect, test } from "bun:test";
import {
	extractJsonArrayCandidate,
	parseModelOpsPayload,
	structurallyGuardOps,
} from "@/lib/clipforge/chat";

describe("json ops parser", () => {
	test("extracts the first JSON array from fenced prose", () => {
		const text = 'Here you go:\n```json\n[{"type":"MAKE_VERSION","duration_target_s":30,"aggressiveness":0.75}]\n```';

		expect(extractJsonArrayCandidate(text)).toBe(
			'[{"type":"MAKE_VERSION","duration_target_s":30,"aggressiveness":0.75}]',
		);
	});

	test("parses model payload with formatting warnings", () => {
		const parsed = parseModelOpsPayload(
			'Plan:\n[{"type":"CUT_RANGE","start_ms":100,"end_ms":200}]',
		);

		expect(parsed.ops).toEqual([
			{ type: "CUT_RANGE", start_ms: 100, end_ms: 200 },
		]);
		expect(parsed.warnings).toHaveLength(1);
	});

	test("rejects malformed payloads", () => {
		expect(() => parseModelOpsPayload("No JSON here")).toThrow(
			"Model response did not contain a JSON array.",
		);
	});

	test("structurally guards supported op arrays", () => {
		const guarded = structurallyGuardOps([
			{ type: "MAKE_VERSION", duration_target_s: 30, aggressiveness: 0.75 },
		]);

		expect(guarded.ok).toBe(true);
		expect(guarded.ops).toHaveLength(1);
	});

	test("rejects unsupported ops and oversized arrays", () => {
		expect(
			structurallyGuardOps([{ type: "DO_MAGIC" }]).ok,
		).toBe(false);
		expect(
			structurallyGuardOps(
				Array.from({ length: 9 }, () => ({
					type: "MAKE_VERSION",
					duration_target_s: 30,
					aggressiveness: 0.75,
				})),
			).ok,
		).toBe(false);
	});
});
