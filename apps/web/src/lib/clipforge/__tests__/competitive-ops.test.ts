import { describe, expect, test } from "bun:test";
import type {
	ApplyColorGradeOp,
	ExtractHighlightOp,
	SetKeyframeEasingOp,
	SetSpeedRampOp,
	SmartZoomOp,
	TimelineDiffOp,
} from "@/types/clipforge";

/**
 * Tests for the 5 competitive-parity op types:
 * SET_SPEED_RAMP, SMART_ZOOM, EXTRACT_HIGHLIGHT,
 * APPLY_COLOR_GRADE, SET_KEYFRAME_EASING
 */

// ----------------------------------------------------------------
// Type-level checks — ensure each op satisfies TimelineDiffOp
// ----------------------------------------------------------------

describe("op type compatibility", () => {
	test("SetSpeedRampOp is a valid TimelineDiffOp", () => {
		const op: TimelineDiffOp = {
			type: "SET_SPEED_RAMP",
			clip_id: "seg_1",
			curve: "ease-in",
			speed_start: 1.0,
			speed_end: 0.3,
			ramp_start_ms: 0,
			ramp_end_ms: 2000,
		};
		expect(op.type).toBe("SET_SPEED_RAMP");
	});

	test("SmartZoomOp is a valid TimelineDiffOp", () => {
		const op: TimelineDiffOp = {
			type: "SMART_ZOOM",
			clip_id: "seg_1",
			zoom_start: 1.0,
			zoom_end: 1.5,
			focus_x: 0.5,
			focus_y: 0.5,
			ease: "ease-in-out",
		};
		expect(op.type).toBe("SMART_ZOOM");
	});

	test("ExtractHighlightOp is a valid TimelineDiffOp", () => {
		const op: TimelineDiffOp = {
			type: "EXTRACT_HIGHLIGHT",
			source_clip_id: "seg_1",
			target_duration_s: 15,
			strategy: "combined",
			keep_original: false,
		};
		expect(op.type).toBe("EXTRACT_HIGHLIGHT");
	});

	test("ApplyColorGradeOp is a valid TimelineDiffOp", () => {
		const op: TimelineDiffOp = {
			type: "APPLY_COLOR_GRADE",
			preset: "cool-cinematic",
			intensity: 0.7,
			clip_id: null,
		};
		expect(op.type).toBe("APPLY_COLOR_GRADE");
	});

	test("SetKeyframeEasingOp is a valid TimelineDiffOp", () => {
		const op: TimelineDiffOp = {
			type: "SET_KEYFRAME_EASING",
			element_id: "elem_1",
			property: "scale",
			easing: "ease-out",
			keyframe_index: 0,
		};
		expect(op.type).toBe("SET_KEYFRAME_EASING");
	});
});

// ----------------------------------------------------------------
// SET_SPEED_RAMP
// ----------------------------------------------------------------

describe("SetSpeedRampOp", () => {
	test("supports all curve types", () => {
		const curves: SetSpeedRampOp["curve"][] = [
			"ease-in",
			"ease-out",
			"ease-in-out",
			"flash",
		];

		for (const curve of curves) {
			const op: SetSpeedRampOp = {
				type: "SET_SPEED_RAMP",
				clip_id: "seg_1",
				curve,
				speed_start: 1.0,
				speed_end: 0.5,
				ramp_start_ms: 0,
				ramp_end_ms: 1000,
			};
			expect(op.curve).toBe(curve);
		}
	});

	test("accepts valid speed values", () => {
		const op: SetSpeedRampOp = {
			type: "SET_SPEED_RAMP",
			clip_id: "seg_1",
			curve: "ease-in",
			speed_start: 0.1,
			speed_end: 4.0,
			ramp_start_ms: 500,
			ramp_end_ms: 3000,
		};
		expect(op.speed_start).toBe(0.1);
		expect(op.speed_end).toBe(4.0);
	});

	test("ramp window is a time range", () => {
		const op: SetSpeedRampOp = {
			type: "SET_SPEED_RAMP",
			clip_id: "seg_1",
			curve: "flash",
			speed_start: 0.3,
			speed_end: 2.5,
			ramp_start_ms: 1000,
			ramp_end_ms: 2000,
		};
		expect(op.ramp_end_ms - op.ramp_start_ms).toBe(1000);
	});
});

// ----------------------------------------------------------------
// SMART_ZOOM
// ----------------------------------------------------------------

