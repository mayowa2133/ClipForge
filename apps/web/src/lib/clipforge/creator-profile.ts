/**
 * Creator style profile — learn from a finished reference video so future
 * raw clips can be produced automatically without a new reference.
 */
import type {
	CreatorStyleProfile,
	ReferenceEditAnalysis,
} from "@/types/clipforge";

/**
 * Default profile matching the "Operating from Abundance" style:
 *  - Keep ~28% of raw footage (255s raw → 72s finished)
 *  - Word-by-word captions, bottom
 *  - Persistent top title
 *  - Music at 30% volume
 */
export const DEFAULT_CREATOR_PROFILE: Omit<
	CreatorStyleProfile,
	| "learnedAt"
	| "learnedFromAssetName"
	| "learnedReferenceCount"
	| "rawDurationS"
	| "finishedDurationS"
> = {
	version: 1,
	targetKeepRatio: 0.28,
	targetDurationS: 72,
	referenceCutCount: 24,
	averageCutMs: 3000,
	cutDensityPerMinute: 20,
	editorialKeepKeywords: [],
	editorialHookKeywords: [],
	editorialPayoffKeywords: [],
	editorialAvoidKeywords: [
		"um",
		"uh",
		"like",
		"actually",
		"basically",
		"literally",
	],
	silenceThresholdMs: 600,
	silencePadMs: 300,
	captionStyleId: "word-by-word",
	captionRevealPreset: "word-by-word",
	maxWordsPerCaption: 1,
	minCaptionDisplayMs: 160,
	titleEnabled: true,
	// Reference places the title in the upper third, above the speaker's face
	// (~32% from top), not jammed against the very top edge.
	titlePosition: "center",
	titleFontSize: 56,
	voiceGainDb: 11,
	musicVolumeRatio: 0.3,
	musicStartOffsetS: 0,
	musicLoop: true,
};

export function resolveAutonomousAudioMix({
	profile,
}: {
	profile: Partial<CreatorStyleProfile>;
}): {
	voiceGainDb: number;
	masterVolume: number;
	effectiveMusicVolume: number;
	musicElementVolume: number;
} {
	const voiceGainDb = Math.max(
		-12,
		Math.min(
			18,
			typeof profile.voiceGainDb === "number" &&
				Number.isFinite(profile.voiceGainDb)
				? profile.voiceGainDb
				: (DEFAULT_CREATOR_PROFILE.voiceGainDb ?? 0),
		),
	);
	const masterVolume = Math.max(0.25, Math.min(4, 10 ** (voiceGainDb / 20)));
	const effectiveMusicVolume = clamp01(
		profile.musicVolumeRatio ?? DEFAULT_CREATOR_PROFILE.musicVolumeRatio,
	);
	return {
		voiceGainDb,
		masterVolume,
		effectiveMusicVolume,
		musicElementVolume: clamp01(effectiveMusicVolume / masterVolume),
	};
}

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
	const targetKeepRatio = Math.max(0.1, Math.min(0.95, rawRatio));

	// Infer silence aggressiveness from keep ratio:
	// High keep ratio (>0.6) → gentle silence removal
	// Low keep ratio (<0.3) → aggressive content scoring required
	const silenceThresholdMs = targetKeepRatio < 0.3 ? 500 : 800;
	const silencePadMs = targetKeepRatio < 0.3 ? 250 : 400;
	const targetDurationS = Math.round(finishedDuration * 100) / 100;

	return {
		version: 1,
		learnedAt: new Date().toISOString(),
		learnedFromAssetName: assetName,
		learnedReferenceCount: 1,
		rawDurationS: Math.round(rawDuration * 100) / 100,
		finishedDurationS: targetDurationS,
		targetKeepRatio: Math.round(targetKeepRatio * 1000) / 1000,
		targetDurationS,
		referenceCutCount: DEFAULT_CREATOR_PROFILE.referenceCutCount,
		averageCutMs: DEFAULT_CREATOR_PROFILE.averageCutMs,
		cutDensityPerMinute: DEFAULT_CREATOR_PROFILE.cutDensityPerMinute,
		editorialKeepKeywords: DEFAULT_CREATOR_PROFILE.editorialKeepKeywords,
		editorialHookKeywords: DEFAULT_CREATOR_PROFILE.editorialHookKeywords,
		editorialPayoffKeywords: DEFAULT_CREATOR_PROFILE.editorialPayoffKeywords,
		editorialAvoidKeywords: DEFAULT_CREATOR_PROFILE.editorialAvoidKeywords,
		silenceThresholdMs,
		silencePadMs,
		// Default style choices — user can override via chat
		captionStyleId: DEFAULT_CREATOR_PROFILE.captionStyleId,
		captionRevealPreset: DEFAULT_CREATOR_PROFILE.captionRevealPreset,
		maxWordsPerCaption: DEFAULT_CREATOR_PROFILE.maxWordsPerCaption,
		minCaptionDisplayMs: DEFAULT_CREATOR_PROFILE.minCaptionDisplayMs,
		titleEnabled: DEFAULT_CREATOR_PROFILE.titleEnabled,
		titlePosition: DEFAULT_CREATOR_PROFILE.titlePosition,
		titleFontSize: DEFAULT_CREATOR_PROFILE.titleFontSize,
		voiceGainDb: DEFAULT_CREATOR_PROFILE.voiceGainDb,
		musicVolumeRatio: DEFAULT_CREATOR_PROFILE.musicVolumeRatio,
		musicStartOffsetS: DEFAULT_CREATOR_PROFILE.musicStartOffsetS,
		musicLoop: DEFAULT_CREATOR_PROFILE.musicLoop,
	};
}

