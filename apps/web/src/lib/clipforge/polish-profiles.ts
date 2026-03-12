import type {
	AudioPolishPresetId,
	CaptionRevealPresetId,
	PolishFinishingLookId,
	PolishProfile,
	PolishProfileId,
} from "@/types/clipforge";
import type { CreativeBrief } from "@/types/clipforge";
import type { TProject } from "@/types/project";

export interface AudioPolishPresetDefinition {
	id: AudioPolishPresetId;
	label: string;
	voiceGainDb: number;
	musicGainDb: number;
	sfxGainDb: number;
	masterGainDb: number;
	duckingAmount?: number | null;
	duckingAttackMs?: number | null;
	duckingReleaseMs?: number | null;
	softLimiterEnabled: boolean;
}

export const AUDIO_POLISH_PRESETS: AudioPolishPresetDefinition[] = [
	{
		id: "none",
		label: "None",
		voiceGainDb: 0,
		musicGainDb: 0,
		sfxGainDb: 0,
		masterGainDb: 0,
		softLimiterEnabled: false,
	},
	{
		id: "voice-forward",
		label: "Voice Forward",
		voiceGainDb: 2,
		musicGainDb: -2,
		sfxGainDb: -0.5,
		masterGainDb: 0.5,
		duckingAmount: 0.6,
		duckingAttackMs: 90,
		duckingReleaseMs: 220,
		softLimiterEnabled: true,
	},
	{
		id: "luxury-soft",
		label: "Luxury Soft",
		voiceGainDb: 1,
		musicGainDb: -3,
		sfxGainDb: -1,
		masterGainDb: -0.25,
		duckingAmount: 0.5,
		duckingAttackMs: 130,
		duckingReleaseMs: 320,
		softLimiterEnabled: true,
	},
	{
		id: "bold-social",
		label: "Bold Social",
		voiceGainDb: 2.5,
		musicGainDb: -1.5,
		sfxGainDb: 1,
		masterGainDb: 0.75,
		duckingAmount: 0.65,
		duckingAttackMs: 70,
		duckingReleaseMs: 180,
		softLimiterEnabled: true,
	},
	{
		id: "music-forward",
		label: "Music Forward",
		voiceGainDb: 0.5,
		musicGainDb: 1,
		sfxGainDb: 0,
		masterGainDb: 0.25,
		duckingAmount: 0.35,
		duckingAttackMs: 120,
		duckingReleaseMs: 280,
		softLimiterEnabled: true,
	},
];

export const CAPTION_REVEAL_LABELS: Record<CaptionRevealPresetId, string> = {
	none: "None",
	"fade-line": "Fade Line",
	"pop-line": "Pop Line",
	"type-on-soft": "Type On Soft",
	"type-on-bold": "Type On Bold",
	"lift-in": "Lift In",
	"luxury-rise": "Luxury Rise",
};

export const FINISHING_LOOK_LABELS: Record<PolishFinishingLookId, string> = {
	clean: "Clean",
	warm: "Warm",
	cool: "Cool",
	dramatic: "Dramatic",
	mono: "Mono",
	vintage: "Vintage",
};

export const POLISH_PROFILES: PolishProfile[] = [
	{
		id: "clean-vlog",
		label: "Clean Vlog",
		captionStyleId: "clean-bottom",
		captionRevealPresetId: "fade-line",
		overlayStyleVariantId: "clean-vlog",
		motionPresetId: "fade-up",
		animationSfxPresetId: "air-fahhh-soft",
		finishingLookId: "clean",
		audioPolishPresetId: "voice-forward",
	},
	{
		id: "luxury-routine",
		label: "Luxury Routine",
		captionStyleId: "luxury-bottom",
		captionRevealPresetId: "luxury-rise",
		overlayStyleVariantId: "luxury",
		motionPresetId: "drift-in",
		animationSfxPresetId: "air-fahhh-bold",
		finishingLookId: "warm",
		audioPolishPresetId: "luxury-soft",
	},
	{
		id: "bold-social",
		label: "Bold Social",
		captionStyleId: "social-pop",
		captionRevealPresetId: "type-on-bold",
		overlayStyleVariantId: "bold-social",
		motionPresetId: "pop-in",
		animationSfxPresetId: "caption-pop-bright",
		finishingLookId: "dramatic",
		audioPolishPresetId: "bold-social",
	},
	{
		id: "talking-head",
		label: "Talking Head",
		captionStyleId: "minimal-bottom",
		captionRevealPresetId: "lift-in",
		overlayStyleVariantId: "minimal",
		motionPresetId: "fade-up",
		animationSfxPresetId: "caption-pop-clean",
		finishingLookId: "clean",
		audioPolishPresetId: "voice-forward",
	},
	{
		id: "product-promo",
		label: "Product Promo",
		captionStyleId: "punchy-center",
		captionRevealPresetId: "pop-line",
		overlayStyleVariantId: "bold-social",
		motionPresetId: "slide-up",
		animationSfxPresetId: "whoosh-pop",
		finishingLookId: "cool",
		audioPolishPresetId: "bold-social",
	},
];

export function getAudioPolishPresetById({
	id,
}: {
	id: AudioPolishPresetId;
}): AudioPolishPresetDefinition {
	return (
		AUDIO_POLISH_PRESETS.find((preset) => preset.id === id) ??
		AUDIO_POLISH_PRESETS[0]!
	);
}

export function getAudioPolishPresetLabel({
	id,
}: {
	id: AudioPolishPresetId;
}): string {
	return getAudioPolishPresetById({ id }).label;
}

export function getCaptionRevealLabel({
	presetId,
}: {
	presetId: CaptionRevealPresetId;
}): string {
	return CAPTION_REVEAL_LABELS[presetId];
}

export function getFinishingLookLabel({
	lookId,
}: {
	lookId: PolishFinishingLookId;
}): string {
	return FINISHING_LOOK_LABELS[lookId];
}

export function getPolishProfileById({
	profileId,
}: {
	profileId: PolishProfileId;
}): PolishProfile | null {
	return POLISH_PROFILES.find((profile) => profile.id === profileId) ?? null;
}

export function getPolishProfileLabel({
	profileId,
}: {
	profileId: PolishProfileId;
}): string {
	return getPolishProfileById({ profileId })?.label ?? profileId;
}

export function resolvePolishProfileFromBrief({
	brief,
	project,
}: {
	brief: CreativeBrief;
	project?: TProject | null;
}): PolishProfile {
	const savedProfileId = project?.settings.polishProfileId ?? null;
	if (savedProfileId) {
		const savedProfile = getPolishProfileById({ profileId: savedProfileId });
		if (savedProfile) {
			return savedProfile;
		}
	}
	if (brief.goal === "luxury-routine" || brief.tone === "luxury") {
		return getPolishProfileById({ profileId: "luxury-routine" })!;
	}
	if (brief.goal === "talking-head") {
		return getPolishProfileById({ profileId: "talking-head" })!;
	}
	if (brief.goal === "product-highlight") {
		return getPolishProfileById({ profileId: "product-promo" })!;
	}
	if (brief.goal === "viral-tiktok" || brief.tone === "bold" || brief.tone === "energetic") {
		return getPolishProfileById({ profileId: "bold-social" })!;
	}
	return getPolishProfileById({ profileId: "clean-vlog" })!;
}