describe("SmartZoomOp", () => {
	test("supports all easing types", () => {
		const easings: SmartZoomOp["ease"][] = [
			"linear",
			"ease-in",
			"ease-out",
			"ease-in-out",
		];

		for (const ease of easings) {
			const op: SmartZoomOp = {
				type: "SMART_ZOOM",
				clip_id: "seg_1",
				zoom_start: 1.0,
				zoom_end: 1.3,
				focus_x: 0.5,
				focus_y: 0.5,
				ease,
			};
			expect(op.ease).toBe(ease);
		}
	});

	test("focus point represents normalized coordinates", () => {
		const op: SmartZoomOp = {
			type: "SMART_ZOOM",
			clip_id: "seg_1",
			zoom_start: 1.0,
			zoom_end: 1.5,
			focus_x: 0.3,
			focus_y: 0.7,
			ease: "ease-in-out",
		};
		expect(op.focus_x).toBeGreaterThanOrEqual(0);
		expect(op.focus_x).toBeLessThanOrEqual(1);
		expect(op.focus_y).toBeGreaterThanOrEqual(0);
		expect(op.focus_y).toBeLessThanOrEqual(1);
	});

	test("zoom in has zoom_end > zoom_start", () => {
		const op: SmartZoomOp = {
			type: "SMART_ZOOM",
			clip_id: "seg_1",
			zoom_start: 1.0,
			zoom_end: 2.0,
			focus_x: 0.5,
			focus_y: 0.5,
			ease: "ease-in",
		};
		expect(op.zoom_end).toBeGreaterThan(op.zoom_start);
	});

	test("zoom out has zoom_end < zoom_start", () => {
		const op: SmartZoomOp = {
			type: "SMART_ZOOM",
			clip_id: "seg_1",
			zoom_start: 1.5,
			zoom_end: 1.0,
			focus_x: 0.5,
			focus_y: 0.5,
			ease: "ease-out",
		};
		expect(op.zoom_end).toBeLessThan(op.zoom_start);
	});
});

// ----------------------------------------------------------------
// EXTRACT_HIGHLIGHT
// ----------------------------------------------------------------

describe("ExtractHighlightOp", () => {
	test("supports all extraction strategies", () => {
		const strategies: ExtractHighlightOp["strategy"][] = [
			"visual-peaks",
			"speech-density",
			"combined",
		];

		for (const strategy of strategies) {
			const op: ExtractHighlightOp = {
				type: "EXTRACT_HIGHLIGHT",
				source_clip_id: "seg_1",
				target_duration_s: 10,
				strategy,
				keep_original: false,
			};
			expect(op.strategy).toBe(strategy);
		}
	});

	test("keep_original controls whether source is preserved", () => {
		const keepOp: ExtractHighlightOp = {
			type: "EXTRACT_HIGHLIGHT",
			source_clip_id: "seg_1",
			target_duration_s: 15,
			strategy: "combined",
			keep_original: true,
		};
		const replaceOp: ExtractHighlightOp = {
			type: "EXTRACT_HIGHLIGHT",
			source_clip_id: "seg_1",
			target_duration_s: 15,
			strategy: "combined",
			keep_original: false,
		};
		expect(keepOp.keep_original).toBe(true);
		expect(replaceOp.keep_original).toBe(false);
	});

	test("target_duration_s is the desired highlight length", () => {
		const op: ExtractHighlightOp = {
			type: "EXTRACT_HIGHLIGHT",
			source_clip_id: "seg_1",
			target_duration_s: 30,
			strategy: "visual-peaks",
			keep_original: false,
		};
		expect(op.target_duration_s).toBe(30);
	});
});

// ----------------------------------------------------------------
// APPLY_COLOR_GRADE
// ----------------------------------------------------------------

