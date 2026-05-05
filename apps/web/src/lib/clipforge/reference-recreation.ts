import {
	DEFAULT_BLEND_MODE,
	DEFAULT_OPACITY,
	DEFAULT_TRANSFORM,
} from "@/constants/timeline-constants";
import { DEFAULT_TEXT_ELEMENT } from "@/constants/text-constants";
import {
	DEFAULT_PROJECT_AUDIO_SETTINGS,
	buildDefaultProjectVersionPack,
} from "@/constants/project-constants";
import type { MediaAsset } from "@/types/assets";
import type {
	ClipMediaMetadata,
	MusicTrackAnalysis,
	ReferenceEditAnalysis,
	ReferenceRecreationPlan,
	SourceRecreationAnalysis,
} from "@/types/clipforge";
import type { TProject } from "@/types/project";
import type {
	AudioTrack,
	TextElement,
	TextTrack,
	TimelineTrack,
	VideoTrack,
} from "@/types/timeline";
import { generateUUID } from "@/utils/id";
import { createCaptionTextElements } from "./caption-studio";
import { ensureClipForgeProjectData } from "./project-data";

const DEFAULT_REFERENCE_CUT_MS = 1500;
const MIN_CUT_MS = 320;
const TARGET_CANVAS_WIDTH = 1080;
const TARGET_CANVAS_HEIGHT = 1920;

export interface BuildReferenceRecreationPlanInput {
	project: TProject;
	mediaAssets: MediaAsset[];
	referenceAssetId: string;
	sourceAssetIds: string[];
	musicAssetId?: string | null;
}

