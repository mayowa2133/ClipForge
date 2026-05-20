import type { AudioLibraryItem, LibraryMusicMood } from "@/types/library";
import type { CreativeBrief, CreativeBriefGoal, CreativeBriefTone } from "@/types/clipforge";

export interface MusicSelectionResult {
	track: AudioLibraryItem;
	score: number;
	reasons: string[];
}

/**
 * Mapping from creative brief goal/tone to preferred music moods.
 * Each entry is ordered by priority — the first match wins the mood bonus.
 */
const GOAL_TO_MOOD: Record<CreativeBriefGoal, LibraryMusicMood[]> = {
	"viral-tiktok": ["energetic", "upbeat"],
	vlog: ["clean", "upbeat"],
	"luxury-routine": ["luxury", "minimal"],
	"talking-head": ["minimal", "clean"],
	"product-highlight": ["upbeat", "clean"],
};

const TONE_TO_MOOD: Record<CreativeBriefTone, LibraryMusicMood[]> = {
	clean: ["clean"],
	bold: ["energetic", "upbeat"],
	luxury: ["luxury"],
	energetic: ["energetic", "upbeat"],
	minimal: ["minimal", "clean"],
};

/**
 * Ideal BPM ranges per goal — faster BPM for high-energy content,
 * slower BPM for talking-head and luxury content.
 */
const GOAL_TO_BPM_RANGE: Record<CreativeBriefGoal, { min: number; max: number }> = {
	"viral-tiktok": { min: 110, max: 140 },
	vlog: { min: 90, max: 120 },
	"luxury-routine": { min: 80, max: 100 },
	"talking-head": { min: 80, max: 100 },
	"product-highlight": { min: 100, max: 130 },
};

/**
 * Score a single music track against a creative brief.
 *
 * Scoring formula:
 *   mood match × 3.0  +  BPM fit × 2.0  +  tag overlap × 1.5
 *   + duration fit × 1.0
 *
 * Returns a score ≥ 0. Higher = better match.
 */
export function scoreMusicTrack({
	track,
	brief,
}: {
	track: AudioLibraryItem;
	brief: CreativeBrief;
}): MusicSelectionResult {
	let score = 0;
	const reasons: string[] = [];

	// --- Mood match (primary signal) ---
	const preferredMoods = [
		...GOAL_TO_MOOD[brief.goal],
		...TONE_TO_MOOD[brief.tone],
	];
	const uniquePreferred = [...new Set(preferredMoods)];
	const moodIndex = track.mood
		? uniquePreferred.indexOf(track.mood)
		: -1;
	if (moodIndex === 0) {
		score += 3.0;
		reasons.push(`Mood "${track.mood}" is the top match for ${brief.goal}.`);
	} else if (moodIndex > 0) {
		score += 2.0;
		reasons.push(`Mood "${track.mood}" fits the ${brief.tone} tone.`);
	} else if (track.mood) {
		score += 0.3;
		reasons.push(`Mood "${track.mood}" is a neutral fit.`);
	}

	// --- BPM fit ---
	const bpmRange = GOAL_TO_BPM_RANGE[brief.goal];
	const trackBpm = track.bpm ?? 0;
	if (trackBpm > 0) {
		if (trackBpm >= bpmRange.min && trackBpm <= bpmRange.max) {
			score += 2.0;
			reasons.push(`BPM ${trackBpm} is in the ideal range for ${brief.goal}.`);
		} else {
			const distance = trackBpm < bpmRange.min
				? bpmRange.min - trackBpm
				: trackBpm - bpmRange.max;
			const bpmPenalty = Math.min(1.5, distance / 30);
			score += Math.max(0, 2.0 - bpmPenalty);
			if (distance <= 15) {
				reasons.push(`BPM ${trackBpm} is close to the ideal range.`);
			}
		}
	}

	// --- Tag overlap ---
	const goalTags = brief.goal.split("-");
	const toneTags = [brief.tone];
	const searchTags = [...goalTags, ...toneTags];
	const trackTags = track.tags ?? [];
	const overlap = trackTags.filter((tag) =>
		searchTags.some((search) => tag.includes(search) || search.includes(tag)),
	).length;
	if (overlap > 0) {
		const tagScore = Math.min(1.5, overlap * 0.5);
		score += tagScore;
		reasons.push(`${overlap} tag${overlap > 1 ? "s" : ""} match the creative intent.`);
	}

	// --- Duration fit ---
	const trackDuration = track.duration ?? 0;
	const targetDuration = brief.durationTargetS ?? 24;
	if (trackDuration > 0 && targetDuration > 0) {
		// Loops are fine, but closer base duration is slightly better
		const ratio = trackDuration / targetDuration;
		if (ratio >= 0.15 && ratio <= 1.5) {
			score += 1.0;
			reasons.push("Duration works well for the target length.");
		} else {
			score += 0.4;
		}
	}

	return {
		track,
		score: Number(score.toFixed(3)),
		reasons,
	};
}

/**
 * Select the best music track from a library for a given creative brief.
 * Returns null if no tracks are available.
 */
export function selectBestMusicTrack({
	musicLibrary,
	brief,
}: {
	musicLibrary: AudioLibraryItem[];
	brief: CreativeBrief;
}): MusicSelectionResult | null {
	if (musicLibrary.length === 0) {
		return null;
	}

	const scored = musicLibrary.map((track) =>
		scoreMusicTrack({ track, brief }),
	);

	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return a.track.label.localeCompare(b.track.label);
	});

	return scored[0] ?? null;
}

/**
 * Select the top N music tracks, useful for showing alternatives.
 */
export function selectTopMusicTracks({
	musicLibrary,
	brief,
	count = 3,
}: {
	musicLibrary: AudioLibraryItem[];
	brief: CreativeBrief;
	count?: number;
}): MusicSelectionResult[] {
	if (musicLibrary.length === 0) {
		return [];
	}

	const scored = musicLibrary.map((track) =>
		scoreMusicTrack({ track, brief }),
	);

	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return a.track.label.localeCompare(b.track.label);
	});

	return scored.slice(0, count);
}
