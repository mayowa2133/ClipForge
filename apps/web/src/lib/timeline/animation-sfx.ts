import type { TextElement, AnimationSfxPresetId } from "@/types/timeline";

export interface AnimationSfxSequenceItem {
	libraryItemId: string;
	offsetMs: number;
	gainDb?: number;
}

export interface AnimationSfxPairing {
	id: AnimationSfxPresetId;
	label: string;
	targetKind: "graphics" | "caption";
	motionPresetId?: string | null;
	captionStyleId?: string | null;
	sfxSequence: AnimationSfxSequenceItem[];
}

export const ANIMATION_SFX_PAIRINGS: AnimationSfxPairing[] = [
	{
		id: "typing-clean",
		label: "Typing Clean",
		targetKind: "caption",
		captionStyleId: "clean-bottom",
		sfxSequence: [{ libraryItemId: "typing-soft-key", offsetMs: 0, gainDb: -2 }],
	},
	{
		id: "typing-soft",
		label: "Typing Soft",
		targetKind: "caption",
		sfxSequence: [{ libraryItemId: "typing-retro-key", offsetMs: 0, gainDb: -4 }],
	},
	{
		id: "cursor-blink",
		label: "Cursor Blink",
		targetKind: "caption",
		sfxSequence: [{ libraryItemId: "cursor-blink", offsetMs: 0, gainDb: -5 }],
	},
	{
		id: "caption-pop-clean",
		label: "Caption Pop Clean",
		targetKind: "caption",
		captionStyleId: "clean-bottom",
		sfxSequence: [{ libraryItemId: "caption-pop-clean", offsetMs: 0 }],
	},
	{
		id: "caption-pop-bright",
		label: "Caption Pop Bright",
		targetKind: "caption",
		captionStyleId: "bold-center",
		sfxSequence: [
			{ libraryItemId: "caption-pop-bright", offsetMs: 0 },
			{ libraryItemId: "mini-riser", offsetMs: 70, gainDb: -4 },
		],
	},
	{
		id: "air-fahhh-soft",
		label: "Air Fahhh Soft",
		targetKind: "graphics",
		motionPresetId: "fade-up",
		sfxSequence: [{ libraryItemId: "air-fahhh-soft", offsetMs: 0, gainDb: -3 }],
	},
	{
		id: "air-fahhh-bold",
		label: "Air Fahhh Bold",
		targetKind: "graphics",
		motionPresetId: "slide-up",
		sfxSequence: [{ libraryItemId: "air-fahhh-bold", offsetMs: 0 }],
	},
	{
		id: "whoosh-pop",
		label: "Whoosh Pop",
		targetKind: "graphics",
		motionPresetId: "pop-in",
		sfxSequence: [
			{ libraryItemId: "transition-air-glam", offsetMs: 0, gainDb: -2 },
			{ libraryItemId: "caption-pop-bright", offsetMs: 90, gainDb: -1 },
		],
	},
];

export function getAnimationSfxPairingById({
	pairingId,
}: {
	pairingId: AnimationSfxPresetId;
}): AnimationSfxPairing | null {
	return ANIMATION_SFX_PAIRINGS.find((pairing) => pairing.id === pairingId) ?? null;
}

export function getAnimationSfxPairingsForTarget({
	targetKind,
	element,
}: {
	targetKind: "graphics" | "caption";
	element?: TextElement | null;
}): AnimationSfxPairing[] {
	if (!element) {
		return ANIMATION_SFX_PAIRINGS.filter((pairing) => pairing.targetKind === targetKind);
	}
	if (targetKind === "caption") {
		const candidateIds = new Set<string>([
			element.overlayMeta?.variantId ?? "",
			element.role === "caption" ? "clean-bottom" : "",
		]);
		return ANIMATION_SFX_PAIRINGS.filter(
			(pairing) =>
				pairing.targetKind === "caption" &&
				(!pairing.captionStyleId || candidateIds.has(pairing.captionStyleId)),
		);
	}
	return ANIMATION_SFX_PAIRINGS.filter((pairing) => pairing.targetKind === "graphics");
}
