import { describe, expect, test } from "bun:test";
import {
	buildEnabledOpsMap,
	selectEnabledOps,
} from "@/components/editor/panels/chat/chat-content";
import type { TimelineDiffOp } from "@/types/clipforge";

const sampleOps: TimelineDiffOp[] = [
	{
		type: "MAKE_VERSION",
		duration_target_s: 7,
		aggressiveness: 0.5,
	},
	{
		type: "SET_CAPTION_STYLE",
		style_id: "bold-center",
		font: "Arial",
		size: 64,
		position: "center",
		outline: true,
		highlight_mode: "word",
	},
	{
		type: "ADD_TEXT_OVERLAY",
		text: "watch this",
		start_ms: 0,
		end_ms: 2500,
		position: "top",
		style_id: "overlay-top",
		font: "Arial",
		size: 64,
		color: "#FFFFFF",
		outline: true,
		background: false,
	},
];

describe("chat selective apply helpers", () => {
	test("all toggles enabled keeps full subset", () => {
		const enabled = buildEnabledOpsMap({ ops: sampleOps });
		const selected = selectEnabledOps({
			ops: sampleOps,
			enabledOpsByIndex: enabled,
		});

		expect(selected).toEqual(sampleOps);
	});

	test("disabling one op removes it from selected subset", () => {
		const selected = selectEnabledOps({
			ops: sampleOps,
			enabledOpsByIndex: {
				0: true,
				1: false,
				2: true,
			},
		});

		expect(selected).toHaveLength(2);
		expect(selected.map((op) => op.type)).toEqual(["MAKE_VERSION", "ADD_TEXT_OVERLAY"]);
	});

	test("empty subset is possible and should block apply upstream", () => {
		const selected = selectEnabledOps({
			ops: sampleOps,
			enabledOpsByIndex: {
				0: false,
				1: false,
				2: false,
			},
		});

		expect(selected).toEqual([]);
	});
});