export function blendCreatorStyleProfiles({
	existingProfile,
	newProfile,
}: {
	existingProfile: CreatorStyleProfile | null | undefined;
	newProfile: CreatorStyleProfile;
}): CreatorStyleProfile {
	if (!existingProfile) return newProfile;

	const existingWeight = Math.max(
		1,
		Math.round(existingProfile.learnedReferenceCount ?? 1),
	);
	const newWeight = Math.max(
		1,
		Math.round(newProfile.learnedReferenceCount ?? 1),
	);
	const totalWeight = existingWeight + newWeight;
	const weighted = (
		left: number | null | undefined,
		right: number | null | undefined,
		fallback: number,
	) => {
		const safeLeft =
			typeof left === "number" && Number.isFinite(left) ? left : fallback;
		const safeRight =
			typeof right === "number" && Number.isFinite(right) ? right : fallback;
		return round2(
			(safeLeft * existingWeight + safeRight * newWeight) / totalWeight,
		);
	};
	const weightedInt = (
		left: number | null | undefined,
		right: number | null | undefined,
		fallback: number,
	) => Math.round(weighted(left, right, fallback));

	return {
		...newProfile,
		learnedAt: new Date().toISOString(),
		learnedFromAssetName:
			newProfile.learnedFromAssetName ?? existingProfile.learnedFromAssetName,
		learnedReferenceCount: totalWeight,
		rawDurationS: weighted(
			existingProfile.rawDurationS,
			newProfile.rawDurationS,
			newProfile.rawDurationS,
		),
		finishedDurationS: weighted(
			existingProfile.finishedDurationS,
			newProfile.finishedDurationS,
			newProfile.finishedDurationS,
		),
		targetKeepRatio: round3(
			weighted(
				existingProfile.targetKeepRatio,
				newProfile.targetKeepRatio,
				newProfile.targetKeepRatio,
			),
		),
		targetDurationS: weighted(
			existingProfile.targetDurationS,
			newProfile.targetDurationS,
			newProfile.targetDurationS ?? newProfile.finishedDurationS,
		),
		referenceCutCount: weightedInt(
			existingProfile.referenceCutCount,
			newProfile.referenceCutCount,
			newProfile.referenceCutCount ?? 0,
		),
		averageCutMs: weightedInt(
			existingProfile.averageCutMs,
			newProfile.averageCutMs,
			newProfile.averageCutMs ?? DEFAULT_CREATOR_PROFILE.averageCutMs ?? 3000,
		),
		cutDensityPerMinute: weighted(
			existingProfile.cutDensityPerMinute,
			newProfile.cutDensityPerMinute,
			newProfile.cutDensityPerMinute ??
				DEFAULT_CREATOR_PROFILE.cutDensityPerMinute ??
				20,
		),
		editorialKeepKeywords: mergeKeywords(
			existingProfile.editorialKeepKeywords,
			newProfile.editorialKeepKeywords,
			32,
		),
		editorialHookKeywords: mergeKeywords(
			existingProfile.editorialHookKeywords,
			newProfile.editorialHookKeywords,
			14,
		),
		editorialPayoffKeywords: mergeKeywords(
			existingProfile.editorialPayoffKeywords,
			newProfile.editorialPayoffKeywords,
			14,
		),
		editorialAvoidKeywords: mergeKeywords(
			existingProfile.editorialAvoidKeywords,
			newProfile.editorialAvoidKeywords,
			16,
		),
		silenceThresholdMs: weightedInt(
			existingProfile.silenceThresholdMs,
			newProfile.silenceThresholdMs,
			newProfile.silenceThresholdMs,
		),
		silencePadMs: weightedInt(
			existingProfile.silencePadMs,
			newProfile.silencePadMs,
			newProfile.silencePadMs,
		),
		maxWordsPerCaption: weightedInt(
			existingProfile.maxWordsPerCaption,
			newProfile.maxWordsPerCaption,
			newProfile.maxWordsPerCaption ?? 1,
		),
		minCaptionDisplayMs: weightedInt(
			existingProfile.minCaptionDisplayMs,
			newProfile.minCaptionDisplayMs,
			newProfile.minCaptionDisplayMs ?? 160,
		),
		titleFontSize: weightedInt(
			existingProfile.titleFontSize,
			newProfile.titleFontSize,
			newProfile.titleFontSize ?? DEFAULT_CREATOR_PROFILE.titleFontSize ?? 56,
		),
		voiceGainDb: Math.max(
			-12,
			Math.min(
				18,
				weighted(
					existingProfile.voiceGainDb,
					newProfile.voiceGainDb,
					newProfile.voiceGainDb ?? DEFAULT_CREATOR_PROFILE.voiceGainDb ?? 0,
				),
			),
		),
		musicVolumeRatio: clamp01(
			weighted(
				existingProfile.musicVolumeRatio,
				newProfile.musicVolumeRatio,
				newProfile.musicVolumeRatio,
			),
		),
		musicStartOffsetS: clampNonNegativeSeconds(
			weighted(
				existingProfile.musicStartOffsetS,
				newProfile.musicStartOffsetS,
				newProfile.musicStartOffsetS ?? 0,
			),
		),
	};
}

