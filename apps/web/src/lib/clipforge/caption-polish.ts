import type { CaptionRevealPresetId } from "@/types/clipforge";
import type { AnimationSfxPresetId, TextElement, VisualKeyframeMap } from "@/types/timeline";

const DEFAULT_REVEAL_DURATION = 0.36;

export function buildCaptionRevealKeyframes({
	element,
	presetId,
}: {
	element: TextElement;
	presetId: CaptionRevealPresetId;
}): VisualKeyframeMap | null {
	if (presetId === "none") {
		return null;
	}

	const revealDuration = Math.max(
		0.18,
		Math.min(element.duration, getRevealDuration({ presetId })),
	);
	const finalScale = element.transform.scale;
	const finalY = element.transform.position.y;
	const finalOpacity = element.opacity;

	switch (presetId) {
		case "fade-line":
			return {
				opacity: [
					{ time: 0, value: 0 },
					{ time: revealDuration, value: finalOpacity },
				],
			};
		case "pop-line":
			return {
				opacity: [
					{ time: 0, value: 0 },
					{ time: revealDuration, value: finalOpacity },
				],
				scale: [
					{ time: 0, value: Number((finalScale * 0.92).toFixed(4)) },
					{ time: revealDuration, value: finalScale },
				],
				positionY: [
					{ time: 0, value: Number((finalY + 0.025).toFixed(4)) },
					{ time: revealDuration, value: finalY },
				],
			};
		case "type-on-soft":
			return {
				opacity: [
					{ time: 0, value: 0 },
					{ time: revealDuration, value: finalOpacity },
				],
				positionY: [
					{ time: 0, value: Number((finalY + 0.012).toFixed(4)) },
					{ time: revealDuration, value: finalY },
				],
			};
		case "type-on-bold":
			return {
				opacity: [
					{ time: 0, value: 0 },
					{ time: revealDuration, value: finalOpacity },
				],
				scale: [
					{ time: 0, value: Number((finalScale * 0.97).toFixed(4)) },
					{ time: revealDuration, value: finalScale },
				],
				positionY: [
					{ time: 0, value: Number((finalY + 0.018).toFixed(4)) },
					{ time: revealDuration, value: finalY },
				],
			};
		case "lift-in":
			return {
				opacity: [
					{ time: 0, value: 0 },
					{ time: revealDuration, value: finalOpacity },
				],
				positionY: [
					{ time: 0, value: Number((finalY + 0.02).toFixed(4)) },
					{ time: revealDuration, value: finalY },
				],
			};
		case "luxury-rise":
			return {
				opacity: [
					{ time: 0, value: 0 },
					{ time: revealDuration, value: finalOpacity },
				],
				positionY: [
					{ time: 0, value: Number((finalY + 0.03).toFixed(4)) },
					{ time: revealDuration, value: finalY },
				],
				scale: [
					{ time: 0, value: Number((finalScale * 0.985).toFixed(4)) },
					{ time: revealDuration, value: finalScale },
				],
			};
		default:
			return null;
	}
}

export function getCaptionRevealSoundSyncPreset({
	presetId,
}: {
	presetId: CaptionRevealPresetId;
}): AnimationSfxPresetId | null {
	switch (presetId) {
		case "type-on-soft":
			return "typing-soft";
		case "type-on-bold":
			return "typing-clean";
		case "pop-line":
			return "caption-pop-bright";
		case "fade-line":
		case "lift-in":
			return "caption-pop-clean";
		case "luxury-rise":
			return "air-fahhh-soft";
		case "none":
		default:
			return null;
	}
}

function getRevealDuration({
	presetId,
}: {
	presetId: CaptionRevealPresetId;
}): number {
	switch (presetId) {
		case "fade-line":
			return 0.24;
		case "pop-line":
			return 0.2;
		case "type-on-soft":
			return 0.28;
		case "type-on-bold":
			return 0.22;
		case "lift-in":
			return 0.26;
		case "luxury-rise":
			return 0.42;
		case "none":
		default:
			return DEFAULT_REVEAL_DURATION;
	}
}