describe("ApplyColorGradeOp", () => {
	test("supports all color grade presets", () => {
		const presets: ApplyColorGradeOp["preset"][] = [
			"warm-vintage",
			"cool-cinematic",
			"vibrant-social",
			"desaturated-film",
			"golden-hour",
			"moody-dark",
		];

		for (const preset of presets) {
			const op: ApplyColorGradeOp = {
				type: "APPLY_COLOR_GRADE",
				preset,
				intensity: 0.7,
				clip_id: null,
			};
			expect(op.preset).toBe(preset);
		}
	});

	test("null clip_id applies to all clips", () => {
		const op: ApplyColorGradeOp = {
			type: "APPLY_COLOR_GRADE",
			preset: "cool-cinematic",
			intensity: 0.8,
			clip_id: null,
		};
		expect(op.clip_id).toBeNull();
	});

	test("specific clip_id targets one clip", () => {
		const op: ApplyColorGradeOp = {
			type: "APPLY_COLOR_GRADE",
			preset: "golden-hour",
			intensity: 0.6,
			clip_id: "seg_3",
		};
		expect(op.clip_id).toBe("seg_3");
	});

	test("intensity ranges from 0 to 1", () => {
		const subtle: ApplyColorGradeOp = {
			type: "APPLY_COLOR_GRADE",
			preset: "warm-vintage",
			intensity: 0.2,
			clip_id: null,
		};
		const strong: ApplyColorGradeOp = {
			type: "APPLY_COLOR_GRADE",
			preset: "warm-vintage",
			intensity: 1.0,
			clip_id: null,
		};
		expect(subtle.intensity).toBeLessThan(strong.intensity);
	});
});

// ----------------------------------------------------------------
// SET_KEYFRAME_EASING
// ----------------------------------------------------------------

describe("SetKeyframeEasingOp", () => {
	test("supports all easing types", () => {
		const easings: SetKeyframeEasingOp["easing"][] = [
			"linear",
			"ease-in",
			"ease-out",
			"ease-in-out",
			"spring",
			"bounce",
		];

		for (const easing of easings) {
			const op: SetKeyframeEasingOp = {
				type: "SET_KEYFRAME_EASING",
				element_id: "elem_1",
				property: "scale",
				easing,
				keyframe_index: 0,
			};
			expect(op.easing).toBe(easing);
		}
	});

	test("supports all animatable properties", () => {
		const properties: SetKeyframeEasingOp["property"][] = [
			"position",
			"scale",
			"rotation",
			"opacity",
		];

		for (const property of properties) {
			const op: SetKeyframeEasingOp = {
				type: "SET_KEYFRAME_EASING",
				element_id: "elem_1",
				property,
				easing: "ease-in-out",
				keyframe_index: 0,
			};
			expect(op.property).toBe(property);
		}
	});

	test("keyframe_index identifies which keyframe", () => {
		const first: SetKeyframeEasingOp = {
			type: "SET_KEYFRAME_EASING",
			element_id: "elem_1",
			property: "position",
			easing: "bounce",
			keyframe_index: 0,
		};
		const second: SetKeyframeEasingOp = {
			type: "SET_KEYFRAME_EASING",
			element_id: "elem_1",
			property: "position",
			easing: "spring",
			keyframe_index: 1,
		};
		expect(first.keyframe_index).toBe(0);
		expect(second.keyframe_index).toBe(1);
	});
});

// ----------------------------------------------------------------
// Schema validation sets
// ----------------------------------------------------------------

