/**
 * Creator style profile — learn from a finished reference video so future
 * raw clips can be produced automatically without a new reference.
 */
import type { CreatorStyleProfile } from "@/types/clipforge";

/**
 * Default profile matching the "Operating from Abundance" style:
 *  - Keep ~28% of raw footage (255s raw → 72s finished)
 *  - Word-by-word captions, bottom
 *  - Persistent top title
 *  - Music at 30% volume
 */
export const DEFAULT_CREATOR_PROFILE: Omit<
	CreatorStyleProfile,
	"learnedAt" | "learnedFromAssetName" | "rawDurationS" | "finishedDurationS"
> = {
	version: 1,
	targetKeepRatio: 0.28,
	silenceThresholdMs: 600,
	silencePadMs: 300,
	captionStyleId: "word-by-word",
	captionRevealPreset: "word-by-word",
	titleEnabled: true,
	// Reference places the title in the upper third, above the speaker's face
	// (~32% from top), not jammed against the very top edge.
	titlePosition: "center",
	musicVolumeRatio: 0.30,
	musicLoop: true,
};

/**
 * Build a creator style profile from the durations of a raw and finished video.
 *
 * The targetKeepRatio is clamped between 0.10 and 0.95 — anything outside that
 * range usually indicates a wrong pairing of raw/finished.
 */
export function buildCreatorProfileFromDurations({
	rawDurationS,
	finishedDurationS,
	assetName,
}: {
	rawDurationS: number;
	finishedDurationS: number;
	assetName: string | null;
}): CreatorStyleProfile {
	const rawDuration = Math.max(1, rawDurationS);
	const finishedDuration = Math.max(1, finishedDurationS);
	const rawRatio = finishedDuration / rawDuration;
	const targetKeepRatio = Math.max(0.10, Math.min(0.95, rawRatio));

	// Infer silence aggressiveness from keep ratio:
	// High keep ratio (>0.6) → gentle silence removal
	// Low keep ratio (<0.3) → aggressive content scoring required
	const silenceThresholdMs = targetKeepRatio < 0.3 ? 500 : 800;
	const silencePadMs = targetKeepRatio < 0.3 ? 250 : 400;

	return {
		version: 1,
		learnedAt: new Date().toISOString(),
		learnedFromAssetName: assetName,
		rawDurationS: Math.round(rawDuration * 100) / 100,
		finishedDurationS: Math.round(finishedDuration * 100) / 100,
		targetKeepRatio: Math.round(targetKeepRatio * 1000) / 1000,
		silenceThresholdMs,
		silencePadMs,
		// Default style choices — user can override via chat
		captionStyleId: DEFAULT_CREATOR_PROFILE.captionStyleId,
		captionRevealPreset: DEFAULT_CREATOR_PROFILE.captionRevealPreset,
		titleEnabled: DEFAULT_CREATOR_PROFILE.titleEnabled,
		titlePosition: DEFAULT_CREATOR_PROFILE.titlePosition,
		musicVolumeRatio: DEFAULT_CREATOR_PROFILE.musicVolumeRatio,
		musicLoop: DEFAULT_CREATOR_PROFILE.musicLoop,
	};
}

/**
 * Describe a creator profile in plain English for display in the chat panel.
 */
export function describeCreatorProfile(
	profile: CreatorStyleProfile,
): string {
	const keepPct = Math.round(profile.targetKeepRatio * 100);
	const lines: string[] = [
		`Keep ~${keepPct}% of raw footage (${formatDuration(profile.rawDurationS)} raw → ~${formatDuration(profile.finishedDurationS)} finished)`,
		`Captions: ${profile.captionStyleId}${profile.captionRevealPreset ? ` (${profile.captionRevealPreset})` : ""}`,
		`Title overlay: ${profile.titleEnabled ? profile.titlePosition : "off"}`,
		`Music: ${Math.round(profile.musicVolumeRatio * 100)}% volume${profile.musicLoop ? ", looped" : ""}`,
	];
	return lines.join(" · ");
}

function formatDuration(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.round(seconds % 60);
	return m > 0 ? `${m}m${s > 0 ? `${s}s` : ""}` : `${s}s`;
}