export interface BuildReferenceRecreationDraftResult {
	project: TProject;
	plan: ReferenceRecreationPlan;
	referenceEditAnalysis: ReferenceEditAnalysis;
	sourceAnalyses: Record<string, SourceRecreationAnalysis>;
	musicAnalysis: MusicTrackAnalysis | null;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function aspectRatioPreset({
	width,
	height,
}: {
	width?: number;
	height?: number;
}): ReferenceEditAnalysis["aspect_ratio"] {
	if (typeof width !== "number" || typeof height !== "number" || height <= 0) {
		return "unknown";
	}
	const ratio = width / height;
	if (ratio < 0.8) return "9:16";
	if (ratio > 1.3) return "16:9";
	return "1:1";
}

function normalizeCutPoints({
	durationMs,
	sceneCutsSeconds,
}: {
	durationMs: number;
	sceneCutsSeconds: number[];
}): number[] {
	const detected = sceneCutsSeconds
		.map((cut) => Math.round(cut * 1000))
		.filter((cut) => cut >= MIN_CUT_MS && cut <= durationMs - MIN_CUT_MS)
		.sort((left, right) => left - right);
	const deduped = detected.filter(
		(cut, index) => index === 0 || cut - (detected[index - 1] ?? 0) >= 260,
	);
	if (deduped.length > 0) {
		return deduped;
	}

	const generated: number[] = [];
	for (
		let cursor = DEFAULT_REFERENCE_CUT_MS;
		cursor < durationMs - MIN_CUT_MS;
		cursor += DEFAULT_REFERENCE_CUT_MS
	) {
		generated.push(cursor);
	}
	return generated;
}

export function buildReferenceEditAnalysis({
	asset,
	metadata,
}: {
	asset: MediaAsset;
	metadata: ClipMediaMetadata | null;
}): ReferenceEditAnalysis {
	const durationMs = Math.max(1, Math.round((asset.duration ?? 0) * 1000));
	const cutPoints = normalizeCutPoints({
		durationMs,
		sceneCutsSeconds: asset.visualAnalysis?.sceneCuts ?? [],
	});
	const averageCutMs =
		cutPoints.length > 0
			? Math.round(durationMs / (cutPoints.length + 1))
			: null;
	const warnings: string[] = [];
	if (!asset.visualAnalysis || asset.visualAnalysis.sceneCuts.length === 0) {
		warnings.push(
			"Reference cut boundaries are estimated because frame-difference analysis has not found stable scene cuts yet.",
		);
	}
	if (!metadata || metadata.words.length === 0) {
		warnings.push(
			"Reference caption text is not OCR-backed yet, so the recreation uses the detected social word-caption style with source transcript timing.",
		);
	}
	if (!asset.beatAnalysis) {
		warnings.push(
			"Reference beat analysis is unavailable, so music sync uses the imported track from the start of the edit.",
		);
	}

	return {
		analyzedAt: new Date().toISOString(),
		reference_asset_id: asset.id,
		duration_ms: durationMs,
		aspect_ratio: aspectRatioPreset({
			width: asset.width,
			height: asset.height,
		}),
		cut_points_ms: cutPoints,
		cut_count: cutPoints.length,
		average_cut_ms: averageCutMs,
		caption_style: {
			mode: "word",
			text_transform: "uppercase",
			style_id: "reference-word-pop",
			font: "Anton",
			size: 78,
			position: "bottom",
			fill_color: "#FFFFFF",
			outline_color: "#000000",
			outline: true,
			shadow: true,
			safe_zone: "lower-center",
		},
		audio_mix: {
			target_lufs: -11.5,
			true_peak_db: -1,
			voice_gain_db: 10,
			music_volume: 0.28,
			ducking_amount: 0.62,
			ducking_attack_ms: 70,
			ducking_release_ms: 260,
			soft_limiter: true,
		},
		color_profile: "bt709-social",
		warnings,
	};
}

function buildSpeechRangesFromWords({
	assetId,
	words,
}: {
	assetId: string;
	words: ClipMediaMetadata["words"];
}): SourceRecreationAnalysis["speech_ranges"] {
	const sortedWords = [...words]
		.filter(
			(word) => word.end_ms > word.start_ms && word.text.trim().length > 0,
		)
		.sort((left, right) => left.start_ms - right.start_ms);
	const ranges: SourceRecreationAnalysis["speech_ranges"] = [];
	let current: typeof sortedWords = [];

	const flush = () => {
		if (current.length === 0) return;
		const first = current[0];
		const last = current[current.length - 1];
		if (!first || !last) {
			current = [];
			return;
		}
		const startMs = first.start_ms;
		const endMs = last.end_ms;
		const durationS = Math.max(0.3, (endMs - startMs) / 1000);
		const speechDensity = current.length / durationS;
		ranges.push({
			range_id: `${assetId}:speech:${ranges.length + 1}`,
			start_ms: startMs,
			end_ms: endMs,
			word_count: current.length,
			speech_density: Number(speechDensity.toFixed(2)),
			confidence: Number(clamp(speechDensity / 3.2, 0.35, 0.98).toFixed(2)),
			reasons: [
				speechDensity >= 2
					? "Dense source speech suitable for jump cuts."
					: "Source speech is usable but may need manual tightening.",
			],
		});
		current = [];
	};

	for (const word of sortedWords) {
		const previous = current[current.length - 1];
		if (previous && word.start_ms - previous.end_ms > 650) {
			flush();
		}
		current.push(word);
	}
	flush();

	return ranges.filter((range) => range.end_ms - range.start_ms >= 300);
}

function buildFallbackSpeechRanges({
	asset,
	metadata,
	durationMs,
}: {
	asset: MediaAsset;
	metadata: ClipMediaMetadata | null;
	durationMs: number;
}): SourceRecreationAnalysis["speech_ranges"] {
	const transcriptRanges = (metadata?.segments ?? [])
		.filter((segment) => segment.end_ms > segment.start_ms)
		.map((segment, index) => ({
			range_id: `${asset.id}:segment:${index + 1}`,
			start_ms: segment.start_ms,
			end_ms: segment.end_ms,
			word_count: segment.text.trim().split(/\s+/).filter(Boolean).length,
			speech_density: 1,
			confidence: 0.55,
			reasons: [
				"Transcript segment used because word timings are unavailable.",
			],
		}));
	if (transcriptRanges.length > 0) {
		return transcriptRanges;
	}

	const windows = asset.visualAnalysis?.activityWindows ?? [];
	if (windows.length > 0) {
		return windows.map((window, index) => ({
			range_id: `${asset.id}:activity:${index + 1}`,
			start_ms: Math.round(window.startTime * 1000),
			end_ms: Math.round(window.endTime * 1000),
			word_count: 0,
			speech_density: 0,
			confidence: Number(clamp(window.score, 0.25, 0.7).toFixed(2)),
			reasons: [
				"Visual activity used because transcript metadata is unavailable.",
			],
		}));
	}

	const ranges: SourceRecreationAnalysis["speech_ranges"] = [];
	for (let cursor = 0; cursor < durationMs; cursor += 5000) {
		ranges.push({
			range_id: `${asset.id}:fallback:${ranges.length + 1}`,
			start_ms: cursor,
			end_ms: Math.min(durationMs, cursor + 5000),
			word_count: 0,
			speech_density: 0,
			confidence: 0.25,
			reasons: [
				"Timing fallback used because no transcript or activity analysis is available.",
			],
		});
	}
	return ranges;
}

function buildSpeechRangesFromSilenceRegions({
	assetId,
	durationMs,
	silenceRegions,
}: {
	assetId: string;
	durationMs: number;
	silenceRegions: ClipMediaMetadata["silenceRegions"];
}): SourceRecreationAnalysis["speech_ranges"] {
	const sortedSilences = [...silenceRegions]
		.filter((region) => region.end_ms > region.start_ms)
		.sort((left, right) => left.start_ms - right.start_ms);
	const ranges: SourceRecreationAnalysis["speech_ranges"] = [];
	let cursorMs = 0;

	for (const silence of sortedSilences) {
		const startMs = clamp(Math.round(silence.start_ms), 0, durationMs);
		const endMs = clamp(Math.round(silence.end_ms), startMs, durationMs);
		if (startMs - cursorMs >= 120) {
			const durationS = Math.max(0.2, (startMs - cursorMs) / 1000);
			const dense = durationS > 1.8;
			ranges.push({
				range_id: `${assetId}:vad:${ranges.length + 1}`,
				start_ms: cursorMs,
				end_ms: startMs,
				word_count: 0,
				speech_density: 0,
				confidence: dense ? 0.72 : 0.62,
				reasons: dense
					? ["Dense non-silent source region derived from dead-air analysis."]
					: ["Non-silent source region derived from dead-air analysis."],
			});
		}
		cursorMs = Math.max(cursorMs, endMs);
	}

	if (durationMs - cursorMs >= 120) {
		ranges.push({
			range_id: `${assetId}:vad:${ranges.length + 1}`,
			start_ms: cursorMs,
			end_ms: durationMs,
			word_count: 0,
			speech_density: 0,
			confidence: 0.62,
			reasons: ["Non-silent source region derived from dead-air analysis."],
		});
	}

	return ranges;
}

export function buildSourceRecreationAnalysis({
	asset,
	metadata,
}: {
	asset: MediaAsset;
	metadata: ClipMediaMetadata | null;
}): SourceRecreationAnalysis {
	const durationMs = Math.max(1, Math.round((asset.duration ?? 0) * 1000));
	const wordRanges = buildSpeechRangesFromWords({
		assetId: asset.id,
		words: metadata?.words ?? [],
	});
	const vadRanges =
		wordRanges.length === 0 && metadata?.silenceRegions.length
			? buildSpeechRangesFromSilenceRegions({
					assetId: asset.id,
					durationMs,
					silenceRegions: metadata.silenceRegions,
				})
			: [];
	const speechRanges =
		wordRanges.length > 0
			? wordRanges
			: vadRanges.length > 0
				? vadRanges
				: buildFallbackSpeechRanges({
						asset,
						metadata,
						durationMs,
					});
	const warnings: string[] = [];
	if (!metadata || (metadata.words.length === 0 && vadRanges.length === 0)) {
		warnings.push(
			"Source word timings are unavailable, so cut selection falls back to transcript segments or visual activity.",
		);
	}
	if (vadRanges.length > 0) {
		warnings.push(
			"Source transcript words are unavailable; recreation cut ranges use dead-air analysis.",
		);
	}
	if (!asset.visualAnalysis) {
		warnings.push(
			"Face-aware framing is approximated with center-crop because visual analysis is unavailable.",
		);
	}

	return {
		analyzedAt: new Date().toISOString(),
		asset_id: asset.id,
		duration_ms: durationMs,
		aspect_ratio: aspectRatioPreset({
			width: asset.width,
			height: asset.height,
		}),
		speech_ranges: speechRanges,
		dead_air_ranges: metadata?.silenceRegions ?? [],
		face_framing: "unknown",
		warnings,
	};
}

export function buildMusicTrackAnalysis({
	asset,
}: {
	asset: MediaAsset;
}): MusicTrackAnalysis {
	const rightsProfile =
		asset.rightsProfile === "universal"
			? "universal"
			: asset.musicSourceType === "user-imported"
				? "user-managed"
				: "unknown";
	return {
		analyzedAt: new Date().toISOString(),
		asset_id: asset.id,
		duration_ms: Math.max(1, Math.round((asset.duration ?? 0) * 1000)),
		bpm: asset.beatAnalysis?.bpm ?? null,
		recommended_volume: 0.28,
		loop_to_project_end: true,
		rights_profile: rightsProfile,
		warnings:
			rightsProfile === "unknown"
				? [
						"Music rights are unknown; treat this as user-managed until confirmed.",
					]
				: [],
	};
}

function buildTimelineBoundaries({
	durationMs,
	cutPointsMs,
}: {
	durationMs: number;
	cutPointsMs: number[];
}) {
	const boundaries = [
		0,
		...cutPointsMs.filter((point) => point > 0 && point < durationMs),
		durationMs,
	].sort((left, right) => left - right);
	return boundaries
		.slice(0, -1)
		.map((startMs, index) => ({
			start_ms: startMs,
			end_ms: boundaries[index + 1] ?? durationMs,
		}))
		.filter((range) => range.end_ms - range.start_ms >= MIN_CUT_MS);
}

function buildSourceRangesForPlan({
	sources,
	boundaries,
}: {
	sources: Array<{ asset: MediaAsset; analysis: SourceRecreationAnalysis }>;
	boundaries: Array<{ start_ms: number; end_ms: number }>;
}): ReferenceRecreationPlan["source_ranges"] {
	const targetDurationMs = boundaries.at(-1)?.end_ms ?? 0;
	const referenceDurations = boundaries
		.map((boundary) => boundary.end_ms - boundary.start_ms)
		.filter((duration) => duration >= MIN_CUT_MS);
	const sourceSpeechRanges = sources.flatMap(({ asset, analysis }) =>
		analysis.speech_ranges
			.filter((range) => range.end_ms - range.start_ms >= 120)
			.sort((left, right) => left.start_ms - right.start_ms)
			.map((range) => ({ asset, range })),
	);
	const ranges: ReferenceRecreationPlan["source_ranges"] = [];
	let timelineCursorMs = 0;
	let referenceDurationIndex = 0;

	for (const { asset, range } of sourceSpeechRanges) {
		if (timelineCursorMs >= targetDurationMs) break;
		const assetDurationMs = Math.max(
			1,
			Math.round((asset.duration ?? 0) * 1000),
		);
		let sourceCursorMs = clamp(range.start_ms, 0, assetDurationMs);
		const sourceRangeEndMs = clamp(
			range.end_ms,
			sourceCursorMs,
			assetDurationMs,
		);

		while (
			sourceRangeEndMs - sourceCursorMs >= 120 &&
			timelineCursorMs < targetDurationMs
		) {
			const requestedDurationMs =
				referenceDurations[
					referenceDurationIndex % referenceDurations.length
				] ?? DEFAULT_REFERENCE_CUT_MS;
			const targetRemainingMs = targetDurationMs - timelineCursorMs;
			const chunkDurationMs = Math.min(
				sourceRangeEndMs - sourceCursorMs,
				requestedDurationMs,
				targetRemainingMs,
			);
			if (chunkDurationMs < 120) break;
			const sourceStartMs = sourceCursorMs;
			const sourceEndMs = sourceStartMs + chunkDurationMs;

			ranges.push({
				range_id: `${asset.id}:recreate:${ranges.length + 1}`,
				source_asset_id: asset.id,
				source_asset_name: asset.name,
				source_start_ms: sourceStartMs,
				source_end_ms: sourceEndMs,
				timeline_start_ms: timelineCursorMs,
				target_duration_ms: chunkDurationMs,
				confidence: range.confidence,
				reasons: range.reasons,
			});

			timelineCursorMs += chunkDurationMs;
			sourceCursorMs = sourceEndMs;
			referenceDurationIndex += 1;
		}
	}

	return ranges;
}

export function buildReferenceRecreationPlan({
	project,
	mediaAssets,
	referenceAssetId,
	sourceAssetIds,
	musicAssetId = null,
}: BuildReferenceRecreationPlanInput): {
	plan: ReferenceRecreationPlan;
	referenceEditAnalysis: ReferenceEditAnalysis;
	sourceAnalyses: Record<string, SourceRecreationAnalysis>;
	musicAnalysis: MusicTrackAnalysis | null;
} {
	const clipforgeProject = ensureClipForgeProjectData({ project });
	const referenceAsset = mediaAssets.find(
		(asset) => asset.id === referenceAssetId && asset.type === "video",
	);
	if (!referenceAsset) {
		throw new Error("Reference recreation requires a video reference asset.");
	}
	const sourceAssets = sourceAssetIds
		.map((assetId) =>
			mediaAssets.find(
				(asset): asset is MediaAsset & { type: "video" } =>
					asset.id === assetId && asset.type === "video" && !asset.ephemeral,
			),
		)
		.filter((asset): asset is MediaAsset & { type: "video" } => Boolean(asset));
	if (sourceAssets.length === 0) {
		throw new Error(
			"Reference recreation requires at least one source video asset.",
		);
	}

	const referenceEditAnalysis =
		clipforgeProject.clipforge.referenceEditAnalysisByAssetId[
			referenceAsset.id
		] ??
		buildReferenceEditAnalysis({
			asset: referenceAsset,
			metadata:
				clipforgeProject.clipforge.mediaMetadataById[referenceAsset.id] ?? null,
		});
	const sourceAnalyses = Object.fromEntries(
		sourceAssets.map((asset) => [
			asset.id,
			clipforgeProject.clipforge.sourceRecreationAnalysisByAssetId[asset.id] ??
				buildSourceRecreationAnalysis({
					asset,
					metadata:
						clipforgeProject.clipforge.mediaMetadataById[asset.id] ?? null,
				}),
		]),
	);
	const musicAsset = musicAssetId
		? (mediaAssets.find(
				(asset) => asset.id === musicAssetId && asset.type === "audio",
			) ?? null)
		: null;
	const musicAnalysis = musicAsset
		? (clipforgeProject.clipforge.musicTrackAnalysisByAssetId[musicAsset.id] ??
			buildMusicTrackAnalysis({ asset: musicAsset }))
		: null;
	const boundaries = buildTimelineBoundaries({
		durationMs: referenceEditAnalysis.duration_ms,
		cutPointsMs: referenceEditAnalysis.cut_points_ms,
	});
	const sourceRanges = buildSourceRangesForPlan({
		sources: sourceAssets.map((asset) => ({
			asset,
			analysis: sourceAnalyses[asset.id] as SourceRecreationAnalysis,
		})),
		boundaries,
	});
	const warnings = [
		...referenceEditAnalysis.warnings,
		...Object.values(sourceAnalyses).flatMap((analysis) => analysis.warnings),
		...(musicAnalysis?.warnings ?? []),
	];
	if (sourceRanges.length < boundaries.length) {
		warnings.push(
			"Some reference cut slots could not be filled from source analysis and were omitted from the draft.",
		);
	}
	if (!musicAssetId) {
		warnings.push(
			"No imported music asset was selected, so the draft will keep only camera audio.",
		);
	}

	const plan: ReferenceRecreationPlan = {
		plan_id: generateUUID(),
		createdAt: new Date().toISOString(),
		reference_asset_id: referenceAsset.id,
		source_asset_ids: sourceAssets.map((asset) => asset.id),
		music_asset_id: musicAsset?.id ?? null,
		target_duration_ms: referenceEditAnalysis.duration_ms,
		cut_points_ms: referenceEditAnalysis.cut_points_ms,
		source_ranges: sourceRanges,
		caption_style: referenceEditAnalysis.caption_style,
		audio_mix: musicAnalysis
			? {
					...referenceEditAnalysis.audio_mix,
					music_volume: musicAnalysis.recommended_volume,
				}
			: referenceEditAnalysis.audio_mix,
		crop: {
			target_aspect_ratio: "9:16",
			canvas_width: TARGET_CANVAS_WIDTH,
			canvas_height: TARGET_CANVAS_HEIGHT,
			strategy: sourceAssets.some((asset) => asset.visualAnalysis)
				? "center-face-safe"
				: "center-crop",
		},
		warnings,
	};

	return {
		plan,
		referenceEditAnalysis,
		sourceAnalyses,
		musicAnalysis,
	};
}

function buildMainVideoTrack({
	existingTrack,
	mediaAssets,
	plan,
}: {
	existingTrack: VideoTrack | null;
	mediaAssets: MediaAsset[];
	plan: ReferenceRecreationPlan;
}): { track: VideoTrack; voiceElements: AudioTrack["elements"] } {
	const track: VideoTrack = {
		id: existingTrack?.id ?? generateUUID(),
		type: "video",
		name: existingTrack?.name ?? "Main video",
		isMain: true,
		muted: existingTrack?.muted ?? false,
		hidden: existingTrack?.hidden ?? false,
		elements: [],
	};
	const voiceElements: AudioTrack["elements"] = [];

	for (const range of plan.source_ranges) {
		const asset = mediaAssets.find(
			(candidate) => candidate.id === range.source_asset_id,
		);
		if (!asset) continue;
		const linkedGroupId = generateUUID();
		const duration = Math.max(0.1, range.target_duration_ms / 1000);
		const trimStart = range.source_start_ms / 1000;
		const trimEnd = Math.max(
			0,
			(asset.duration ?? duration) - range.source_end_ms / 1000,
		);
		const elementId = generateUUID();
		track.elements.push({
			id: elementId,
			type: "video",
			mediaId: asset.id,
			name: `${asset.name} · ${range.range_id.split(":").at(-1) ?? "cut"}`,
			duration,
			startTime: range.timeline_start_ms / 1000,
			trimStart,
			trimEnd,
			muted: true,
			hidden: false,
			transform: { ...DEFAULT_TRANSFORM },
			opacity: DEFAULT_OPACITY,
			blendMode: DEFAULT_BLEND_MODE,
			linkedGroupId,
		});
		voiceElements.push({
			id: generateUUID(),
			type: "audio",
			sourceType: "upload",
			mediaId: asset.id,
			name: `${asset.name} voice`,
			duration,
			startTime: range.timeline_start_ms / 1000,
			trimStart,
			trimEnd,
			role: "voiceover",
			volume: 1,
			normalizationGainDb: plan.audio_mix.voice_gain_db,
			muted: false,
			playbackRate: 1,
			fadeInDuration: 0,
			fadeOutDuration: 0,
			linkedGroupId,
			animationSfxSync: null,
		});
	}

	return {
		track,
		voiceElements,
	};
}

function buildCaptionTrack({
	project,
	existingTrack,
	plan,
}: {
	project: TProject;
	existingTrack: TextTrack | null;
	plan: ReferenceRecreationPlan;
}): TextTrack {
	const styledProject = {
		...project,
		clipforge: {
			...ensureClipForgeProjectData({ project }).clipforge,
			activeCaptionStyleId: plan.caption_style.style_id,
			captionStylesById: {
				...ensureClipForgeProjectData({ project }).clipforge.captionStylesById,
				[plan.caption_style.style_id]: {
					style_id: plan.caption_style.style_id,
					font: plan.caption_style.font,
					size: plan.caption_style.size,
					position: plan.caption_style.position,
					outline: plan.caption_style.outline,
					highlight_mode: "word",
					reveal_preset_id: "pop-line",
					sound_sync_preset_id: "caption-pop-bright",
				},
			},
		},
	} as TProject;
	const generated = createCaptionTextElements({
		project: styledProject,
		styleId: plan.caption_style.style_id,
		options: {
			maxWordsPerChunk: 1,
			maxCharsPerLine: 16,
			maxLines: 1,
			minDisplaySeconds: 0.16,
		},
	}).map((element): TextElement => {
		const content =
			plan.caption_style.text_transform === "uppercase"
				? element.content.toUpperCase()
				: element.content;
		return {
			...element,
			content,
			fontWeight: "bold",
			color: plan.caption_style.fill_color,
			background: {
				...DEFAULT_TEXT_ELEMENT.background,
				color: plan.caption_style.outline
					? plan.caption_style.outline_color
					: "transparent",
				paddingX: plan.caption_style.outline ? 24 : 0,
				paddingY: plan.caption_style.outline ? 10 : 0,
				cornerRadius: 0,
			},
			transform: {
				...element.transform,
				position: {
					...element.transform.position,
					y:
						plan.caption_style.safe_zone === "center"
							? 0
							: Math.round(plan.crop.canvas_height * 0.34),
				},
			},
		};
	});

	return {
		id: existingTrack?.id ?? generateUUID(),
		type: "text",
		name: existingTrack?.name ?? "Captions",
		hidden: existingTrack?.hidden ?? false,
		elements: generated,
	};
}

function buildAudioTrack({
	existingTrack,
	plan,
	mediaAssets,
	voiceElements,
}: {
	existingTrack: AudioTrack | null;
	plan: ReferenceRecreationPlan;
	mediaAssets: MediaAsset[];
	voiceElements: AudioTrack["elements"];
}): AudioTrack | null {
	const musicAsset = plan.music_asset_id
		? mediaAssets.find(
				(asset) => asset.id === plan.music_asset_id && asset.type === "audio",
			)
		: null;
	const elements = [...voiceElements].sort(
		(left, right) => left.startTime - right.startTime,
	);
	if (musicAsset) {
		const musicDurationMs = Math.max(
			1,
			Math.round((musicAsset.duration ?? 0) * 1000),
		);
		let cursorMs = 0;
		while (cursorMs < plan.target_duration_ms) {
			const durationMs = Math.min(
				musicDurationMs,
				plan.target_duration_ms - cursorMs,
			);
			elements.push({
				id: generateUUID(),
				type: "audio",
				sourceType: "upload",
				mediaId: musicAsset.id,
				name: musicAsset.name,
				duration: durationMs / 1000,
				startTime: cursorMs / 1000,
				trimStart: 0,
				trimEnd: Math.max(
					0,
					(musicAsset.duration ?? durationMs / 1000) - durationMs / 1000,
				),
				role: "music",
				volume: plan.audio_mix.music_volume,
				normalizationGainDb: null,
				muted: false,
				playbackRate: 1,
				fadeInDuration: cursorMs === 0 ? 0.12 : 0,
				fadeOutDuration:
					cursorMs + durationMs >= plan.target_duration_ms ? 0.28 : 0,
				linkedGroupId: null,
				animationSfxSync: null,
			});
			cursorMs += musicDurationMs;
		}
	}

	if (elements.length === 0) {
		return null;
	}

	return {
		id: existingTrack?.id ?? generateUUID(),
		type: "audio",
		name: existingTrack?.name ?? "Audio",
		muted: existingTrack?.muted ?? false,
		volume: existingTrack?.volume ?? 1,
		elements: elements.sort((left, right) => left.startTime - right.startTime),
	};
}

export function buildReferenceRecreationDraft({
	project,
	mediaAssets,
	referenceAssetId,
	sourceAssetIds,
	musicAssetId = null,
}: BuildReferenceRecreationPlanInput): BuildReferenceRecreationDraftResult {
	const baseProject = structuredClone(ensureClipForgeProjectData({ project }));
	const activeScene =
		baseProject.scenes.find(
			(scene) => scene.id === baseProject.currentSceneId,
		) ??
		baseProject.scenes[0] ??
		null;
	if (!activeScene) {
		throw new Error("Reference recreation requires an active scene.");
	}

	const { plan, referenceEditAnalysis, sourceAnalyses, musicAnalysis } =
		buildReferenceRecreationPlan({
			project: baseProject,
			mediaAssets,
			referenceAssetId,
			sourceAssetIds,
			musicAssetId,
		});
	const existingMainTrack =
		activeScene.tracks.find(
			(track): track is VideoTrack =>
				track.type === "video" && track.isMain === true,
		) ?? null;
	const existingCaptionTrack =
		activeScene.tracks.find(
			(track): track is TextTrack => track.type === "text",
		) ?? null;
	const existingAudioTrack =
		activeScene.tracks.find(
			(track): track is AudioTrack => track.type === "audio",
		) ?? null;
	const main = buildMainVideoTrack({
		existingTrack: existingMainTrack,
		mediaAssets,
		plan,
	});
	const sceneForCaptions = {
		...baseProject,
		scenes: baseProject.scenes.map((scene) =>
			scene.id === activeScene.id
				? {
						...scene,
						tracks: [main.track],
					}
				: scene,
		),
	};
	const captionTrack = buildCaptionTrack({
		project: sceneForCaptions,
		existingTrack: existingCaptionTrack,
		plan,
	});
	const audioTrack = buildAudioTrack({
		existingTrack: existingAudioTrack,
		plan,
		mediaAssets,
		voiceElements: main.voiceElements,
	});
	const nextTracks: TimelineTrack[] = audioTrack
		? [main.track, captionTrack, audioTrack]
		: [main.track, captionTrack];

	activeScene.tracks = nextTracks;
	activeScene.updatedAt = new Date();

	baseProject.settings = {
		...baseProject.settings,
		canvasSize: {
			width: TARGET_CANVAS_WIDTH,
			height: TARGET_CANVAS_HEIGHT,
		},
		originalCanvasSize:
			baseProject.settings.originalCanvasSize ??
			baseProject.settings.canvasSize,
		versionPack: buildDefaultProjectVersionPack({
			canvasSize: {
				width: TARGET_CANVAS_WIDTH,
				height: TARGET_CANVAS_HEIGHT,
			},
		}),
		audio: {
			...DEFAULT_PROJECT_AUDIO_SETTINGS,
			...(baseProject.settings.audio ?? {}),
			masterVolume: 1,
			duckingEnabled: true,
			duckingAmount: plan.audio_mix.ducking_amount,
			duckingAttackMs: plan.audio_mix.ducking_attack_ms,
			duckingReleaseMs: plan.audio_mix.ducking_release_ms,
			audioPolishPresetId: "voice-forward",
			softLimiterEnabled: plan.audio_mix.soft_limiter,
		},
		polishProfileId: "talking-head",
	};
	baseProject.metadata.duration = plan.target_duration_ms / 1000;
	baseProject.metadata.updatedAt = new Date();
	baseProject.clipforge = {
		...baseProject.clipforge,
		activeReferenceVideoAssetId: referenceAssetId,
		assemblySourceAssetIds: sourceAssetIds,
		referenceEditAnalysisByAssetId: {
			...baseProject.clipforge.referenceEditAnalysisByAssetId,
			[referenceAssetId]: referenceEditAnalysis,
		},
		sourceRecreationAnalysisByAssetId: {
			...baseProject.clipforge.sourceRecreationAnalysisByAssetId,
			...sourceAnalyses,
		},
		musicTrackAnalysisByAssetId: musicAnalysis
			? {
					...baseProject.clipforge.musicTrackAnalysisByAssetId,
					[musicAnalysis.asset_id]: musicAnalysis,
				}
			: baseProject.clipforge.musicTrackAnalysisByAssetId,
		referenceRecreationPlansById: {
			...baseProject.clipforge.referenceRecreationPlansById,
			[plan.plan_id]: plan,
		},
		activeReferenceRecreationPlanId: plan.plan_id,
		activeCaptionStyleId: plan.caption_style.style_id,
		captionStylesById: {
			...baseProject.clipforge.captionStylesById,
			[plan.caption_style.style_id]: {
				style_id: plan.caption_style.style_id,
				font: plan.caption_style.font,
				size: plan.caption_style.size,
				position: plan.caption_style.position,
				outline: plan.caption_style.outline,
				highlight_mode: "word",
				reveal_preset_id: "pop-line",
				sound_sync_preset_id: "caption-pop-bright",
			},
		},
		captionTrackIdsBySceneId: {
			...baseProject.clipforge.captionTrackIdsBySceneId,
			[activeScene.id]: captionTrack.id,
		},
	};

	return {
		project: baseProject,
		plan,
		referenceEditAnalysis,
		sourceAnalyses,
		musicAnalysis,
	};
}