describe("schema validation sets", () => {
	test("ALLOWED_SPEED_RAMP_CURVES contains all curve types", async () => {
		const { ALLOWED_SPEED_RAMP_CURVES } = await import("../timeline-ops-schema");
		expect(ALLOWED_SPEED_RAMP_CURVES.has("ease-in")).toBe(true);
		expect(ALLOWED_SPEED_RAMP_CURVES.has("ease-out")).toBe(true);
		expect(ALLOWED_SPEED_RAMP_CURVES.has("ease-in-out")).toBe(true);
		expect(ALLOWED_SPEED_RAMP_CURVES.has("flash")).toBe(true);
		expect(ALLOWED_SPEED_RAMP_CURVES.size).toBe(4);
	});

	test("ALLOWED_SMART_ZOOM_EASINGS contains all easing types", async () => {
		const { ALLOWED_SMART_ZOOM_EASINGS } = await import("../timeline-ops-schema");
		expect(ALLOWED_SMART_ZOOM_EASINGS.has("linear")).toBe(true);
		expect(ALLOWED_SMART_ZOOM_EASINGS.has("ease-in")).toBe(true);
		expect(ALLOWED_SMART_ZOOM_EASINGS.has("ease-out")).toBe(true);
		expect(ALLOWED_SMART_ZOOM_EASINGS.has("ease-in-out")).toBe(true);
		expect(ALLOWED_SMART_ZOOM_EASINGS.size).toBe(4);
	});

	test("ALLOWED_HIGHLIGHT_STRATEGIES contains all strategies", async () => {
		const { ALLOWED_HIGHLIGHT_STRATEGIES } = await import("../timeline-ops-schema");
		expect(ALLOWED_HIGHLIGHT_STRATEGIES.has("visual-peaks")).toBe(true);
		expect(ALLOWED_HIGHLIGHT_STRATEGIES.has("speech-density")).toBe(true);
		expect(ALLOWED_HIGHLIGHT_STRATEGIES.has("combined")).toBe(true);
		expect(ALLOWED_HIGHLIGHT_STRATEGIES.size).toBe(3);
	});

	test("ALLOWED_COLOR_GRADE_PRESETS contains all presets", async () => {
		const { ALLOWED_COLOR_GRADE_PRESETS } = await import("../timeline-ops-schema");
		expect(ALLOWED_COLOR_GRADE_PRESETS.has("warm-vintage")).toBe(true);
		expect(ALLOWED_COLOR_GRADE_PRESETS.has("cool-cinematic")).toBe(true);
		expect(ALLOWED_COLOR_GRADE_PRESETS.has("vibrant-social")).toBe(true);
		expect(ALLOWED_COLOR_GRADE_PRESETS.has("desaturated-film")).toBe(true);
		expect(ALLOWED_COLOR_GRADE_PRESETS.has("golden-hour")).toBe(true);
		expect(ALLOWED_COLOR_GRADE_PRESETS.has("moody-dark")).toBe(true);
		expect(ALLOWED_COLOR_GRADE_PRESETS.size).toBe(6);
	});

	test("ALLOWED_KEYFRAME_EASING_TYPES contains all types", async () => {
		const { ALLOWED_KEYFRAME_EASING_TYPES } = await import("../timeline-ops-schema");
		expect(ALLOWED_KEYFRAME_EASING_TYPES.has("linear")).toBe(true);
		expect(ALLOWED_KEYFRAME_EASING_TYPES.has("ease-in")).toBe(true);
		expect(ALLOWED_KEYFRAME_EASING_TYPES.has("ease-out")).toBe(true);
		expect(ALLOWED_KEYFRAME_EASING_TYPES.has("ease-in-out")).toBe(true);
		expect(ALLOWED_KEYFRAME_EASING_TYPES.has("spring")).toBe(true);
		expect(ALLOWED_KEYFRAME_EASING_TYPES.has("bounce")).toBe(true);
		expect(ALLOWED_KEYFRAME_EASING_TYPES.size).toBe(6);
	});

	test("ALLOWED_KEYFRAME_PROPERTIES contains all properties", async () => {
		const { ALLOWED_KEYFRAME_PROPERTIES } = await import("../timeline-ops-schema");
		expect(ALLOWED_KEYFRAME_PROPERTIES.has("position")).toBe(true);
		expect(ALLOWED_KEYFRAME_PROPERTIES.has("scale")).toBe(true);
		expect(ALLOWED_KEYFRAME_PROPERTIES.has("rotation")).toBe(true);
		expect(ALLOWED_KEYFRAME_PROPERTIES.has("opacity")).toBe(true);
		expect(ALLOWED_KEYFRAME_PROPERTIES.size).toBe(4);
	});

	test("ALLOWED_TIMELINE_OP_TYPES includes all 5 new ops", async () => {
		const { ALLOWED_TIMELINE_OP_TYPES } = await import("../timeline-ops-schema");
		expect(ALLOWED_TIMELINE_OP_TYPES.has("SET_SPEED_RAMP")).toBe(true);
		expect(ALLOWED_TIMELINE_OP_TYPES.has("SMART_ZOOM")).toBe(true);
		expect(ALLOWED_TIMELINE_OP_TYPES.has("EXTRACT_HIGHLIGHT")).toBe(true);
		expect(ALLOWED_TIMELINE_OP_TYPES.has("APPLY_COLOR_GRADE")).toBe(true);
		expect(ALLOWED_TIMELINE_OP_TYPES.has("SET_KEYFRAME_EASING")).toBe(true);
	});

	test("isKnownTimelineOpType recognizes new op types", async () => {
		const { isKnownTimelineOpType } = await import("../timeline-ops-schema");
		expect(isKnownTimelineOpType("SET_SPEED_RAMP")).toBe(true);
		expect(isKnownTimelineOpType("SMART_ZOOM")).toBe(true);
		expect(isKnownTimelineOpType("EXTRACT_HIGHLIGHT")).toBe(true);
		expect(isKnownTimelineOpType("APPLY_COLOR_GRADE")).toBe(true);
		expect(isKnownTimelineOpType("SET_KEYFRAME_EASING")).toBe(true);
		expect(isKnownTimelineOpType("UNKNOWN_OP")).toBe(false);
	});
});
