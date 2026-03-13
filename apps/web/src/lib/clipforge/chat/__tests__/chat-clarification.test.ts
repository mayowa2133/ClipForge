import { describe, expect, test } from "bun:test";
import {
	buildClarificationRequest,
	formatClarificationOptionLabel,
} from "@/lib/clipforge/chat";

describe("chat clarification helpers", () => {
	test("builds deterministic clarification options", () => {
		const result = buildClarificationRequest({
			referenceLabel: "selection:clip",
			candidates: [
				{
					segment_id: "seg-1",
					track_id: "track-1",
					scene_id: "scene-main",
					track_type: "video",
					segment_kind: "video",
					start_ms: 2000,
					end_ms: 5000,
					ordinal: 1,
					asset_id: "clip-1",
					element_name: "Opener",
					text_content: "",
					transcript_snippet:
						"this preview is intentionally long so truncation has to happen cleanly",
				},
			],
		});

		expect(result.kind).toBe("target");
		expect(result.referenceLabel).toBe("selection:clip");
		expect(result.options[0]?.label).toBe("Clip 1 · 00:02–00:05");
		expect(result.options[0]?.text_preview.endsWith("...")).toBe(true);
	});

	test("formats caption labels correctly", () => {
		expect(
			formatClarificationOptionLabel({
				label: "2",
				segment_kind: "caption",
				start_ms: 7000,
				end_ms: 8000,
			}),
		).toBe("Caption 2 · 00:07–00:08");
	});
});