export function buildCreatorProfileFromReferenceEdit({
	rawDurationS,
	referenceEditAnalysis,
	assetName,
	musicVolumeRatio,
	musicStartOffsetS,
}: {
	rawDurationS: number;
	referenceEditAnalysis: ReferenceEditAnalysis;
	assetName: string | null;
	musicVolumeRatio?: number | null;
	musicStartOffsetS?: number | null;
}): CreatorStyleProfile {
	const base = buildCreatorProfileFromDurations({
		rawDurationS,
		finishedDurationS: referenceEditAnalysis.duration_ms / 1000,
		assetName,
	});
	const finishedMinutes = Math.max(
		referenceEditAnalysis.duration_ms / 60_000,
		0.01,
	);
	const cutDensityPerMinute =
		referenceEditAnalysis.cut_count > 0
			? referenceEditAnalysis.cut_count / finishedMinutes
			: null;
	const editorialSignals = buildEditorialSignalsFromReference({
		words: referenceEditAnalysis.caption_ocr.words.map((word) => word.text),
	});

	return {
		...base,
		targetDurationS: round2(referenceEditAnalysis.duration_ms / 1000),
		referenceCutCount: referenceEditAnalysis.cut_count,
		averageCutMs: referenceEditAnalysis.average_cut_ms,
		cutDensityPerMinute:
			cutDensityPerMinute === null ? null : round2(cutDensityPerMinute),
		editorialKeepKeywords: editorialSignals.keepKeywords,
		editorialHookKeywords: editorialSignals.hookKeywords,
		editorialPayoffKeywords: editorialSignals.payoffKeywords,
		editorialAvoidKeywords: DEFAULT_CREATOR_PROFILE.editorialAvoidKeywords,
		captionStyleId: referenceEditAnalysis.caption_style.style_id,
		captionRevealPreset: "word-by-word",
		maxWordsPerCaption: 1,
		minCaptionDisplayMs: 160,
		titleFontSize: DEFAULT_CREATOR_PROFILE.titleFontSize,
		voiceGainDb: Math.max(
			-12,
			Math.min(18, referenceEditAnalysis.audio_mix.voice_gain_db),
		),
		musicVolumeRatio: clamp01(
			musicVolumeRatio ?? referenceEditAnalysis.audio_mix.music_volume,
		),
		musicStartOffsetS: clampNonNegativeSeconds(
			musicStartOffsetS ??
				referenceEditAnalysis.audio_mix.music_start_offset_s ??
				DEFAULT_CREATOR_PROFILE.musicStartOffsetS ??
				0,
		),
	};
}

