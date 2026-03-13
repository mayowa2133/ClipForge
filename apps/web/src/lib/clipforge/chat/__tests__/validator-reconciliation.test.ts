import { describe, expect, test } from "bun:test";
import {
	buildProjectSegmentSummaryFixture,
	buildProjectSummaryFixture,
} from "@/lib/clipforge/__tests__/fixtures";
import { reconcileValidatorErrors } from "@/lib/clipforge/chat/validator-reconciliation";
import type { ChatPlannerContext, ProjectSummary } from "@/lib/clipforge/chat/types";
import type { TimelineOpsValidationResult } from "@/lib/clipforge/ops-validator";
import type { TimelineDiffOp } from "@/types/clipforge";

const baseSummary: ProjectSummary = buildProjectSummaryFixture({
	total_duration_s: 12,
	segments: [
		buildProjectSegmentSummaryFixture({
			segment_id: "seg-1",
			element_name: "Clip 1",
			start_ms: 0,
			end_ms: 4000,
			asset_id: "asset-1",
			transcript_snippet: "clipforge one",
		}),
		buildProjectSegmentSummaryFixture({
			segment_id: "seg-2",
			element_name: "Clip 2",
			start_ms: 4000,
			end_ms: 8000,
			ordinal: 2,
			asset_id: "asset-2",
			transcript_snippet: "clipforge two",
		}),
		buildProjectSegmentSummaryFixture({
			segment_id: "cap-1",
			track_id: "track-text",
			track_type: "text",
			segment_kind: "caption",
			element_name: "Caption 1",
			start_ms: 500,
			end_ms: 1500,
			ordinal: 1,
			asset_id: null,
			text_content: "demo",
		}),
	],
	media_assets: [
		{
			asset_id: "asset-1",
			name: "clip-1.mp4",
			type: "video",
		},
		{
			asset_id: "asset-2",
			name: "clip-2.mp4",
			type: "video",
		},
	],
	timeline_words: [
		{
			text: "clipforge",
			start_ms: 800,
			end_ms: 1000,
			segment_id: "seg-1",
			media_id: "asset-1",
		},
		{
			text: "clipforge",
			start_ms: 4700,
			end_ms: 5000,
			segment_id: "seg-2",
			media_id: "asset-2",
		},
	],
});

const context: ChatPlannerContext = {
	playhead_ms: 1000,
	selected_segment_ids: [],
	active_scene_id: "scene-main",
};

function createValidateMock({
	first,
	second,
}: {
	first: TimelineOpsValidationResult;
	second: TimelineOpsValidationResult;
}) {
	const calls: unknown[][] = [];
	const validate = ({ ops }: { ops: unknown[] }) => {
		calls.push(ops);
		if (calls.length === 1) return first;
		return second;
	};
	return { validate, calls };
}

describe("reconcileValidatorErrors", () => {
	test("repairs missing segment id from unique intent and revalidates once", () => {
		const ops: TimelineDiffOp[] = [
			{
				type: "MOVE_SEGMENT",
				segment_id: "missing",
				to_ms: 5000,
			},
		];
		const { validate, calls } = createValidateMock({
			first: {
				valid: false,
				ops: [],
				errors: [
					{
						opIndex: 0,
						code: "segment_not_found",
						message: "segment missing",
					},
				],
			},
			second: {
				valid: true,
				ops: [
					{
						type: "MOVE_SEGMENT",
						segment_id: "seg-1",
						to_ms: 5000,
					},
				],
				errors: [],
			},
		});

		const result = reconcileValidatorErrors({
			userText: "move the first clip to 5s",
			projectSummary: baseSummary,
			context,
			ops,
			validateOps: validate,
		});

		expect(result.blocked).toBe(false);
		expect(result.clarification).toBeNull();
		expect(result.ops).toHaveLength(1);
		expect((result.ops[0] as any).segment_id).toBe("seg-1");
		expect(result.safety.repairedCount).toBeGreaterThan(0);
		expect(calls).toHaveLength(2);
	});

	test("returns clarification when target recovery is ambiguous", () => {
		const ops: TimelineDiffOp[] = [
			{
				type: "DELETE_SEGMENT",
				segment_id: "missing",
			},
		];
		const { validate, calls } = createValidateMock({
			first: {
				valid: false,
				ops: [],
				errors: [
					{
						opIndex: 0,
						code: "segment_not_found",
						message: "segment missing",
					},
				],
			},
			second: {
				valid: true,
				ops: [],
				errors: [],
			},
		});

		const result = reconcileValidatorErrors({
			userText: 'delete the clip where i say "clipforge"',
			projectSummary: baseSummary,
			context,
			ops,
			validateOps: validate,
		});

		expect(result.blocked).toBe(true);
		expect(result.ops).toEqual([]);
		expect(result.clarification?.kind).toBe("target");
		expect(
			result.safety.notices.some(
				(notice) => notice.code === "blocked_validator_reconcile_ambiguous",
			),
		).toBe(true);
		expect(calls).toHaveLength(1);
	});

	test("drops unrecoverable target and blocks when no safe ops remain", () => {
		const ops: TimelineDiffOp[] = [
			{
				type: "DELETE_SEGMENT",
				segment_id: "missing",
			},
		];
		const { validate } = createValidateMock({
			first: {
				valid: false,
				ops: [],
				errors: [
					{
						opIndex: 0,
						code: "segment_not_found",
						message: "segment missing",
					},
				],
			},
			second: {
				valid: true,
				ops: [],
				errors: [],
			},
		});

		const result = reconcileValidatorErrors({
			userText: "make it faster",
			projectSummary: baseSummary,
			context,
			ops,
			validateOps: validate,
		});

		expect(result.blocked).toBe(true);
		expect(result.clarification).toBeNull();
		expect(result.ops).toEqual([]);
		expect(result.safety.droppedCount).toBe(1);
		expect(
			result.safety.notices.some(
				(notice) => notice.code === "blocked_validator_reconcile_failed",
			),
		).toBe(true);
	});

	test("clamps invalid CUT_RANGE and returns validator-clean ops", () => {
		const ops: TimelineDiffOp[] = [
			{
				type: "CUT_RANGE",
				start_ms: -100,
				end_ms: 20000,
			},
		];
		let secondPassOps: unknown[] = [];
		const { validate } = createValidateMock({
			first: {
				valid: false,
				ops: [],
				errors: [
					{
						opIndex: 0,
						code: "invalid_cut_range",
						message: "range invalid",
					},
				],
			},
			second: {
				valid: true,
				ops: [
					{
						type: "CUT_RANGE",
						start_ms: 0,
						end_ms: 12000,
					},
				],
				errors: [],
			},
		});

		const validateWithCapture = ({ ops }: { ops: unknown[] }) => {
			if (secondPassOps.length === 0) {
				const first = validate({ ops });
				return first;
			}
			return validate({ ops });
		};

		const wrappedValidate = ({ ops }: { ops: unknown[] }) => {
			if (secondPassOps.length === 0) {
				secondPassOps = ops;
			}
			return validateWithCapture({ ops });
		};

		const result = reconcileValidatorErrors({
			userText: "cut where i say \"demo\"",
			projectSummary: baseSummary,
			context,
			ops,
			validateOps: wrappedValidate,
		});

		expect(result.blocked).toBe(false);
		expect(result.ops).toHaveLength(1);
		expect((result.ops[0] as any).start_ms).toBe(0);
		expect((result.ops[0] as any).end_ms).toBe(12000);
	});
});
