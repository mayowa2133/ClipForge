#!/usr/bin/env npx ts-node
/**
 * ClipForge autonomous raw-only pipeline smoke test.
 *
 * This intentionally does NOT read the finished reference video or reference
 * transcript. It uses:
 *   - raw footage
 *   - background music
 *   - cached raw transcript / raw transcription
 *   - a learned creator profile distilled from prior references
 *
 * The goal is to prove the production path can create a TikTok-style edit
 * from raw assets without using the reference as an oracle for cut matching.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { buildCaptions } from "./match-cuts";
import { probeMedia } from "./probe";
import { render } from "./render";
import {
	DEFAULT_CONFIG,
	type CaptionEvent,
	type KeptSegment,
	type PipelineConfig,
	type SilenceRegion,
	type TranscriptWord,
} from "./types";
import { parseWhisperJson, transcribe } from "./transcribe";

interface LearnedCreatorProfile {
	learnedFrom: string;
	targetDurationS: number;
	musicVolume: number;
	musicStartOffsetS: number;
	targetCutDensityPerMinute: number;
	voiceGainDb: number;
	editorialKeepKeywords: string[];
	editorialHookKeywords: string[];
	editorialPayoffKeywords: string[];
	editorialAvoidKeywords: string[];
	maxWordsPerCaption: number;
	minCaptionDisplayMs: number;
}

interface AutonomousQualityReport {
	referenceMediaRead: false;
	rawPath: string;
	musicPath: string;
	musicStartOffsetS: number;
	voiceGainDb: number;
	outputPath: string;
	targetDurationS: number;
	actualDurationS: number;
	durationDeltaS: number;
	segmentCount: number;
	cutCount: number;
	targetCutDensityPerMinute: number;
	actualCutDensityPerMinute: number;
	captionCount: number;
	readiness: "ready-for-review" | "needs-review" | "blocked";
	warnings: string[];
}

const SMOKE_DIR = resolve(__dirname, "..");
const BUNDLED_CODEX_PYTHON =
	"/Users/mayowaadesanya/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const PYTHON_BIN =
	process.env.CLIPFORGE_PYTHON_BIN ??
	(existsSync(BUNDLED_CODEX_PYTHON) ? BUNDLED_CODEX_PYTHON : "python3");
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const UNIVERSAL_EDITORIAL_AVOID = [
	"um",
	"uh",
	"crap",
	"fuck",
	"fucking",
	"shit",
];

const DEFAULT_LEARNED_PROFILE: LearnedCreatorProfile = {
	learnedFrom: "prior-reference-profile",
	targetDurationS: 36.06,
	musicVolume: 0.6,
	musicStartOffsetS: 4.0,
	targetCutDensityPerMinute: 26.6,
	voiceGainDb: 11,
	editorialKeepKeywords: [
		"sign",
		"prove",
		"wrong",
		"talking",
		"becoming",
		"undeniable",
		"work",
		"speak",
		"results",
		"shock",
		"name",
		"weight",
		"chasing",
		"reach",
		"coming",
		"opportunities",
		"move",
		"take",
		"losing",
		"learning",
		"pushing",
		"forward",
		"waiting",
		"start",
	],
	editorialHookKeywords: ["sign", "here", "right", "now"],
	editorialPayoffKeywords: [
		"losing",
		"learning",
		"pushing",
		"forward",
		"waiting",
		"becoming",
	],
	editorialAvoidKeywords: ["fuck", "fucking", "dream", "outgrow"],
	maxWordsPerCaption: 1,
	minCaptionDisplayMs: 160,
};

function readNumberEnv(name: string): number | null {
	const raw = process.env[name];
	if (!raw) return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown, fallback: string[]): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: fallback;
}

function loadLearnedProfile(): LearnedCreatorProfile {
	const profilePath = process.env.CLIPFORGE_CREATOR_PROFILE_JSON;
	const diskProfile =
		profilePath && existsSync(profilePath)
			? (JSON.parse(
					readFileSync(profilePath, "utf-8"),
				) as Partial<LearnedCreatorProfile>)
			: {};
	const merged: LearnedCreatorProfile = {
		...DEFAULT_LEARNED_PROFILE,
		...diskProfile,
		editorialKeepKeywords: readStringArray(
			diskProfile.editorialKeepKeywords,
			DEFAULT_LEARNED_PROFILE.editorialKeepKeywords,
		),
		editorialHookKeywords: readStringArray(
			diskProfile.editorialHookKeywords,
			DEFAULT_LEARNED_PROFILE.editorialHookKeywords,
		),
		editorialPayoffKeywords: readStringArray(
			diskProfile.editorialPayoffKeywords,
			DEFAULT_LEARNED_PROFILE.editorialPayoffKeywords,
		),
		editorialAvoidKeywords: readStringArray(
			diskProfile.editorialAvoidKeywords,
			DEFAULT_LEARNED_PROFILE.editorialAvoidKeywords,
		),
	};
	return {
		...merged,
		targetDurationS:
			readNumberEnv("CLIPFORGE_TARGET_DURATION_S") ?? merged.targetDurationS,
		musicVolume: readNumberEnv("CLIPFORGE_MUSIC_VOLUME") ?? merged.musicVolume,
		musicStartOffsetS:
			readNumberEnv("CLIPFORGE_MUSIC_START_OFFSET_S") ??
			merged.musicStartOffsetS,
		targetCutDensityPerMinute:
			readNumberEnv("CLIPFORGE_TARGET_CUT_DENSITY_PER_MINUTE") ??
			merged.targetCutDensityPerMinute,
		voiceGainDb: readNumberEnv("CLIPFORGE_VOICE_GAIN_DB") ?? merged.voiceGainDb,
	};
}

const learnedProfile = loadLearnedProfile();

const config: PipelineConfig = {
	...DEFAULT_CONFIG,
	raw_path: resolve(
		process.env.CLIPFORGE_RAW_PATH ?? join(SMOKE_DIR, "RAW-footage.MOV"),
	),
	music_path: resolve(
		process.env.CLIPFORGE_MUSIC_PATH ?? join(SMOKE_DIR, "MUSIC-background.mp3"),
	),
	output_path: resolve(
		process.env.CLIPFORGE_OUTPUT_PATH ??
			join(SMOKE_DIR, "OUTPUT-autonomous-rawonly.mp4"),
	),
	reference_path: "",
	speech_volume: 10 ** (learnedProfile.voiceGainDb / 20),
	music_volume: learnedProfile.musicVolume,
	music_start_offset_s: learnedProfile.musicStartOffsetS,
	target_duration_s: learnedProfile.targetDurationS,
};

const artifactPrefix =
	process.env.CLIPFORGE_ARTIFACT_PREFIX ??
	basename(config.output_path).replace(/\.[^.]+$/, "");

function artifactPath(suffix: string): string {
	return join(SMOKE_DIR, `${artifactPrefix}-${suffix}`);
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function normalizeWord(word: string): string {
	return word.trim().replace(/^\W+|\W+$/g, "");
}

function normalizePhrase(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function phraseTokens(text: string): string[] {
	return normalizePhrase(text).split(/\s+/).filter(Boolean);
}

function phraseScore(text: string): number {
	const normalized = normalizePhrase(text);
	let score = phraseTokens(text).length * 0.1;
	for (const keyword of learnedProfile.editorialKeepKeywords) {
		if (normalized.includes(keyword)) score += 1;
	}
	for (const keyword of learnedProfile.editorialHookKeywords) {
		if (normalized.includes(keyword)) score += 0.5;
	}
	for (const keyword of learnedProfile.editorialPayoffKeywords) {
		if (normalized.includes(keyword)) score += 0.75;
	}
	for (const keyword of learnedProfile.editorialAvoidKeywords) {
		if (normalized.includes(keyword)) score -= 3;
	}
	return score;
}

function hasAvoidKeyword(text: string): boolean {
	const normalized = normalizePhrase(text);
	return [
		...UNIVERSAL_EDITORIAL_AVOID,
		...learnedProfile.editorialAvoidKeywords,
	].some((keyword) => normalized.split(/\s+/).includes(keyword));
}

function removeAdjacentRepeatedLeadIns(
	ranges: Array<{ start_s: number; end_s: number; text: string }>,
): Array<{ start_s: number; end_s: number; text: string }> {
	const kept: Array<{ start_s: number; end_s: number; text: string }> = [];
	for (const range of ranges) {
		const previous = kept[kept.length - 1];
		if (previous) {
			if (normalizePhrase(previous.text) === normalizePhrase(range.text)) {
				kept[kept.length - 1] = range;
				continue;
			}
			const previousTokens = phraseTokens(previous.text);
			const currentTokens = phraseTokens(range.text);
			const previousPhrase = previousTokens.join(" ");
			const currentPhrase = currentTokens.join(" ");
			if (currentTokens.length >= 4 && previousPhrase.endsWith(currentPhrase)) {
				continue;
			}
			if (
				previousTokens.length >= 4 &&
				currentPhrase.endsWith(previousPhrase)
			) {
				kept[kept.length - 1] = range;
				continue;
			}
			const sharedLeadIn =
				previousTokens.length >= 4 &&
				currentTokens.length >= 4 &&
				previousTokens.slice(0, 4).join(" ") ===
					currentTokens.slice(0, 4).join(" ");
			if (sharedLeadIn && range.start_s - previous.end_s <= 8) {
				if (phraseScore(range.text) >= phraseScore(previous.text)) {
					kept[kept.length - 1] = range;
				}
				continue;
			}
		}
		kept.push(range);
	}
	return kept;
}

function trimRepeatedBoundaryWords(
	ranges: Array<{ start_s: number; end_s: number; text: string }>,
	rawWords: TranscriptWord[],
): Array<{ start_s: number; end_s: number; text: string }> {
	const trimmed = ranges.map((range) => ({ ...range }));

	for (let index = 1; index < trimmed.length; index++) {
		const previous = trimmed[index - 1];
		const current = trimmed[index];
		if (!previous || !current) continue;
		const bridgingWord = rawWords.find(
			(word) =>
				word.start_s < previous.end_s &&
				word.end_s > current.start_s &&
				normalizeWord(word.word).length >= 2,
		);
		if (bridgingWord && bridgingWord.start_s - previous.start_s >= 0.25) {
			previous.end_s = Math.max(
				previous.start_s + 0.25,
				bridgingWord.start_s - 0.025,
			);
			continue;
		}
		const previousWords = rawWords.filter(
			(word) =>
				word.start_s >= previous.start_s - 0.05 &&
				word.end_s <= previous.end_s + 0.05,
		);
		const currentWords = rawWords.filter(
			(word) =>
				word.start_s >= current.start_s - 0.05 &&
				word.end_s <= current.end_s + 0.05,
		);
		const maxOverlap = Math.min(4, previousWords.length, currentWords.length);
		let overlap = 0;

		for (let size = maxOverlap; size >= 1; size--) {
			const previousSuffix = previousWords
				.slice(-size)
				.map((word) => normalizeWord(word.word).toLowerCase());
			const currentPrefix = currentWords
				.slice(0, size)
				.map((word) => normalizeWord(word.word).toLowerCase());
			if (previousSuffix.join(" ") === currentPrefix.join(" ")) {
				overlap = size;
				break;
			}
		}

		if (overlap === 0) continue;
		const duplicateStart =
			previousWords[previousWords.length - overlap]?.start_s;
		if (
			duplicateStart === undefined ||
			duplicateStart - previous.start_s < 0.25
		)
			continue;

		previous.end_s = Math.max(previous.start_s + 0.25, duplicateStart - 0.025);
		previous.text = previousWords
			.slice(0, -overlap)
			.map((word) => word.word.trim())
			.join(" ");
	}

	return trimmed;
}

function selectEditorialRangesForDuration({
	ranges,
	targetDurationS,
}: {
	ranges: Array<{ start_s: number; end_s: number; text: string }>;
	targetDurationS: number;
}): Array<{ start_s: number; end_s: number; text: string }> {
	const totalDurationS = ranges.reduce(
		(sum, range) => sum + Math.max(0, range.end_s - range.start_s),
		0,
	);
	const overageS = totalDurationS - targetDurationS;
	if (overageS <= 0.25) return ranges;

	const protectedKeywords = [
		...learnedProfile.editorialHookKeywords,
		...learnedProfile.editorialPayoffKeywords,
	].map((keyword) => keyword.toLowerCase());
	const groups: Array<{
		indices: number[];
		durationS: number;
		text: string;
	}> = [];
	let currentGroup: (typeof groups)[number] | null = null;
	for (const [index, range] of ranges.entries()) {
		const startsDiscourseReset =
			/^(but|however|anyway|basically|actually)\b/i.test(range.text.trim());
		if (
			currentGroup &&
			startsDiscourseReset &&
			/[.!?]["']?$/.test(range.text.trim())
		) {
			groups.push(currentGroup);
			currentGroup = null;
		}
		currentGroup ??= { indices: [], durationS: 0, text: "" };
		currentGroup.indices.push(index);
		currentGroup.durationS += Math.max(0, range.end_s - range.start_s);
		currentGroup.text = `${currentGroup.text} ${range.text}`.trim();
		if (/[.!?]["']?$/.test(range.text.trim())) {
			groups.push(currentGroup);
			currentGroup = null;
		}
	}
	if (currentGroup) groups.push(currentGroup);

	const candidates = groups
		.map((group, groupIndex) => ({
			...group,
			groupIndex,
			score: phraseScore(group.text),
			normalized: normalizePhrase(group.text),
		}))
		.filter(
			(candidate) =>
				candidate.groupIndex > 0 &&
				candidate.groupIndex < groups.length - 1 &&
				candidate.score / Math.max(0.25, candidate.durationS) < 0.55 &&
				!protectedKeywords.some((keyword) =>
					candidate.normalized.split(/\s+/).includes(keyword),
				),
		)
		.sort(
			(left, right) =>
				left.score / Math.max(0.25, left.durationS) -
					right.score / Math.max(0.25, right.durationS) ||
				left.groupIndex - right.groupIndex,
		);

	const removalBudgetS = overageS + Math.max(1.5, targetDurationS * 0.02);
	const removed = new Set<number>();
	let removedDurationS = 0;
	for (const candidate of candidates) {
		if (removedDurationS + candidate.durationS > removalBudgetS) continue;
		for (const index of candidate.indices) removed.add(index);
		removedDurationS += candidate.durationS;
		if (removedDurationS >= overageS - 0.35) break;
	}

	return ranges.filter((_, index) => !removed.has(index));
}

function detectRmsSilence({
	filePath,
	sampleRate = 16000,
	windowMs = 50,
	minSilenceS = 0.35,
}: {
	filePath: string;
	sampleRate?: number;
	windowMs?: number;
	minSilenceS?: number;
}): { regions: SilenceRegion[]; thresholdDb: number } {
	const pcm = execSync(
		`${FFMPEG} -v error -i "${filePath}" -ac 1 -ar ${sampleRate} -f f32le -`,
		{ encoding: "buffer", maxBuffer: 96 * 1024 * 1024 },
	);
	const samples = new Float32Array(
		pcm.buffer,
		pcm.byteOffset,
		Math.floor(pcm.byteLength / Float32Array.BYTES_PER_ELEMENT),
	);
	const windowSize = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
	const windows: Array<{ start_s: number; end_s: number; db: number }> = [];

	for (let start = 0; start < samples.length; start += windowSize) {
		const end = Math.min(samples.length, start + windowSize);
		let sumSquares = 0;
		for (let index = start; index < end; index++) {
			const sample = samples[index] ?? 0;
			sumSquares += sample * sample;
		}
		const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
		const db = 20 * Math.log10(Math.max(rms, 1e-8));
		windows.push({
			start_s: start / sampleRate,
			end_s: end / sampleRate,
			db,
		});
	}

	const sortedDb = windows
		.map((window) => window.db)
		.sort((left, right) => left - right);
	const percentile = (ratio: number) =>
		sortedDb[
			Math.min(
				sortedDb.length - 1,
				Math.max(0, Math.floor(sortedDb.length * ratio)),
			)
		] ?? -60;
	const low = percentile(0.2);
	const high = percentile(0.85);
	const thresholdDb = Math.min(-18, Math.max(-55, low + (high - low) * 0.34));
	const silenceRegions: SilenceRegion[] = [];
	let silenceStart: number | null = null;

	for (const window of windows) {
		if (window.db <= thresholdDb) {
			silenceStart ??= window.start_s;
			continue;
		}
		if (silenceStart !== null) {
			const duration = window.start_s - silenceStart;
			if (duration >= minSilenceS) {
				silenceRegions.push({
					start_s: round3(silenceStart),
					end_s: round3(window.start_s),
					duration_s: round3(duration),
				});
			}
			silenceStart = null;
		}
	}
	if (silenceStart !== null) {
		const end = samples.length / sampleRate;
		const duration = end - silenceStart;
		if (duration >= minSilenceS) {
			silenceRegions.push({
				start_s: round3(silenceStart),
				end_s: round3(end),
				duration_s: round3(duration),
			});
		}
	}

	console.log(`  RMS silence threshold: ${thresholdDb.toFixed(1)} dBFS`);
	return { regions: silenceRegions, thresholdDb };
}

function buildSpeechSegmentsFromWords({
	rawWords,
	rawDurationS,
	maxGapS = 0.72,
	minSegmentS = 0.45,
	padBeforeS = 0.02,
	padAfterS = 0.02,
}: {
	rawWords: TranscriptWord[];
	rawDurationS: number;
	maxGapS?: number;
	minSegmentS?: number;
	padBeforeS?: number;
	padAfterS?: number;
}): KeptSegment[] {
	const words = rawWords
		.filter((word) => normalizeWord(word.word).length > 0)
		.sort((left, right) => left.start_s - right.start_s);
	if (words.length === 0) return [];
	const firstWord = words[0];
	if (!firstWord) return [];

	const ranges: Array<{ start_s: number; end_s: number; text: string }> = [];
	let start = firstWord.start_s;
	let end = firstWord.end_s;
	let segmentWords: TranscriptWord[] = [firstWord];

	for (const word of words.slice(1)) {
		const gap = word.start_s - end;
		if (gap > maxGapS) {
			if (end - start >= minSegmentS) {
				ranges.push({
					start_s: Math.max(0, start - padBeforeS),
					end_s: Math.min(rawDurationS, end + padAfterS),
					text: segmentWords
						.map((candidate) => candidate.word.trim())
						.join(" "),
				});
			}
			start = word.start_s;
			segmentWords = [];
		}
		segmentWords.push(word);
		end = Math.max(end, word.end_s);
	}

	if (end - start >= minSegmentS) {
		ranges.push({
			start_s: Math.max(0, start - padBeforeS),
			end_s: Math.min(rawDurationS, end + padAfterS),
			text: segmentWords.map((candidate) => candidate.word.trim()).join(" "),
		});
	}

	let outCursor = 0;
	const seenPhrases = new Set<string>();
	const filteredRanges = ranges.filter((range) => {
		const normalized = normalizePhrase(range.text);
		if (!normalized) return false;
		if (hasAvoidKeyword(normalized)) return false;
		if (seenPhrases.has(normalized)) return false;
		seenPhrases.add(normalized);
		return true;
	});

	return removeAdjacentRepeatedLeadIns(filteredRanges).map((range, index) => {
		const duration = Math.max(0, range.end_s - range.start_s);
		const segment: KeptSegment = {
			index,
			src_start_s: round3(range.start_s),
			src_end_s: round3(range.end_s),
			duration_s: round3(duration),
			out_start_s: round3(outCursor),
		};
		outCursor += duration;
		return segment;
	});
}

function buildSpeechSegmentsFromSilence({
	rawWords,
	silenceRegions,
	rawDurationS,
	targetDurationS,
	wordBoundaryPadS,
	minSegmentS = 0.45,
	maxRefineGapS = 0.72,
}: {
	rawWords: TranscriptWord[];
	silenceRegions: SilenceRegion[];
	rawDurationS: number;
	targetDurationS: number;
	wordBoundaryPadS: number;
	minSegmentS?: number;
	maxRefineGapS?: number;
}): KeptSegment[] {
	if (silenceRegions.length === 0) {
		return buildSpeechSegmentsFromWords({ rawWords, rawDurationS });
	}

	const ranges: Array<{ start_s: number; end_s: number; text: string }> = [];
	const pushWordGroups = (
		words: TranscriptWord[],
		speechStartS: number,
		speechEndS: number,
	) => {
		const firstWord = words[0];
		if (!firstWord) return;
		let group: TranscriptWord[] = [firstWord];
		for (const word of words.slice(1)) {
			const previous = group.at(-1);
			if (!previous) {
				group = [word];
				continue;
			}
			if (word.start_s - previous.end_s > maxRefineGapS) {
				pushGroup(group, speechStartS, speechEndS);
				group = [];
			}
			group.push(word);
		}
		pushGroup(group, speechStartS, speechEndS);
	};
	const pushGroup = (
		words: TranscriptWord[],
		speechStartS: number,
		speechEndS: number,
	) => {
		const first = words[0];
		const last = words[words.length - 1];
		if (!first || !last) return;
		const audioPadS = 0.12;
		// RMS boundaries are authoritative here. Full-video Whisper frequently
		// stretches a word across the following pause, so clamping an audio island
		// back to word timestamps can clip the spoken attack or tail.
		const start = Math.max(
			0,
			speechStartS - audioPadS,
			first.start_s - wordBoundaryPadS,
		);
		const end = Math.min(
			rawDurationS,
			speechEndS + audioPadS,
			last.end_s + wordBoundaryPadS,
		);
		if (end - start < minSegmentS) return;
		ranges.push({
			start_s: start,
			end_s: end,
			text: words.map((word) => word.word.trim()).join(" "),
		});
	};
	let cursor = 0;
	const sortedSilence = [...silenceRegions].sort(
		(left, right) => left.start_s - right.start_s,
	);

	for (const silence of sortedSilence) {
		const speechStart = cursor;
		const speechEnd = Math.max(speechStart, silence.start_s);
		const words = rawWords.filter(
			(word) => word.end_s > speechStart && word.end_s <= speechEnd + 0.15,
		);
		if (speechEnd - speechStart >= minSegmentS && words.length > 0) {
			pushWordGroups(words, speechStart, speechEnd);
		}
		cursor = Math.max(cursor, silence.end_s);
	}

	const tailWords = rawWords.filter(
		(word) => word.end_s > cursor && word.end_s <= rawDurationS + 0.15,
	);
	if (rawDurationS - cursor >= minSegmentS && tailWords.length > 0) {
		pushWordGroups(tailWords, cursor, rawDurationS);
	}

	let outCursor = 0;
	const mergedRanges: Array<{ start_s: number; end_s: number; text: string }> =
		[];
	for (const range of ranges.sort(
		(left, right) => left.start_s - right.start_s,
	)) {
		const previous = mergedRanges[mergedRanges.length - 1];
		if (previous && range.start_s <= previous.end_s + 0.25) {
			previous.end_s = Math.max(previous.end_s, range.end_s);
			previous.text = `${previous.text} ${range.text}`.trim();
		} else {
			mergedRanges.push({ ...range });
		}
	}
	const seenPhrases = new Set<string>();
	const eligibleRanges = mergedRanges.filter((range) => {
		const normalized = normalizePhrase(range.text);
		if (!normalized) return false;
		if (hasAvoidKeyword(normalized)) return false;
		if (seenPhrases.has(normalized)) return false;
		seenPhrases.add(normalized);
		return true;
	});
	return selectEditorialRangesForDuration({
		ranges: trimRepeatedBoundaryWords(
			removeAdjacentRepeatedLeadIns(eligibleRanges),
			rawWords,
		),
		targetDurationS,
	}).map((range, index) => {
		const duration = Math.max(0, range.end_s - range.start_s);
		const segment: KeptSegment = {
			index,
			src_start_s: round3(range.start_s),
			src_end_s: round3(range.end_s),
			duration_s: round3(duration),
			out_start_s: round3(outCursor),
		};
		outCursor += duration;
		return segment;
	});
}

function scaleCaptions({
	captions,
	keptDurationS,
	targetDurationS,
}: {
	captions: CaptionEvent[];
	keptDurationS: number;
	targetDurationS: number;
}): CaptionEvent[] {
	const scale = keptDurationS > 0 ? targetDurationS / keptDurationS : 1;
	return captions.map((caption) => ({
		...caption,
		start_s: round3(caption.start_s * scale),
		end_s: Math.max(
			round3(
				caption.start_s * scale + learnedProfile.minCaptionDisplayMs / 1000,
			),
			round3(caption.end_s * scale),
		),
	}));
}

function transcribePostCutAudio({
	segments,
}: {
	segments: KeptSegment[];
}): TranscriptWord[] {
	const segmentSignature = segments
		.map((segment) => `${segment.src_start_s}:${segment.src_end_s}`)
		.join("|");
	const cachePath = artifactPath("postcut-transcript.json");
	if (existsSync(cachePath)) {
		const cached = JSON.parse(readFileSync(cachePath, "utf-8")) as {
			segmentSignature?: string;
			words?: TranscriptWord[];
		};
		if (
			cached.segmentSignature === segmentSignature &&
			Array.isArray(cached.words) &&
			cached.words.length > 0
		) {
			return cached.words;
		}
	}

	const postCutDir = join(SMOKE_DIR, `.${artifactPrefix}-postcut`);
	mkdirSync(postCutDir, { recursive: true });
	const wavPath = join(postCutDir, "postcut.wav");
	const filterPath = join(postCutDir, "concat.filter.txt");
	const filters: string[] = [];
	const labels: string[] = [];
	segments.forEach((segment, index) => {
		filters.push(
			`[0:a]atrim=start=${segment.src_start_s}:end=${segment.src_end_s},asetpts=PTS-STARTPTS[s${index}]`,
		);
		labels.push(`[s${index}]`);
	});
	filters.push(`${labels.join("")}concat=n=${segments.length}:v=0:a=1[out]`);
	writeFileSync(filterPath, filters.join(";"));
	execSync(
		`${FFMPEG} -y -v error -i "${config.raw_path}" -filter_complex_script "${filterPath}" -map "[out]" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`,
		{ stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 },
	);
	const words = transcribe(
		wavPath,
		config.whisper_model,
		config.whisper_language,
	);
	writeFileSync(
		cachePath,
		JSON.stringify({ segmentSignature, words }, null, 2),
	);
	return words;
}

function buildQualityReport({
	rawInfo,
	outInfo,
	segments,
	captions,
}: {
	rawInfo: ReturnType<typeof probeMedia>;
	outInfo: ReturnType<typeof probeMedia>;
	segments: KeptSegment[];
	captions: CaptionEvent[];
}): AutonomousQualityReport {
	const cutCount = Math.max(0, segments.length - 1);
	const actualCutDensityPerMinute =
		outInfo.duration_s > 0 ? cutCount / (outInfo.duration_s / 60) : 0;
	const durationDeltaS = Math.abs(
		outInfo.duration_s - learnedProfile.targetDurationS,
	);
	const warnings: string[] = [];

	if (outInfo.display_width !== 1080 || outInfo.display_height !== 1920) {
		warnings.push("Output is not 1080x1920 portrait.");
	}
	if (durationDeltaS > Math.max(2.5, learnedProfile.targetDurationS * 0.1)) {
		warnings.push("Output duration misses the learned target.");
	}
	if (captions.length < 20) {
		warnings.push("Caption count is too low for a TikTok-style speaking edit.");
	}
	if (segments.length < 8) {
		warnings.push("Segment count is too low for the learned jump-cut style.");
	}
	if (
		Math.abs(
			actualCutDensityPerMinute - learnedProfile.targetCutDensityPerMinute,
		) > Math.max(4, learnedProfile.targetCutDensityPerMinute * 0.45)
	) {
		warnings.push("Cut density misses the learned reference pacing.");
	}
	if (outInfo.duration_s >= rawInfo.duration_s * 0.5) {
		warnings.push("Autonomous edit did not compress the raw footage enough.");
	}

	return {
		referenceMediaRead: false,
		rawPath: config.raw_path,
		musicPath: config.music_path,
		musicStartOffsetS: learnedProfile.musicStartOffsetS,
		voiceGainDb: learnedProfile.voiceGainDb,
		outputPath: config.output_path,
		targetDurationS: learnedProfile.targetDurationS,
		actualDurationS: round3(outInfo.duration_s),
		durationDeltaS: round3(durationDeltaS),
		segmentCount: segments.length,
		cutCount,
		targetCutDensityPerMinute: learnedProfile.targetCutDensityPerMinute,
		actualCutDensityPerMinute: round3(actualCutDensityPerMinute),
		captionCount: captions.length,
		readiness:
			outInfo.duration_s <= 0
				? "blocked"
				: warnings.length === 0
					? "ready-for-review"
					: "needs-review",
		warnings,
	};
}

async function main() {
	const startTime = Date.now();
	console.log("=== ClipForge Autonomous Raw-Only Pipeline ===\n");
	console.log(`Learned profile: ${JSON.stringify(learnedProfile)}`);
	console.log("Reference media access: disabled\n");

	for (const [label, path] of [
		["Raw footage", config.raw_path],
		["Background music", config.music_path],
	] as const) {
		if (!existsSync(path)) {
			console.error(`ERROR: ${label} not found at ${path}`);
			process.exit(1);
		}
	}

	console.log("Step 1/6: Probing raw assets...");
	const rawInfo = probeMedia(config.raw_path);
	console.log(
		`  Raw: ${rawInfo.display_width}x${rawInfo.display_height} ${rawInfo.duration_s.toFixed(1)}s`,
	);
	console.log(`  Target: ${learnedProfile.targetDurationS.toFixed(1)}s\n`);

	console.log("Step 2/6: Loading raw transcript...");
	const rawWhisperPath =
		process.env.CLIPFORGE_RAW_TRANSCRIPT_JSON ??
		join(dirname(config.raw_path), ".whisper-tmp", "audio.json");
	const rawWords = existsSync(rawWhisperPath)
		? parseWhisperJson(JSON.parse(readFileSync(rawWhisperPath, "utf-8")))
		: transcribe(
				config.raw_path,
				config.whisper_model,
				config.whisper_language,
			);
	console.log(`  ${rawWords.length} raw words\n`);

	console.log("Step 3/6: Planning autonomous speech cuts...");
	const silencePath = artifactPath("silence.json");
	const silenceDetection = detectRmsSilence({
		filePath: config.raw_path,
		minSilenceS: config.silence_min_duration_s,
	});
	const silenceRegions = silenceDetection.regions;
	writeFileSync(silencePath, JSON.stringify(silenceRegions, null, 2));
	console.log(`  ${silenceRegions.length} audio silence regions`);
	const segments = buildSpeechSegmentsFromSilence({
		rawWords,
		silenceRegions,
		rawDurationS: rawInfo.duration_s,
		targetDurationS: learnedProfile.targetDurationS,
		wordBoundaryPadS: silenceDetection.thresholdDb > -35 ? 0.08 : 0.4,
	});
	const keptDurationS = segments.reduce(
		(sum, segment) => sum + segment.duration_s,
		0,
	);
	const segmentsPath = artifactPath("segments.json");
	writeFileSync(segmentsPath, JSON.stringify(segments, null, 2));
	console.log(`  ${segments.length} speech segments`);
	console.log(`  Kept speech: ${keptDurationS.toFixed(1)}s`);
	console.log(
		`  Pace normalization: ${(keptDurationS / learnedProfile.targetDurationS).toFixed(3)}x\n`,
	);

	for (const segment of segments) {
		const text = rawWords
			.filter(
				(word) =>
					word.start_s >= segment.src_start_s &&
					word.end_s <= segment.src_end_s,
			)
			.map((word) => word.word.trim())
			.join(" ");
		console.log(
			`  [${segment.src_start_s.toFixed(1)}-${segment.src_end_s.toFixed(1)}] "${text.slice(0, 72)}"`,
		);
	}

	console.log("\nStep 4/6: Building raw-only captions...");
	const captionWords =
		process.env.CLIPFORGE_PLAN_ONLY === "1"
			? rawWords
			: transcribePostCutAudio({ segments });
	const captionSourceDurationS =
		captionWords[captionWords.length - 1]?.end_s ?? keptDurationS;
	const captionSourceSegments =
		captionWords === rawWords
			? segments
			: [
					{
						index: 0,
						src_start_s: 0,
						src_end_s: captionSourceDurationS,
						duration_s: captionSourceDurationS,
						out_start_s: 0,
					},
				];
	const captions = scaleCaptions({
		captions: buildCaptions(captionWords, captionSourceSegments),
		keptDurationS: captionSourceDurationS,
		targetDurationS: learnedProfile.targetDurationS,
	});
	const captionsPath = artifactPath("captions.json");
	writeFileSync(captionsPath, JSON.stringify(captions, null, 2));
	console.log(`  ${captions.length} caption events`);
	console.log(
		`  Caption source: ${captionWords === rawWords ? "raw transcript (plan-only)" : "final-cut re-transcription"}\n`,
	);

	if (process.env.CLIPFORGE_PLAN_ONLY === "1") {
		console.log("Plan-only mode: skipping render and caption burn.");
		return;
	}
	if (process.env.CLIPFORGE_CAPTIONS_ONLY === "1") {
		console.log("Captions-only mode: skipping render and caption burn.");
		return;
	}

	console.log("Step 5/6: Rendering autonomous video...");
	const noCaptionsPath = artifactPath("no-captions.mp4");
	render({ ...config, output_path: noCaptionsPath }, segments);
	console.log(`  Base video: ${noCaptionsPath}\n`);

	console.log("Step 6/6: Burning captions...");
	const pythonCmd = [
		`"${PYTHON_BIN}"`,
		`"${join(__dirname, "burn-captions.py")}"`,
		`"${noCaptionsPath}"`,
		`"${captionsPath}"`,
		`"${config.output_path}"`,
	].join(" ");
	execSync(pythonCmd, {
		stdio: "inherit",
		timeout: 1_200_000,
	});

	const outInfo = probeMedia(config.output_path);
	const report = buildQualityReport({ rawInfo, outInfo, segments, captions });
	const reportPath = artifactPath("quality-report.json");
	writeFileSync(reportPath, JSON.stringify(report, null, 2));

	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log(`\n=== Autonomous pipeline complete in ${elapsed}s ===`);
	console.log(JSON.stringify(report, null, 2));
	console.log(`Report: ${reportPath}`);

	if (report.readiness !== "ready-for-review") {
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error("Autonomous pipeline error:", error);
	process.exit(1);
});
