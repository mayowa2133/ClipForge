import { describe, expect, test } from "bun:test";
import {
	extractTimelineOpsFromCommands,
	normalizeChatPlanResult,
	wrapTimelineOpsAsCommands,
} from "@/lib/clipforge/chat";

describe("command plan compatibility", () => {
	test("wraps legacy ops into command plans", () => {
		const normalized = normalizeChatPlanResult({
			ops: [
				{
					type: "MAKE_VERSION",
					duration_target_s: 20,
					aggressiveness: 0.75,
				},
			],
			provider: "heuristic",
			fallbackUsed: false,
			warnings: [],
			clarification: null,
		});

		expect(normalized.commands).toEqual([
			{
				kind: "timeline-op",
				op: {
					type: "MAKE_VERSION",
					duration_target_s: 20,
					aggressiveness: 0.75,
				},
			},
		]);
		expect(normalized.ops).toHaveLength(1);
	});

	test("extracts timeline ops from mixed command plans", () => {
		const commands = [
			...wrapTimelineOpsAsCommands([
				{
					type: "DELETE_SEGMENT" as const,
					segment_id: "seg-1",
				},
			]),
			{
				kind: "set-audio-mix" as const,
				settings: {
					duckingEnabled: true,
					duckingAmount: 0.55,
				},
				scope: "project" as const,
			},
		];

		expect(extractTimelineOpsFromCommands(commands)).toEqual([
			{
				type: "DELETE_SEGMENT",
				segment_id: "seg-1",
			},
		]);
	});
});