export function resolveCreatorProfileTargetDurationMs({
	profile,
	rawDurationMs,
	keepRatioOverride = null,
}: {
	profile: typeof DEFAULT_CREATOR_PROFILE & Partial<CreatorStyleProfile>;
	rawDurationMs: number;
	keepRatioOverride?: number | null;
}): number {
	const targetKeepRatio = keepRatioOverride ?? profile.targetKeepRatio;
	const ratioTargetMs = Math.round(
		rawDurationMs * (targetKeepRatio > 0 ? targetKeepRatio : 0.3),
	);
	if (keepRatioOverride !== null) return ratioTargetMs;

	const learnedRawMs =
		typeof profile.rawDurationS === "number" && profile.rawDurationS > 0
			? profile.rawDurationS * 1000
			: null;
	const learnedTargetMs =
		typeof profile.targetDurationS === "number" && profile.targetDurationS > 0
			? profile.targetDurationS * 1000
			: null;
	if (!learnedRawMs || !learnedTargetMs || rawDurationMs <= 0) {
		return ratioTargetMs;
	}

	const rawSimilarity = rawDurationMs / learnedRawMs;
	if (rawSimilarity >= 0.6 && rawSimilarity <= 1.6) {
		return Math.round(
			Math.max(5_000, Math.min(rawDurationMs, learnedTargetMs)),
		);
	}

	return ratioTargetMs;
}

/**
 * Describe a creator profile in plain English for display in the chat panel.
 */
export function describeCreatorProfile(profile: CreatorStyleProfile): string {
	const keepPct = Math.round(profile.targetKeepRatio * 100);
	const lines: string[] = [
		`Keep ~${keepPct}% of raw footage (${formatDuration(profile.rawDurationS)} raw → ~${formatDuration(profile.finishedDurationS)} finished)`,
		profile.cutDensityPerMinute
			? `Pacing: ~${profile.cutDensityPerMinute.toFixed(1)} cuts/min`
			: null,
		profile.editorialKeepKeywords?.length
			? `Editorial themes: ${profile.editorialKeepKeywords.slice(0, 8).join(", ")}`
			: null,
		`Captions: ${profile.captionStyleId}${profile.captionRevealPreset ? ` (${profile.captionRevealPreset})` : ""}`,
		`Title overlay: ${profile.titleEnabled ? profile.titlePosition : "off"}`,
		`Dialogue: ${(profile.voiceGainDb ?? 0) >= 0 ? "+" : ""}${(profile.voiceGainDb ?? 0).toFixed(1)} dB`,
		`Music: ${Math.round(profile.musicVolumeRatio * 100)}% volume${profile.musicStartOffsetS ? `, starts +${profile.musicStartOffsetS.toFixed(1)}s` : ""}${profile.musicLoop ? ", looped" : ""}`,
	].filter((line): line is string => Boolean(line));
	return lines.join(" · ");
}

function formatDuration(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.round(seconds % 60);
	return m > 0 ? `${m}m${s > 0 ? `${s}s` : ""}` : `${s}s`;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_CREATOR_PROFILE.musicVolumeRatio;
	return Math.max(0, Math.min(1, value));
}

function clampNonNegativeSeconds(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(120, Math.round(value * 100) / 100));
}

const EDITORIAL_STOPWORDS = new Set([
	"a",
	"about",
	"again",
	"all",
	"already",
	"also",
	"and",
	"are",
	"because",
	"been",
	"being",
	"but",
	"can",
	"come",
	"did",
	"does",
	"doing",
	"for",
	"from",
	"going",
	"got",
	"had",
	"has",
	"have",
	"here",
	"into",
	"just",
	"like",
	"more",
	"not",
	"now",
	"off",
	"one",
	"only",
	"out",
	"over",
	"people",
	"right",
	"said",
	"same",
	"that",
	"the",
	"their",
	"them",
	"then",
	"there",
	"they",
	"this",
	"those",
	"through",
	"to",
	"was",
	"were",
	"what",
	"when",
	"with",
	"without",
	"you",
	"your",
]);

function buildEditorialSignalsFromReference({ words }: { words: string[] }): {
	keepKeywords: string[];
	hookKeywords: string[];
	payoffKeywords: string[];
} {
	const tokens = words.flatMap((word) => tokenizeEditorialWord(word));
	if (tokens.length === 0) {
		return { keepKeywords: [], hookKeywords: [], payoffKeywords: [] };
	}

	const counts = new Map<string, { count: number; firstIndex: number }>();
	tokens.forEach((token, index) => {
		const entry = counts.get(token);
		if (entry) {
			entry.count += 1;
		} else {
			counts.set(token, { count: 1, firstIndex: index });
		}
	});

	const keepKeywords = [...counts.entries()]
		.sort((left, right) => {
			const countDelta = right[1].count - left[1].count;
			if (countDelta !== 0) return countDelta;
			return left[1].firstIndex - right[1].firstIndex;
		})
		.map(([token]) => token)
		.slice(0, 24);

	const hookKeywords = uniqueEditorialTokens(tokens.slice(0, 32)).slice(0, 10);
	const payoffKeywords = uniqueEditorialTokens(tokens.slice(-32)).slice(0, 10);

	return { keepKeywords, hookKeywords, payoffKeywords };
}

function tokenizeEditorialWord(word: string): string[] {
	return word
		.toLowerCase()
		.replace(/[^a-z0-9\s']/g, " ")
		.split(/\s+/)
		.map((token) => token.replace(/^'+|'+$/g, ""))
		.filter(
			(token) =>
				token.length >= 4 &&
				!EDITORIAL_STOPWORDS.has(token) &&
				!/^\d+$/.test(token),
		);
}

function uniqueEditorialTokens(tokens: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const token of tokens) {
		if (seen.has(token)) continue;
		seen.add(token);
		out.push(token);
	}
	return out;
}

function mergeKeywords(
	left: string[] | null | undefined,
	right: string[] | null | undefined,
	limit: number,
): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const entry of [...(right ?? []), ...(left ?? [])]) {
		const keyword = entry
			.toLowerCase()
			.replace(/[^a-z0-9\s'-]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (!keyword || seen.has(keyword)) continue;
		seen.add(keyword);
		out.push(keyword);
		if (out.length >= limit) break;
	}
	return out;
}
