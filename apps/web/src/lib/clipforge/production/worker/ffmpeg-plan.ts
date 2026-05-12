import type {
	RenderGraphInput,
	RenderGraphMediaRef,
} from "@/lib/clipforge/production/render-graph";
import type { ExportFormat, ExportQuality } from "@/types/export";
import type {
	ImageElement,
	TScene,
	TextElement,
	VideoTrack,
	VisualAdjustments,
	VisualEffect,
	VisualKeyframeMap,
} from "@/types/timeline";

export interface FfmpegFeatureFlags {
	textOverlays?: boolean;
	imageOverlays?: boolean;
	captionWordReveals?: boolean;
	transitions?: boolean;
	colorAndEffects?: boolean;
	audioMixing?: boolean;
	keyframeAnimations?: boolean;
}

export const DEFAULT_FFMPEG_FEATURES: Required<FfmpegFeatureFlags> = {
	textOverlays: false,
	imageOverlays: false,
	captionWordReveals: false,
	transitions: false,
	colorAndEffects: false,
	audioMixing: false,
	keyframeAnimations: false,
};

const TRANSITION_PRESET_TO_XFADE: Record<string, XfadeTransitionKind | null> = {
	"cross-dissolve": "fade",
	"fade-black": "fadeblack",
	"fade-white": "fadewhite",
	slide: "slideleft",
};

function mapTransitionPresetToXfade(
	preset: string,
): XfadeTransitionKind | null {
	return TRANSITION_PRESET_TO_XFADE[preset] ?? null;
}

export interface PlanTextOverlay {
	id: string;
	content: string;
	startTime: number;
	endTime: number;
	canvasOffset: { x: number; y: number };
	fontSize: number;
	color: string;
	background: {
		color: string;
		alpha: number;
		paddingX: number;
		paddingY: number;
	} | null;
	stroke?: {
		color: string;
		width: number;
	} | null;
	textAlign: "left" | "center" | "right";
	fontWeight: "normal" | "bold";
}

export interface PlanImageOverlay {
	id: string;
	mediaId: string;
	storageKey: string;
	startTime: number;
	endTime: number;
	canvasOffset: { x: number; y: number };
	scale: number;
	opacity: number;
	/**
	 * Optional opacity keyframes (0..1) over the overlay's local timeline
	 * (relative to startTime). When set, replaces the constant `opacity`.
	 */
	opacityKeyframes?: PlanKeyframeStep[];
}

export type XfadeTransitionKind =
	| "fade"
	| "fadeblack"
	| "fadewhite"
	| "slideleft";

export interface PlanKeyframeStep {
	timeSeconds: number;
	value: number;
}

export type PlanVisualEffect =
	| { kind: "blur"; radius: number }
	| { kind: "sharpen"; amount: number }
	| { kind: "vignette"; intensity: number };

export interface PlanColorAdjustments {
	exposure: number;
	contrast: number;
	saturation: number;
	temperature?: number;
	tint?: number;
	highlights?: number;
	shadows?: number;
}

export type PlanAudioRole = "voiceover" | "music" | "sfx" | "audio";

export interface PlanFilterGraphAudioElement {
	mediaId: string;
	/**
	 * Set for cloud-uploaded media. Mutually exclusive with `sourceUrl`.
	 */
	storageKey?: string | null;
	/**
	 * Set for library/bundled audio whose bytes the worker fetches by URL
	 * (relative paths are resolved against the worker base URL). Mutually
	 * exclusive with `storageKey`.
	 */
	sourceUrl?: string | null;
	startTimeSeconds: number;
	durationSeconds: number;
	trimStartSeconds: number;
	trimEndSeconds: number;
	volume: number;
	role: PlanAudioRole;
	fadeInSeconds?: number;
	fadeOutSeconds?: number;
	normalizationGainDb?: number;
	playbackRate?: number;
}

export interface PlanAudioSettings {
	masterVolume: number;
	softLimiterEnabled?: boolean;
	ducking: {
		enabled: boolean;
		amount: number;
		attackMs: number;
		releaseMs: number;
	} | null;
	noiseReduction?: {
		enabled: boolean;
		strength: number;
		windReductionEnabled: boolean;
	} | null;
}

export interface PlanFilterGraphClip {
	mediaId: string;
	storageKey: string;
	durationSeconds: number;
	trimStartSeconds: number;
	trimEndSeconds: number;
	fit?: "contain" | "cover";
	transitionInFromPrev: {
		kind: XfadeTransitionKind;
		durationSeconds: number;
	} | null;
	effects?: PlanVisualEffect[];
	adjustments?: PlanColorAdjustments | null;
	playbackRate?: number;
	rotateKeyframes?: PlanKeyframeStep[];
}

export type FfmpegPlan =
	| {
			kind: "black-video";
			canvasSize: { width: number; height: number };
			durationSeconds: number;
			includeAudio: boolean;
			format: ExportFormat;
			quality: ExportQuality;
			textOverlays: PlanTextOverlay[];
			imageOverlays: PlanImageOverlay[];
	  }
	| {
			kind: "video-concat";
			canvasSize: { width: number; height: number };
			includeAudio: boolean;
			format: ExportFormat;
			quality: ExportQuality;
			clips: Array<{
				mediaId: string;
				storageKey: string;
				durationSeconds: number;
				trimStartSeconds: number;
				trimEndSeconds: number;
			}>;
			textOverlays: PlanTextOverlay[];
			imageOverlays: PlanImageOverlay[];
	  }
	| {
			kind: "video-filter-graph";
			canvasSize: { width: number; height: number };
			includeAudio: boolean;
			format: ExportFormat;
			quality: ExportQuality;
			clips: PlanFilterGraphClip[];
			textOverlays: PlanTextOverlay[];
			imageOverlays: PlanImageOverlay[];
			audioElements?: PlanFilterGraphAudioElement[];
			audioSettings?: PlanAudioSettings | null;
	  }
	| {
			kind: "unsupported";
			reasons: string[];
	  };

interface PlanProgress {
	supportedVideoClips: Array<{
		mediaId: string;
		durationSeconds: number;
		trimStartSeconds: number;
		trimEndSeconds: number;
		transitionInPreset: string | null;
		transitionInDuration: number | null;
		fit?: "contain" | "cover";
		effects: PlanVisualEffect[];
		adjustments: PlanColorAdjustments | null;
		playbackRate: number;
		rotateKeyframes: PlanKeyframeStep[];
	}>;
	reasons: string[];
}

function extractRotateKeyframes(
	keyframes: VisualKeyframeMap | null | undefined,
): PlanKeyframeStep[] {
	const rawRotate = keyframes?.rotate;
	if (!rawRotate || rawRotate.length === 0) return [];
	return rawRotate
		.filter((k) => typeof k.time === "number" && typeof k.value === "number")
		.map((k) => ({ timeSeconds: k.time, value: k.value }));
}

function extractOpacityKeyframes(
	keyframes: VisualKeyframeMap | null | undefined,
): PlanKeyframeStep[] {
	const rawOpacity = keyframes?.opacity;
	if (!rawOpacity || rawOpacity.length === 0) return [];
	return rawOpacity
		.filter((k) => typeof k.time === "number" && typeof k.value === "number")
		.map((k) => ({ timeSeconds: k.time, value: k.value }));
}

function hasUnsupportedKeyframeProperty(
	keyframes: VisualKeyframeMap | null | undefined,
): boolean {
	if (!keyframes) return false;
	const props: ReadonlyArray<keyof VisualKeyframeMap> = [
		"positionX",
		"positionY",
		"scale",
	];
	for (const prop of props) {
		const arr = keyframes[prop];
		if (Array.isArray(arr) && arr.length > 0) return true;
	}
	return false;
}

interface AudioCandidate {
	mediaId: string;
	startTimeSeconds: number;
	durationSeconds: number;
	trimStartSeconds: number;
	trimEndSeconds: number;
	volume: number;
	role: PlanAudioRole;
	muted: boolean;
	fadeInSeconds: number;
	fadeOutSeconds: number;
	normalizationGainDb: number;
	playbackRate: number;
	/** Cloud-uploaded media id (when sourceType === "upload"). */
	storageKeyMediaId?: string;
	/** Direct URL (when sourceType === "library"). */
	sourceUrl?: string;
}

interface AudioCollection {
	upload: AudioCandidate[];
	library: AudioCandidate[];
}

function extractAudioSettings({
	project,
}: {
	project: {
		settings?: {
			audio?: {
				masterVolume?: number;
				duckingEnabled?: boolean;
				duckingAmount?: number;
				duckingAttackMs?: number;
				duckingReleaseMs?: number;
				softLimiterEnabled?: boolean;
				noiseReductionEnabled?: boolean;
				noiseReductionStrength?: number;
				windReductionEnabled?: boolean;
			};
		};
	};
}): PlanAudioSettings | null {
	const audio = project.settings?.audio;
	if (!audio) return null;
	const masterVolume =
		typeof audio.masterVolume === "number" && audio.masterVolume >= 0
			? audio.masterVolume
			: 1;
	const duckingEnabled = audio.duckingEnabled === true;
	const softLimiterEnabled = audio.softLimiterEnabled === true;
	const ducking = duckingEnabled
		? {
				enabled: true,
				amount:
					typeof audio.duckingAmount === "number"
						? Math.max(0, Math.min(1, audio.duckingAmount))
						: 0.5,
				attackMs:
					typeof audio.duckingAttackMs === "number" &&
					audio.duckingAttackMs >= 0
						? audio.duckingAttackMs
						: 50,
				releaseMs:
					typeof audio.duckingReleaseMs === "number" &&
					audio.duckingReleaseMs >= 0
						? audio.duckingReleaseMs
						: 250,
			}
		: null;
	const noiseReduction =
		audio.noiseReductionEnabled === true
			? {
					enabled: true,
					strength:
						typeof audio.noiseReductionStrength === "number"
							? Math.max(0, Math.min(1, audio.noiseReductionStrength))
							: 0.7,
					windReductionEnabled: audio.windReductionEnabled === true,
				}
			: null;
	return { masterVolume, softLimiterEnabled, ducking, noiseReduction };
}

function collectAudioElements({
	scenes,
}: {
	scenes: TScene[];
}): AudioCollection {
	const upload: AudioCandidate[] = [];
	const library: AudioCandidate[] = [];

	for (const scene of scenes) {
		for (const track of scene.tracks) {
			if (track.type !== "audio") continue;
			for (const element of track.elements) {
				const fadeInSeconds = Math.max(
					0,
					typeof element.fadeInDuration === "number"
						? element.fadeInDuration
						: 0,
				);
				const fadeOutSeconds = Math.max(
					0,
					typeof element.fadeOutDuration === "number"
						? element.fadeOutDuration
						: 0,
				);
				const normalizationGainDb =
					typeof element.normalizationGainDb === "number"
						? element.normalizationGainDb
						: 0;
				const playbackRate =
					typeof element.playbackRate === "number" && element.playbackRate > 0
						? element.playbackRate
						: 1;
				const base = {
					startTimeSeconds: element.startTime,
					durationSeconds: element.duration,
					trimStartSeconds: element.trimStart,
					trimEndSeconds: element.trimEnd,
					volume: typeof element.volume === "number" ? element.volume : 1,
					role: element.role ?? ("audio" as PlanAudioRole),
					muted: element.muted === true || track.muted === true,
					fadeInSeconds,
					fadeOutSeconds,
					normalizationGainDb,
					playbackRate,
				};
				if (element.sourceType === "upload") {
					upload.push({
						...base,
						mediaId: element.mediaId,
						storageKeyMediaId: element.mediaId,
					});
				} else {
					// Library audio: use the element id as the synthetic mediaId so
					// downstream code can still index/log per element. The bytes are
					// fetched by sourceUrl rather than via the cloud media records.
					library.push({
						...base,
						mediaId: element.id,
						sourceUrl: element.sourceUrl,
					});
				}
			}
		}
	}

	return { upload, library };
}

function extractEffects(
	rawEffects: VisualEffect[] | null | undefined,
): PlanVisualEffect[] {
	if (!rawEffects) return [];
	const result: PlanVisualEffect[] = [];
	for (const effect of rawEffects) {
		if (!effect.enabled) continue;
		if (effect.kind === "blur") {
			result.push({ kind: "blur", radius: effect.radius });
		} else if (effect.kind === "sharpen") {
			result.push({ kind: "sharpen", amount: effect.amount });
		} else if (effect.kind === "vignette") {
			result.push({ kind: "vignette", intensity: effect.intensity });
		}
	}
	return result;
}

function extractAdjustments(raw: VisualAdjustments | null | undefined): {
	adjustments: PlanColorAdjustments | null;
} {
	if (!raw) return { adjustments: null };
	const exposure = typeof raw.exposure === "number" ? raw.exposure : 0;
	const contrast = typeof raw.contrast === "number" ? raw.contrast : 0;
	const saturation = typeof raw.saturation === "number" ? raw.saturation : 0;
	const temperature = typeof raw.temperature === "number" ? raw.temperature : 0;
	const tint = typeof raw.tint === "number" ? raw.tint : 0;
	const highlights = typeof raw.highlights === "number" ? raw.highlights : 0;
	const shadows = typeof raw.shadows === "number" ? raw.shadows : 0;
	if (
		exposure === 0 &&
		contrast === 0 &&
		saturation === 0 &&
		temperature === 0 &&
		tint === 0 &&
		highlights === 0 &&
		shadows === 0
	) {
		return { adjustments: null };
	}
	return {
		adjustments: {
			exposure,
			contrast,
			saturation,
			temperature,
			tint,
			highlights,
			shadows,
		},
	};
}

function getMainVideoTrack(scene: TScene): VideoTrack | null {
	for (const track of scene.tracks) {
		if (track.type === "video" && track.isMain) {
			return track;
		}
	}
	for (const track of scene.tracks) {
		if (track.type === "video") return track;
	}
	return null;
}

function summarizeUnsupportedFeatures({
	scenes,
	features,
}: {
	scenes: TScene[];
	features: Required<FfmpegFeatureFlags>;
}): string[] {
	const reasons = new Set<string>();
	let imageCountInVideo = 0;
	let textCount = 0;
	let stickerCount = 0;
	let audioCount = 0;
	let nonMainVideoTrackCount = 0;
	let transitionSkippedCount = 0;
	let unsupportedTransitionPresets = new Set<string>();
	let keyframeCount = 0;
	let effectCount = 0;
	let adjustmentCount = 0;
	let unsupportedKeyframePropertyCount = 0;

	for (const scene of scenes) {
		let videoTracksSeen = 0;
		for (const track of scene.tracks) {
			if (track.type === "video") {
				videoTracksSeen += 1;
				if (videoTracksSeen > 1) nonMainVideoTrackCount += 1;
				for (const element of track.elements) {
					if (element.type === "image" && !features.imageOverlays)
						imageCountInVideo += 1;
					if (element.type === "video") {
						if (element.transitionIn) {
							const xfade = mapTransitionPresetToXfade(
								element.transitionIn.preset,
							);
							if (!features.transitions) {
								transitionSkippedCount += 1;
							} else if (!xfade) {
								unsupportedTransitionPresets.add(element.transitionIn.preset);
							}
						}
						if (element.keyframes) {
							if (!features.keyframeAnimations) {
								keyframeCount += 1;
							} else if (hasUnsupportedKeyframeProperty(element.keyframes)) {
								unsupportedKeyframePropertyCount += 1;
							}
						}
						const enabledEffects = (element.effects ?? []).filter(
							(eff) => eff.enabled,
						);
						if (enabledEffects.length > 0 && !features.colorAndEffects) {
							effectCount += 1;
						}
						if (element.adjustments) {
							const { adjustments } = extractAdjustments(element.adjustments);
							if (!features.colorAndEffects && adjustments) {
								adjustmentCount += 1;
							}
						}
					}
				}
			}
			if (track.type === "text" && !features.textOverlays)
				textCount += track.elements.length;
			if (track.type === "sticker") stickerCount += track.elements.length;
			if (track.type === "audio" && !features.audioMixing) {
				audioCount += track.elements.length;
			}
		}
	}

	if (imageCountInVideo > 0)
		reasons.add(
			`${imageCountInVideo} image element(s) skipped (enable imageOverlays to render)`,
		);
	if (textCount > 0)
		reasons.add(
			`${textCount} text/caption element(s) skipped (enable textOverlays to render)`,
		);
	if (stickerCount > 0)
		reasons.add(`${stickerCount} sticker element(s) skipped`);
	if (audioCount > 0)
		reasons.add(
			`${audioCount} dedicated audio track element(s) skipped (enable audioMixing to render)`,
		);
	if (nonMainVideoTrackCount > 0)
		reasons.add(
			`${nonMainVideoTrackCount} extra video track(s) skipped (only the main track is rendered)`,
		);
	if (transitionSkippedCount > 0)
		reasons.add(
			`${transitionSkippedCount} transition(s) skipped (enable transitions to render)`,
		);
	if (unsupportedTransitionPresets.size > 0)
		reasons.add(
			`Unsupported transition preset(s) skipped: ${Array.from(unsupportedTransitionPresets).join(", ")}`,
		);
	if (keyframeCount > 0)
		reasons.add(
			`${keyframeCount} clip(s) with keyframe animation rendered without animation (enable keyframeAnimations to render)`,
		);
	if (unsupportedKeyframePropertyCount > 0)
		reasons.add(
			`${unsupportedKeyframePropertyCount} clip(s) have unsupported keyframe properties (only rotate is wired for video clips; positionX/positionY/scale are deferred)`,
		);
	if (effectCount > 0)
		reasons.add(
			`${effectCount} clip(s) with visual effects skipped (enable colorAndEffects to render)`,
		);
	if (adjustmentCount > 0)
		reasons.add(
			`${adjustmentCount} clip(s) with color adjustments skipped (enable colorAndEffects to render)`,
		);
	return Array.from(reasons);
}

function collectMainVideoClips({ scenes }: { scenes: TScene[] }): PlanProgress {
	const progress: PlanProgress = { supportedVideoClips: [], reasons: [] };
	for (const scene of scenes) {
		const main = getMainVideoTrack(scene);
		if (!main) continue;
		const elementsInOrder = [...main.elements].sort(
			(a, b) => a.startTime - b.startTime,
		);
		for (const element of elementsInOrder) {
			if (element.type !== "video") continue;
			const { adjustments } = extractAdjustments(element.adjustments);
			const rawRate = element.playbackRate;
			const playbackRate =
				typeof rawRate === "number" && rawRate > 0 ? rawRate : 1;
			progress.supportedVideoClips.push({
				mediaId: element.mediaId,
				durationSeconds: element.duration,
				trimStartSeconds: element.trimStart,
				trimEndSeconds: element.trimEnd,
				fit: element.fit,
				transitionInPreset: element.transitionIn?.preset ?? null,
				transitionInDuration: element.transitionIn?.duration ?? null,
				effects: extractEffects(element.effects),
				adjustments,
				playbackRate,
				rotateKeyframes: extractRotateKeyframes(element.keyframes),
			});
		}
	}
	return progress;
}

function parseHexAlpha(color: string): { hex: string; alpha: number } {
	const trimmed = color.trim();
	if (trimmed.length === 9 && trimmed.startsWith("#")) {
		const hex = trimmed.slice(0, 7);
		const alphaByte = Number.parseInt(trimmed.slice(7), 16);
		const alpha = Number.isFinite(alphaByte)
			? Math.max(0, Math.min(1, alphaByte / 255))
			: 1;
		return { hex, alpha };
	}
	if (trimmed.length === 7 && trimmed.startsWith("#")) {
		return { hex: trimmed, alpha: 1 };
	}
	return { hex: "#FFFFFF", alpha: 1 };
}

function collectTextOverlays({
	scenes,
	canvasSize,
	expandCaptionWords,
}: {
	scenes: TScene[];
	canvasSize: { width: number; height: number };
	expandCaptionWords: boolean;
}): PlanTextOverlay[] {
	const overlays: PlanTextOverlay[] = [];
	for (const scene of scenes) {
		for (const track of scene.tracks) {
			if (track.type !== "text") continue;
			for (const element of track.elements as TextElement[]) {
				if (element.hidden) continue;
				const { hex: bgHex, alpha: bgAlpha } = parseHexAlpha(
					element.background.color,
				);
				const baseOverlay: PlanTextOverlay = {
					id: element.id,
					content: element.content,
					startTime: element.startTime,
					endTime: element.startTime + element.duration,
					canvasOffset: {
						x: Math.round(
							canvasSize.width / 2 + (element.transform.position.x ?? 0),
						),
						y: Math.round(
							canvasSize.height / 2 + (element.transform.position.y ?? 0),
						),
					},
					fontSize: element.fontSize,
					color: element.color,
					background:
						bgAlpha > 0
							? {
									color: bgHex,
									alpha: bgAlpha,
									paddingX: element.background.paddingX ?? 12,
									paddingY: element.background.paddingY ?? 6,
								}
							: null,
					stroke:
						element.stroke && element.stroke.width > 0
							? {
									color: element.stroke.color,
									width: element.stroke.width,
								}
							: null,
					textAlign: element.textAlign,
					fontWeight: element.fontWeight,
				};

				const captionWords = element.captionTiming?.words;
				if (
					expandCaptionWords &&
					element.role === "caption" &&
					Array.isArray(captionWords) &&
					captionWords.length > 0
				) {
					for (let i = 0; i < captionWords.length; i += 1) {
						const word = captionWords[i]!;
						overlays.push({
							...baseOverlay,
							id: `${element.id}__w${i}`,
							content: word.text,
							startTime: word.startTime,
							endTime: word.endTime,
						});
					}
					continue;
				}

				overlays.push(baseOverlay);
			}
		}
	}
	return overlays;
}

function collectImageOverlays({
	scenes,
	canvasSize,
	mediaRefIndex,
	missingMediaIds,
	enableKeyframes,
}: {
	scenes: TScene[];
	canvasSize: { width: number; height: number };
	mediaRefIndex: Map<string, RenderGraphMediaRef>;
	missingMediaIds: Set<string>;
	enableKeyframes: boolean;
}): PlanImageOverlay[] {
	const overlays: PlanImageOverlay[] = [];
	for (const scene of scenes) {
		for (const track of scene.tracks) {
			if (track.type !== "video") continue;
			for (const element of track.elements) {
				if (element.type !== "image") continue;
				const image = element as ImageElement;
				if (image.hidden) continue;
				const ref = mediaRefIndex.get(image.mediaId);
				if (!ref || !ref.cloudStorageKey) {
					missingMediaIds.add(image.mediaId);
					continue;
				}
				const opacityKeyframes = enableKeyframes
					? extractOpacityKeyframes(image.keyframes)
					: [];
				overlays.push({
					id: image.id,
					mediaId: image.mediaId,
					storageKey: ref.cloudStorageKey,
					startTime: image.startTime,
					endTime: image.startTime + image.duration,
					canvasOffset: {
						x: Math.round(
							canvasSize.width / 2 + (image.transform.position.x ?? 0),
						),
						y: Math.round(
							canvasSize.height / 2 + (image.transform.position.y ?? 0),
						),
					},
					scale: image.transform.scale ?? 1,
					opacity: image.opacity ?? 1,
					opacityKeyframes:
						opacityKeyframes.length > 0 ? opacityKeyframes : undefined,
				});
			}
		}
	}
	return overlays;
}

export function buildFfmpegPlan({
	input,
	features,
}: {
	input: RenderGraphInput;
	features?: FfmpegFeatureFlags;
}): FfmpegPlan {
	const resolvedFeatures: Required<FfmpegFeatureFlags> = {
		...DEFAULT_FFMPEG_FEATURES,
		...features,
	};
	const scenes = input.project.scenes ?? [];
	const reasons = summarizeUnsupportedFeatures({
		scenes,
		features: resolvedFeatures,
	});
	const collected = collectMainVideoClips({ scenes });

	const mediaRefIndex = new Map<string, RenderGraphMediaRef>();
	for (const ref of input.mediaRefs) {
		mediaRefIndex.set(ref.mediaId, ref);
	}

	const missingMediaIds = new Set<string>();
	const textOverlays = resolvedFeatures.textOverlays
		? collectTextOverlays({
				scenes,
				canvasSize: input.canvasSize,
				expandCaptionWords: resolvedFeatures.captionWordReveals,
			})
		: [];
	const imageOverlays = resolvedFeatures.imageOverlays
		? collectImageOverlays({
				scenes,
				canvasSize: input.canvasSize,
				mediaRefIndex,
				missingMediaIds,
				enableKeyframes: resolvedFeatures.keyframeAnimations,
			})
		: [];
	let anyKeyframeAnimation = imageOverlays.some(
		(o) => o.opacityKeyframes && o.opacityKeyframes.length > 0,
	);

	if (collected.supportedVideoClips.length === 0) {
		if (missingMediaIds.size > 0) {
			return {
				kind: "unsupported",
				reasons: [
					...reasons,
					`Missing cloud media for image overlay(s): ${Array.from(missingMediaIds).join(", ")}.`,
				],
			};
		}
		return {
			kind: "black-video",
			canvasSize: input.canvasSize,
			durationSeconds: Math.max(1, input.durationSeconds || 1),
			includeAudio: input.includeAudio,
			format: input.format,
			quality: input.quality,
			textOverlays,
			imageOverlays,
		};
	}

	const concatClips: Extract<FfmpegPlan, { kind: "video-concat" }>["clips"] =
		[];
	const filterGraphClips: PlanFilterGraphClip[] = [];
	let anyXfadeTransition = false;
	let anyTrimmedClip = false;
	let anyColorOrEffect = false;
	let anyPlaybackRate = false;
	let anyCoverFit = false;
	for (let i = 0; i < collected.supportedVideoClips.length; i += 1) {
		const clip = collected.supportedVideoClips[i]!;
		const ref = mediaRefIndex.get(clip.mediaId);
		if (!ref || !ref.cloudStorageKey) {
			missingMediaIds.add(clip.mediaId);
			continue;
		}
		concatClips.push({
			mediaId: clip.mediaId,
			storageKey: ref.cloudStorageKey,
			durationSeconds: clip.durationSeconds,
			trimStartSeconds: clip.trimStartSeconds,
			trimEndSeconds: clip.trimEndSeconds,
		});
		if (clip.trimStartSeconds > 0 || clip.trimEndSeconds > 0) {
			anyTrimmedClip = true;
		}

		// transitionIn applies to this clip relative to the previous one. The
		// first clip's transitionIn is ignored (nothing to fade from).
		let transitionInFromPrev: PlanFilterGraphClip["transitionInFromPrev"] =
			null;
		if (
			resolvedFeatures.transitions &&
			i > 0 &&
			clip.transitionInPreset !== null
		) {
			const xfade = mapTransitionPresetToXfade(clip.transitionInPreset);
			if (xfade) {
				const previous = collected.supportedVideoClips[i - 1]!;
				const requestedDuration = clip.transitionInDuration ?? 0.5;
				const maxDuration = Math.max(
					0.05,
					Math.min(previous.durationSeconds, clip.durationSeconds) - 0.05,
				);
				const durationSeconds = Math.min(
					Math.max(0.05, requestedDuration),
					maxDuration,
				);
				transitionInFromPrev = { kind: xfade, durationSeconds };
				anyXfadeTransition = true;
			}
		}
		const planEffects = resolvedFeatures.colorAndEffects ? clip.effects : [];
		const planAdjustments = resolvedFeatures.colorAndEffects
			? clip.adjustments
			: null;
		if (planEffects.length > 0 || planAdjustments) anyColorOrEffect = true;
		if (clip.playbackRate !== 1) anyPlaybackRate = true;
		if (clip.fit === "cover") anyCoverFit = true;
		const planRotateKeyframes =
			resolvedFeatures.keyframeAnimations && clip.rotateKeyframes.length > 0
				? clip.rotateKeyframes
				: undefined;
		if (planRotateKeyframes) anyKeyframeAnimation = true;
		filterGraphClips.push({
			mediaId: clip.mediaId,
			storageKey: ref.cloudStorageKey,
			durationSeconds: clip.durationSeconds,
			trimStartSeconds: clip.trimStartSeconds,
			trimEndSeconds: clip.trimEndSeconds,
			fit: clip.fit,
			transitionInFromPrev,
			effects: planEffects,
			adjustments: planAdjustments,
			playbackRate: clip.playbackRate,
			rotateKeyframes: planRotateKeyframes,
		});
	}

	const audioCollection = resolvedFeatures.audioMixing
		? collectAudioElements({ scenes })
		: { upload: [], library: [] };
	const audioElements: PlanFilterGraphAudioElement[] = [];
	for (const candidate of audioCollection.upload) {
		if (candidate.muted) continue;
		const ref = mediaRefIndex.get(candidate.mediaId);
		if (!ref || !ref.cloudStorageKey) {
			missingMediaIds.add(candidate.mediaId);
			continue;
		}
		if (candidate.playbackRate !== 1) anyPlaybackRate = true;
		audioElements.push({
			mediaId: candidate.mediaId,
			storageKey: ref.cloudStorageKey,
			startTimeSeconds: candidate.startTimeSeconds,
			durationSeconds: candidate.durationSeconds,
			trimStartSeconds: candidate.trimStartSeconds,
			trimEndSeconds: candidate.trimEndSeconds,
			volume: candidate.volume,
			role: candidate.role,
			fadeInSeconds: candidate.fadeInSeconds,
			fadeOutSeconds: candidate.fadeOutSeconds,
			normalizationGainDb: candidate.normalizationGainDb,
			playbackRate: candidate.playbackRate,
		});
	}
	for (const candidate of audioCollection.library) {
		if (candidate.muted) continue;
		if (!candidate.sourceUrl) continue;
		if (candidate.playbackRate !== 1) anyPlaybackRate = true;
		audioElements.push({
			mediaId: candidate.mediaId,
			sourceUrl: candidate.sourceUrl,
			startTimeSeconds: candidate.startTimeSeconds,
			durationSeconds: candidate.durationSeconds,
			trimStartSeconds: candidate.trimStartSeconds,
			trimEndSeconds: candidate.trimEndSeconds,
			volume: candidate.volume,
			role: candidate.role,
			fadeInSeconds: candidate.fadeInSeconds,
			fadeOutSeconds: candidate.fadeOutSeconds,
			normalizationGainDb: candidate.normalizationGainDb,
			playbackRate: candidate.playbackRate,
		});
	}

	const audioSettings = resolvedFeatures.audioMixing
		? extractAudioSettings({ project: input.project })
		: null;

	if (missingMediaIds.size > 0) {
		return {
			kind: "unsupported",
			reasons: [
				...reasons,
				`Missing cloud media for ${missingMediaIds.size} clip(s)/overlay(s)/audio(s): ${Array.from(missingMediaIds).join(", ")}. Upload media to cloud first.`,
			],
		};
	}

	const anyAudioElement = audioElements.length > 0;
	const anyAudioSettings =
		audioSettings !== null &&
		(audioSettings.masterVolume !== 1 ||
			audioSettings.softLimiterEnabled === true ||
			audioSettings.noiseReduction?.enabled === true ||
			audioSettings.ducking?.enabled === true);
	if (
		anyXfadeTransition ||
		anyTrimmedClip ||
		anyColorOrEffect ||
		anyAudioElement ||
		anyAudioSettings ||
		anyPlaybackRate ||
		anyCoverFit ||
		anyKeyframeAnimation
	) {
		return {
			kind: "video-filter-graph",
			canvasSize: input.canvasSize,
			includeAudio: input.includeAudio,
			format: input.format,
			quality: input.quality,
			clips: filterGraphClips,
			textOverlays,
			imageOverlays,
			audioElements,
			audioSettings,
		};
	}

	return {
		kind: "video-concat",
		canvasSize: input.canvasSize,
		includeAudio: input.includeAudio,
		format: input.format,
		quality: input.quality,
		clips: concatClips,
		textOverlays,
		imageOverlays,
	};
}

export interface FfmpegInvocation {
	args: string[];
	outputPath: string;
	contentType: string;
	supportSummary: string[];
}

function videoBitrateForQuality(quality: ExportQuality): string {
	switch (quality) {
		case "low":
			return "1500k";
		case "medium":
			return "3500k";
		case "high":
			return "6000k";
		default:
			return "3500k";
	}
}

function audioBitrateForQuality(quality: ExportQuality): string {
	switch (quality) {
		case "low":
			return "96k";
		case "medium":
			return "128k";
		case "high":
			return "192k";
		default:
			return "128k";
	}
}

function videoCodecForFormat(format: ExportFormat): string {
	return format === "webm" ? "libvpx-vp9" : "libx264";
}

function audioCodecForFormat(format: ExportFormat): string {
	return format === "webm" ? "libopus" : "aac";
}

function escapeDrawtextValue(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'")
		.replace(/:/g, "\\:")
		.replace(/%/g, "\\%")
		.replace(/\r?\n/g, "\\\n");
}

function alignToX({
	align,
	canvasOffsetX,
}: {
	align: "left" | "center" | "right";
	canvasOffsetX: number;
}): string {
	if (align === "center") return `(w-text_w)/2+(${canvasOffsetX}-w/2)`;
	if (align === "right") return `${canvasOffsetX}-text_w`;
	return `${canvasOffsetX}`;
}

export function buildDrawtextFilter({
	overlay,
	fontFile,
}: {
	overlay: PlanTextOverlay;
	fontFile?: string | null;
}): string {
	const params: string[] = [];
	params.push(`text='${escapeDrawtextValue(overlay.content)}'`);
	if (fontFile) {
		params.push(`fontfile='${escapeDrawtextValue(fontFile)}'`);
	}
	params.push(`fontsize=${Math.round(overlay.fontSize)}`);
	params.push(`fontcolor=${overlay.color}`);
	params.push(
		`x=${alignToX({ align: overlay.textAlign, canvasOffsetX: overlay.canvasOffset.x })}`,
	);
	params.push(`y=${overlay.canvasOffset.y}-text_h/2`);
	if (overlay.background) {
		const alphaHex = Math.round(overlay.background.alpha * 255)
			.toString(16)
			.padStart(2, "0");
		const colorWithAlpha = `${overlay.background.color}${alphaHex}`;
		params.push("box=1");
		params.push(`boxcolor=${colorWithAlpha}`);
		params.push(`boxborderw=${overlay.background.paddingX}`);
	}
	if (overlay.stroke && overlay.stroke.width > 0) {
		params.push(`borderw=${Math.round(overlay.stroke.width)}`);
		params.push(`bordercolor=${overlay.stroke.color}`);
	}
	const enableExpr = `between(t\\,${overlay.startTime}\\,${overlay.endTime})`;
	params.push(`enable='${enableExpr}'`);
	return `drawtext=${params.join(":")}`;
}

interface OverlayInput {
	startInputIndex: number;
	overlay: PlanImageOverlay;
}

export function buildOverlayFilterChain({
	textOverlays,
	imageOverlays,
	imageInputs,
	fontFile,
}: {
	textOverlays: PlanTextOverlay[];
	imageOverlays: PlanImageOverlay[];
	imageInputs: OverlayInput[];
	fontFile?: string | null;
}): string {
	const stages: string[] = [];
	let currentLabel: string | null = "[base]";

	for (let i = 0; i < imageInputs.length; i += 1) {
		const { startInputIndex, overlay } = imageInputs[i]!;
		const nextLabel = `[ovl${i}]`;
		const enableExpr = `between(t\\,${overlay.startTime}\\,${overlay.endTime})`;
		const animatedOpacity = buildOpacityKeyframeFilter({
			keyframes: overlay.opacityKeyframes,
			startTimeSeconds: overlay.startTime,
		});
		// Three opacity modes: keyframed (animated), constant<1 (static alpha
		// channel), or no filter at all (constant 1).
		const opacityPipeline = animatedOpacity
			? `[${startInputIndex}:v]format=rgba,${animatedOpacity}[a${i}];`
			: overlay.opacity < 1
				? `[${startInputIndex}:v]format=rgba,colorchannelmixer=aa=${overlay.opacity}[a${i}];`
				: "";
		const usesAlphaStream = animatedOpacity !== null || overlay.opacity < 1;
		const sourceLabel = usesAlphaStream ? `[a${i}]` : `[${startInputIndex}:v]`;
		const xExpr = `${overlay.canvasOffset.x}-overlay_w/2`;
		const yExpr = `${overlay.canvasOffset.y}-overlay_h/2`;
		stages.push(
			`${opacityPipeline}${currentLabel}${sourceLabel}overlay=x=${xExpr}:y=${yExpr}:enable='${enableExpr}'${nextLabel}`,
		);
		currentLabel = nextLabel;
	}

	for (let i = 0; i < textOverlays.length; i += 1) {
		const overlay = textOverlays[i]!;
		const nextLabel = `[txt${i}]`;
		stages.push(
			`${currentLabel}${buildDrawtextFilter({ overlay, fontFile })}${nextLabel}`,
		);
		currentLabel = nextLabel;
	}

	return stages.join(";");
}

export function buildBlackVideoFfmpegInvocation({
	plan,
	outputPath,
	supportSummary,
	imageInputPaths = [],
	fontFile,
}: {
	plan: Extract<FfmpegPlan, { kind: "black-video" }>;
	outputPath: string;
	supportSummary: string[];
	imageInputPaths?: string[];
	fontFile?: string | null;
}): FfmpegInvocation {
	const { canvasSize, durationSeconds, includeAudio, format, quality } = plan;
	const args: string[] = [
		"-y",
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=${canvasSize.width}x${canvasSize.height}:d=${durationSeconds}`,
	];
	const audioInputIndex = imageInputPaths.length + 1;
	for (const imagePath of imageInputPaths) {
		args.push("-loop", "1", "-i", imagePath);
	}
	if (includeAudio) {
		args.push(
			"-f",
			"lavfi",
			"-i",
			`anullsrc=channel_layout=stereo:sample_rate=48000`,
			"-shortest",
		);
	}
	const overlayFilter = buildOverlayFilterChain({
		textOverlays: plan.textOverlays,
		imageOverlays: plan.imageOverlays,
		imageInputs: plan.imageOverlays.map((overlay, idx) => ({
			startInputIndex: 1 + idx,
			overlay,
		})),
		fontFile,
	});
	if (overlayFilter) {
		args.push("-filter_complex", `[0:v]copy[base];${overlayFilter}`);
		args.push("-map", "[final-or-last]");
	}
	args.push(
		"-c:v",
		videoCodecForFormat(format),
		"-b:v",
		videoBitrateForQuality(quality),
		"-pix_fmt",
		"yuv420p",
		"-colorspace",
		"bt709",
		"-color_trc",
		"bt709",
		"-color_primaries",
		"bt709",
	);
	if (includeAudio) {
		args.push(
			"-c:a",
			audioCodecForFormat(format),
			"-b:a",
			audioBitrateForQuality(quality),
		);
		args.push("-map", `${audioInputIndex}:a?`);
	}
	args.push(outputPath);
	return {
		args: replaceFinalMapPlaceholder({
			args,
			textOverlayCount: plan.textOverlays.length,
			imageOverlayCount: plan.imageOverlays.length,
		}),
		outputPath,
		contentType: format === "webm" ? "video/webm" : "video/mp4",
		supportSummary,
	};
}

export function buildVideoConcatFfmpegInvocation({
	plan,
	outputPath,
	concatListPath,
	supportSummary,
	imageInputPaths = [],
	fontFile,
}: {
	plan: Extract<FfmpegPlan, { kind: "video-concat" }>;
	outputPath: string;
	concatListPath: string;
	supportSummary: string[];
	imageInputPaths?: string[];
	fontFile?: string | null;
}): FfmpegInvocation {
	const { canvasSize, includeAudio, format, quality } = plan;
	const args: string[] = [
		"-y",
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		concatListPath,
	];
	for (const imagePath of imageInputPaths) {
		args.push("-loop", "1", "-i", imagePath);
	}

	const baseScale = `scale=${canvasSize.width}:${canvasSize.height}:force_original_aspect_ratio=decrease,pad=${canvasSize.width}:${canvasSize.height}:(ow-iw)/2:(oh-ih)/2:color=black`;
	const overlayFilter = buildOverlayFilterChain({
		textOverlays: plan.textOverlays,
		imageOverlays: plan.imageOverlays,
		imageInputs: plan.imageOverlays.map((overlay, idx) => ({
			startInputIndex: 1 + idx,
			overlay,
		})),
		fontFile,
	});
	if (overlayFilter) {
		args.push("-filter_complex", `[0:v]${baseScale}[base];${overlayFilter}`);
		args.push("-map", "[final-or-last]");
	} else {
		args.push("-vf", baseScale);
	}
	args.push(
		"-c:v",
		videoCodecForFormat(format),
		"-b:v",
		videoBitrateForQuality(quality),
		"-pix_fmt",
		"yuv420p",
		"-colorspace",
		"bt709",
		"-color_trc",
		"bt709",
		"-color_primaries",
		"bt709",
	);
	if (includeAudio) {
		args.push(
			"-c:a",
			audioCodecForFormat(format),
			"-b:a",
			audioBitrateForQuality(quality),
		);
	} else {
		args.push("-an");
	}
	args.push(outputPath);
	return {
		args: replaceFinalMapPlaceholder({
			args,
			textOverlayCount: plan.textOverlays.length,
			imageOverlayCount: plan.imageOverlays.length,
		}),
		outputPath,
		contentType: format === "webm" ? "video/webm" : "video/mp4",
		supportSummary,
	};
}

function replaceFinalMapPlaceholder({
	args,
	textOverlayCount,
	imageOverlayCount,
}: {
	args: string[];
	textOverlayCount: number;
	imageOverlayCount: number;
}): string[] {
	if (textOverlayCount === 0 && imageOverlayCount === 0) return args;
	const finalLabel =
		textOverlayCount > 0
			? `[txt${textOverlayCount - 1}]`
			: `[ovl${imageOverlayCount - 1}]`;
	return args.map((arg) => (arg === "[final-or-last]" ? finalLabel : arg));
}

export interface XfadeChainResult {
	filter: string;
	finalLabel: string;
	totalDurationSeconds: number;
}

export interface AcrossfadeChainResult {
	filter: string;
	finalLabel: string;
}

interface TrimFilterChunks {
	video: string[];
	audio: string[];
}

function buildTrimFilters({
	clip,
}: {
	clip: PlanFilterGraphClip;
}): TrimFilterChunks {
	const video: string[] = [];
	const audio: string[] = [];
	const playbackRate = clip.playbackRate ?? 1;
	const isTrimmed = clip.trimStartSeconds > 0 || clip.trimEndSeconds > 0;
	if (isTrimmed) {
		const start = clip.trimStartSeconds.toFixed(3);
		// Source duration = timeline duration * playbackRate so the post-setpts
		// stream matches durationSeconds on the timeline.
		const sourceDuration = (clip.durationSeconds * playbackRate).toFixed(3);
		video.push(`trim=start=${start}:duration=${sourceDuration}`);
		video.push("setpts=PTS-STARTPTS");
		audio.push(`atrim=start=${start}:duration=${sourceDuration}`);
		audio.push("asetpts=PTS-STARTPTS");
	}
	return { video, audio };
}

export function buildAtempoChain({
	playbackRate,
}: {
	playbackRate: number;
}): string[] {
	if (
		!Number.isFinite(playbackRate) ||
		playbackRate <= 0 ||
		playbackRate === 1
	) {
		return [];
	}
	// atempo accepts [0.5, 100]. Chain multiple stages to reach values outside
	// that range. Use the closest in-range step each pass.
	const stages: string[] = [];
	let remaining = playbackRate;
	const maxStep = 100;
	const minStep = 0.5;
	while (remaining > maxStep) {
		stages.push(`atempo=${maxStep}`);
		remaining = remaining / maxStep;
	}
	while (remaining < minStep) {
		stages.push(`atempo=${minStep}`);
		remaining = remaining / minStep;
	}
	if (Math.abs(remaining - 1) > 1e-6) {
		stages.push(`atempo=${remaining.toFixed(6)}`);
	}
	return stages;
}

export function buildAdjustmentsFilter({
	adjustments,
}: {
	adjustments: PlanColorAdjustments;
}): string | null {
	const params: string[] = [];
	// eq filter: brightness range -1 to 1, contrast range -2 to 2 (default 1),
	// saturation range 0 to 3 (default 1). The editor's adjustments use 0-centered
	// units; map them so 0 = neutral.
	if (adjustments.exposure !== 0) {
		const brightness = clamp(adjustments.exposure, -1, 1);
		params.push(`brightness=${brightness.toFixed(3)}`);
	}
	if (adjustments.contrast !== 0) {
		const contrast = clamp(1 + adjustments.contrast, -2, 2);
		params.push(`contrast=${contrast.toFixed(3)}`);
	}
	if (adjustments.saturation !== 0) {
		const saturation = clamp(1 + adjustments.saturation, 0, 3);
		params.push(`saturation=${saturation.toFixed(3)}`);
	}
	if (params.length === 0) return null;
	return `eq=${params.join(":")}`;
}

export function buildColorBalanceFilter({
	adjustments,
}: {
	adjustments: PlanColorAdjustments;
}): string | null {
	// Approximation: ffmpeg's colorbalance filter exposes per-bucket per-channel
	// offsets. Map each editor knob to the closest bucket. This won't match a
	// professional grading curve exactly but produces visually correct shifts
	// for short-form footage.
	//   temperature  → midtones red (warm) / blue (cold)
	//   tint         → midtones green (negative) / magenta (positive); ffmpeg's
	//                  gm is green so we negate the editor sign.
	//   highlights   → highlight bucket on every channel (lift/lower)
	//   shadows      → shadow bucket on every channel
	const params: string[] = [];
	const temp = clamp(adjustments.temperature ?? 0, -1, 1);
	if (temp !== 0) {
		// Warm (positive editor value) = +red and -blue in midtones.
		params.push(`rm=${temp.toFixed(3)}`);
		params.push(`bm=${(-temp).toFixed(3)}`);
	}
	const tint = clamp(adjustments.tint ?? 0, -1, 1);
	if (tint !== 0) {
		// Editor convention: positive tint → magenta (less green).
		params.push(`gm=${(-tint).toFixed(3)}`);
	}
	const highlights = clamp(adjustments.highlights ?? 0, -1, 1);
	if (highlights !== 0) {
		const v = highlights.toFixed(3);
		params.push(`rh=${v}`);
		params.push(`gh=${v}`);
		params.push(`bh=${v}`);
	}
	const shadows = clamp(adjustments.shadows ?? 0, -1, 1);
	if (shadows !== 0) {
		const v = shadows.toFixed(3);
		params.push(`rs=${v}`);
		params.push(`gs=${v}`);
		params.push(`bs=${v}`);
	}
	if (params.length === 0) return null;
	return `colorbalance=${params.join(":")}`;
}

export function buildEffectFilter({
	effect,
}: {
	effect: PlanVisualEffect;
}): string {
	if (effect.kind === "blur") {
		const sigma = Math.max(0.1, effect.radius);
		return `gblur=sigma=${sigma.toFixed(3)}`;
	}
	if (effect.kind === "sharpen") {
		const amount = Math.max(0, effect.amount);
		return `unsharp=lx=5:ly=5:la=${amount.toFixed(3)}`;
	}
	if (effect.kind === "vignette") {
		const angle = clamp(effect.intensity, 0, 1) * (Math.PI / 4);
		return `vignette=angle=${angle.toFixed(3)}`;
	}
	const _exhaustive: never = effect;
	return _exhaustive;
}

function clamp(value: number, min: number, max: number): number {
	if (Number.isNaN(value)) return min;
	return Math.max(min, Math.min(max, value));
}

/**
 * Translates a sorted-by-time list of keyframes into an ffmpeg expression
 * (piecewise linear interpolation) over the variable `t`. Times must be in
 * seconds within the per-stream local timeline (so the first emitted segment
 * starts where t == keyframes[0].timeSeconds).
 *
 * Returns the constant-string fallback when there are no keyframes; returns a
 * constant when there is only one keyframe; otherwise returns a nested if(…)
 * chain that ramps linearly between adjacent pairs and clamps to the boundary
 * values outside the keyframed range.
 */
export function buildKeyframeExpression({
	keyframes,
	transformValue = (value) => value,
	fallback,
}: {
	keyframes: PlanKeyframeStep[] | undefined | null;
	transformValue?: (value: number) => number;
	fallback: string;
}): string {
	if (!keyframes || keyframes.length === 0) return fallback;
	const sorted = [...keyframes]
		.map((k) => ({ time: k.timeSeconds, value: transformValue(k.value) }))
		.sort((a, b) => a.time - b.time);
	if (sorted.length === 1) {
		return formatNumber(sorted[0]!.value);
	}

	const first = sorted[0]!;
	const last = sorted[sorted.length - 1]!;
	let expression = formatNumber(last.value);
	// Walk pairs in reverse so the innermost branch (last segment) is built
	// first and successive outer branches wrap it.
	for (let i = sorted.length - 2; i >= 0; i -= 1) {
		const a = sorted[i]!;
		const b = sorted[i + 1]!;
		const span = b.time - a.time;
		const segmentExpression =
			span === 0
				? formatNumber(b.value)
				: `(${formatNumber(a.value)}+(${formatNumber(b.value - a.value)})*((t-${formatNumber(a.time)})/${formatNumber(span)}))`;
		expression = `if(lt(t,${formatNumber(b.time)}),${segmentExpression},${expression})`;
	}
	// Clamp below the first keyframe to its value.
	expression = `if(lt(t,${formatNumber(first.time)}),${formatNumber(first.value)},${expression})`;
	return expression;
}

function formatNumber(value: number): string {
	if (!Number.isFinite(value)) return "0";
	if (Number.isInteger(value)) return value.toString();
	// Avoid scientific notation; cap precision so expressions stay terse.
	return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

const DEG_TO_RAD = Math.PI / 180;

export function buildRotateKeyframeFilter({
	keyframes,
}: {
	keyframes: PlanKeyframeStep[] | undefined;
}): string | null {
	if (!keyframes || keyframes.length === 0) return null;
	const expression = buildKeyframeExpression({
		keyframes,
		transformValue: (value) => value * DEG_TO_RAD,
		fallback: "0",
	});
	// rotate=A:fillcolor=black:ow=iw:oh=ih keeps the canvas dimensions stable
	// (rotation around the center, transparent corners filled black).
	return `rotate='${expression}':fillcolor=black:ow=iw:oh=ih`;
}

export function buildOpacityKeyframeFilter({
	keyframes,
	startTimeSeconds,
}: {
	keyframes: PlanKeyframeStep[] | undefined;
	startTimeSeconds: number;
}): string | null {
	if (!keyframes || keyframes.length === 0) return null;
	// Image overlays' time space starts at startTimeSeconds on the canvas
	// timeline. The colorchannelmixer expression sees `t` from canvas zero,
	// so shift each keyframe by startTimeSeconds.
	const shifted = keyframes.map((k) => ({
		timeSeconds: k.timeSeconds + startTimeSeconds,
		value: k.value,
	}));
	const expression = buildKeyframeExpression({
		keyframes: shifted,
		transformValue: (value) => clamp(value, 0, 1),
		fallback: "1",
	});
	return `colorchannelmixer=aa='${expression}':eval=frame`;
}

export function buildXfadeChainFilter({
	clips,
	canvasSize,
}: {
	clips: PlanFilterGraphClip[];
	canvasSize: { width: number; height: number };
}): XfadeChainResult {
	if (clips.length === 0) {
		return { filter: "", finalLabel: "[base]", totalDurationSeconds: 0 };
	}

	const stages: string[] = [];
	const buildBaseScale = (clip: PlanFilterGraphClip) =>
		clip.fit === "cover"
			? `scale=${canvasSize.width}:${canvasSize.height}:force_original_aspect_ratio=increase,crop=${canvasSize.width}:${canvasSize.height}:(iw-ow)/2:(ih-oh)/2,setsar=1`
			: `scale=${canvasSize.width}:${canvasSize.height}:force_original_aspect_ratio=decrease,pad=${canvasSize.width}:${canvasSize.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;

	for (let i = 0; i < clips.length; i += 1) {
		const clip = clips[i]!;
		const trimFilters = buildTrimFilters({ clip });
		const eqFilter = clip.adjustments
			? buildAdjustmentsFilter({ adjustments: clip.adjustments })
			: null;
		const colorBalanceFilter = clip.adjustments
			? buildColorBalanceFilter({ adjustments: clip.adjustments })
			: null;
		const effectFilters = (clip.effects ?? []).map((effect) =>
			buildEffectFilter({ effect }),
		);
		const playbackRate = clip.playbackRate ?? 1;
		const rotateFilter = buildRotateKeyframeFilter({
			keyframes: clip.rotateKeyframes,
		});
		const pipelineParts: string[] = [];
		if (trimFilters.video.length > 0) pipelineParts.push(...trimFilters.video);
		if (playbackRate !== 1) {
			pipelineParts.push(`setpts=PTS/${playbackRate.toFixed(6)}`);
		}
		pipelineParts.push(buildBaseScale(clip));
		if (eqFilter) pipelineParts.push(eqFilter);
		if (colorBalanceFilter) pipelineParts.push(colorBalanceFilter);
		for (const filter of effectFilters) pipelineParts.push(filter);
		if (rotateFilter) pipelineParts.push(rotateFilter);
		pipelineParts.push("format=yuv420p");
		stages.push(`[${i}:v]${pipelineParts.join(",")}[v${i}]`);
	}

	if (clips.length === 1) {
		return {
			filter: stages.join(";"),
			finalLabel: "[v0]",
			totalDurationSeconds: clips[0]!.durationSeconds,
		};
	}

	let currentLabel = "[v0]";
	let cumulativeDuration = clips[0]!.durationSeconds;
	for (let i = 1; i < clips.length; i += 1) {
		const clip = clips[i]!;
		const transition = clip.transitionInFromPrev;
		const nextLabel = i === clips.length - 1 ? "[base]" : `[xf${i}]`;
		const nextSourceLabel = `[v${i}]`;
		if (transition) {
			const offset = cumulativeDuration - transition.durationSeconds;
			stages.push(
				`${currentLabel}${nextSourceLabel}xfade=transition=${transition.kind}:duration=${transition.durationSeconds}:offset=${offset.toFixed(3)}${nextLabel}`,
			);
			cumulativeDuration += clip.durationSeconds - transition.durationSeconds;
		} else {
			stages.push(
				`${currentLabel}${nextSourceLabel}concat=n=2:v=1:a=0${nextLabel}`,
			);
			cumulativeDuration += clip.durationSeconds;
		}
		currentLabel = nextLabel;
	}

	return {
		filter: stages.join(";"),
		finalLabel: currentLabel,
		totalDurationSeconds: cumulativeDuration,
	};
}

export function buildAcrossfadeChainFilter({
	clips,
}: {
	clips: PlanFilterGraphClip[];
}): AcrossfadeChainResult {
	if (clips.length === 0) return { filter: "", finalLabel: "[outa]" };

	const stages: string[] = [];
	for (let i = 0; i < clips.length; i += 1) {
		const clip = clips[i]!;
		const audioPipeline = buildTrimFilters({ clip }).audio;
		const atempoChain = buildAtempoChain({
			playbackRate: clip.playbackRate ?? 1,
		});
		const combined = [...audioPipeline, ...atempoChain];
		if (combined.length > 0) {
			stages.push(`[${i}:a]${combined.join(",")}[a${i}]`);
		} else {
			stages.push(`[${i}:a]anull[a${i}]`);
		}
	}

	if (clips.length === 1) {
		return { filter: stages.join(";"), finalLabel: "[a0]" };
	}

	let currentLabel = "[a0]";
	for (let i = 1; i < clips.length; i += 1) {
		const clip = clips[i]!;
		const transition = clip.transitionInFromPrev;
		const nextLabel = i === clips.length - 1 ? "[outa]" : `[af${i}]`;
		const nextSourceLabel = `[a${i}]`;
		if (transition) {
			stages.push(
				`${currentLabel}${nextSourceLabel}acrossfade=d=${transition.durationSeconds}:c1=tri:c2=tri${nextLabel}`,
			);
		} else {
			stages.push(
				`${currentLabel}${nextSourceLabel}concat=n=2:v=0:a=1${nextLabel}`,
			);
		}
		currentLabel = nextLabel;
	}

	return { filter: stages.join(";"), finalLabel: currentLabel };
}

export interface AudioMixChainResult {
	filter: string;
	finalLabel: string;
}

function buildAudioCleanupFilters({
	role,
	noiseReduction,
}: {
	role: PlanAudioRole;
	noiseReduction: PlanAudioSettings["noiseReduction"];
}): string[] {
	if (!noiseReduction?.enabled || (role !== "voiceover" && role !== "audio")) {
		return [];
	}
	const strength = clamp(noiseReduction.strength, 0, 1);
	const filters = [
		`highpass=f=${noiseReduction.windReductionEnabled ? 130 : 80}`,
		"lowpass=f=14000",
	];
	if (strength > 0) {
		const reductionDb = 6 + strength * 12;
		const noiseFloorDb = -28 - strength * 18;
		filters.push(
			`afftdn=nr=${reductionDb.toFixed(1)}:nf=${noiseFloorDb.toFixed(1)}:nt=w`,
		);
	}
	return filters;
}

export function buildAudioMixChain({
	clipChainLabel,
	audioElements,
	firstAudioInputIndex,
	audioSettings,
}: {
	clipChainLabel: string | null;
	audioElements: PlanFilterGraphAudioElement[];
	firstAudioInputIndex: number;
	audioSettings?: PlanAudioSettings | null;
}): AudioMixChainResult {
	const masterVolume = audioSettings?.masterVolume ?? 1;
	const softLimiterEnabled = audioSettings?.softLimiterEnabled === true;
	const ducking = audioSettings?.ducking ?? null;
	const noiseReduction = audioSettings?.noiseReduction ?? null;
	const noElements = audioElements.length === 0;
	if (noElements && masterVolume === 1 && !softLimiterEnabled) {
		return {
			filter: "",
			finalLabel: clipChainLabel ?? "[finala]",
		};
	}

	const stages: string[] = [];

	// Per-element pipeline. Element labels: [ae{i}].
	const elementLabels: string[] = [];
	for (let i = 0; i < audioElements.length; i += 1) {
		const audio = audioElements[i]!;
		const inputIndex = firstAudioInputIndex + i;
		const playbackRate = audio.playbackRate ?? 1;
		const trimStart = audio.trimStartSeconds.toFixed(3);
		// Source duration = timeline duration * playbackRate so the post-atempo
		// stream matches durationSeconds on the timeline.
		const sourceDuration = (audio.durationSeconds * playbackRate).toFixed(3);
		const delayMs = Math.max(0, Math.round(audio.startTimeSeconds * 1000));
		const volume = clamp(audio.volume, 0, 4);
		const filters: string[] = [
			`atrim=start=${trimStart}:duration=${sourceDuration}`,
			"asetpts=PTS-STARTPTS",
		];
		const atempoChain = buildAtempoChain({ playbackRate });
		for (const step of atempoChain) filters.push(step);
		filters.push(
			...buildAudioCleanupFilters({
				role: audio.role,
				noiseReduction,
			}),
		);
		if (volume !== 1) filters.push(`volume=${volume.toFixed(3)}`);
		const normalizationGainDb = audio.normalizationGainDb ?? 0;
		if (normalizationGainDb !== 0) {
			filters.push(`volume=${normalizationGainDb.toFixed(2)}dB`);
		}
		// fadeIn/fadeOut are evaluated in the post-atempo (timeline) duration.
		const fadeInSeconds = audio.fadeInSeconds ?? 0;
		if (fadeInSeconds > 0) {
			filters.push(`afade=t=in:st=0:d=${fadeInSeconds.toFixed(3)}`);
		}
		const fadeOutSeconds = audio.fadeOutSeconds ?? 0;
		if (fadeOutSeconds > 0) {
			const fadeOutStart = Math.max(0, audio.durationSeconds - fadeOutSeconds);
			filters.push(
				`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutSeconds.toFixed(3)}`,
			);
		}
		if (delayMs > 0) filters.push(`adelay=${delayMs}|${delayMs}`);
		const label = `[ae${i}]`;
		stages.push(`[${inputIndex}:a]${filters.join(",")}${label}`);
		elementLabels.push(label);
	}

	// Optional ducking: when enabled, elements with role=voiceover compress
	// every other element via sidechaincompress. The voiceover stays at its
	// pre-ducked volume.
	let voiceoverIndices: number[] = [];
	let nonVoiceoverIndices: number[] = [];
	if (ducking?.enabled) {
		voiceoverIndices = audioElements
			.map((el, idx) => ({ el, idx }))
			.filter(({ el }) => el.role === "voiceover")
			.map(({ idx }) => idx);
		nonVoiceoverIndices = audioElements
			.map((el, idx) => ({ el, idx }))
			.filter(({ el }) => el.role !== "voiceover")
			.map(({ idx }) => idx);
	}

	let mixInputs: string[];
	if (
		ducking?.enabled &&
		voiceoverIndices.length > 0 &&
		nonVoiceoverIndices.length > 0
	) {
		// Build a sidechain (combined voiceover) once, then duck each non-voice
		// element with it. The voiceover passes through to the mix unchanged.
		if (voiceoverIndices.length === 1) {
			stages.push(
				`${elementLabels[voiceoverIndices[0]!]}asplit=2[voice_main][voice_sc]`,
			);
		} else {
			const voiceLabels = voiceoverIndices
				.map((i) => elementLabels[i]!)
				.join("");
			stages.push(
				`${voiceLabels}amix=inputs=${voiceoverIndices.length}:duration=longest:dropout_transition=0[voice_pre]`,
			);
			stages.push("[voice_pre]asplit=2[voice_main][voice_sc]");
		}
		// 1 - amount maps an editor "amount" of 0..1 to the gain reduction
		// applied to the music when the voice is present.
		const ratio = 1 + clamp(ducking.amount, 0, 1) * 7; // 1..8
		const duckedNonVoiceLabels: string[] = [];
		for (let j = 0; j < nonVoiceoverIndices.length; j += 1) {
			const elemIdx = nonVoiceoverIndices[j]!;
			const sidechainAlias = j === 0 ? "[voice_sc]" : `[voice_sc${j}]`;
			if (j > 0) {
				stages.push(`[voice_sc]asplit=2[voice_sc][voice_sc${j}]`);
			}
			const duckedLabel = `[duck${j}]`;
			stages.push(
				`${elementLabels[elemIdx]!}${sidechainAlias}sidechaincompress=threshold=0.05:ratio=${ratio.toFixed(2)}:attack=${Math.max(1, ducking.attackMs)}:release=${Math.max(1, ducking.releaseMs)}${duckedLabel}`,
			);
			duckedNonVoiceLabels.push(duckedLabel);
		}
		mixInputs = [];
		if (clipChainLabel) mixInputs.push(clipChainLabel);
		mixInputs.push("[voice_main]", ...duckedNonVoiceLabels);
	} else {
		mixInputs = [];
		if (clipChainLabel) mixInputs.push(clipChainLabel);
		mixInputs.push(...elementLabels);
	}

	let mixedLabel: string;
	if (mixInputs.length === 1) {
		mixedLabel = mixInputs[0]!;
	} else if (mixInputs.length === 0) {
		// No clip audio + no elements; defer to caller (should not happen).
		mixedLabel = "[finala]";
	} else {
		// Use [premix] only when we still need to apply masterVolume on top;
		// otherwise label the mix output [finala] directly so callers downstream
		// keep matching against the stable label.
		const mixOutputLabel =
			masterVolume !== 1 || softLimiterEnabled ? "[premix]" : "[finala]";
		stages.push(
			`${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0${mixOutputLabel}`,
		);
		mixedLabel = mixOutputLabel;
	}

	let finalLabel = mixedLabel;
	if (masterVolume !== 1) {
		const volumeLabel = softLimiterEnabled ? "[mastera]" : "[finala]";
		stages.push(
			`${mixedLabel}volume=${clamp(masterVolume, 0, 4).toFixed(3)}${volumeLabel}`,
		);
		finalLabel = volumeLabel;
	}
	if (softLimiterEnabled) {
		stages.push(`${finalLabel}alimiter=limit=0.891:level=false[finala]`);
		return { filter: stages.join(";"), finalLabel: "[finala]" };
	}
	return { filter: stages.join(";"), finalLabel };
}

export function buildVideoFilterGraphFfmpegInvocation({
	plan,
	outputPath,
	supportSummary,
	imageInputPaths = [],
	mediaInputPaths,
	audioInputPaths = [],
	fontFile,
}: {
	plan: Extract<FfmpegPlan, { kind: "video-filter-graph" }>;
	outputPath: string;
	supportSummary: string[];
	imageInputPaths?: string[];
	mediaInputPaths: string[];
	audioInputPaths?: string[];
	fontFile?: string | null;
}): FfmpegInvocation {
	if (mediaInputPaths.length !== plan.clips.length) {
		throw new Error(
			`buildVideoFilterGraphFfmpegInvocation: expected ${plan.clips.length} media input paths, got ${mediaInputPaths.length}`,
		);
	}
	const audioElements = plan.audioElements ?? [];
	if (audioInputPaths.length !== audioElements.length) {
		throw new Error(
			`buildVideoFilterGraphFfmpegInvocation: expected ${audioElements.length} audio input paths, got ${audioInputPaths.length}`,
		);
	}

	const { canvasSize, includeAudio, format, quality } = plan;
	const args: string[] = ["-y"];
	for (const path of mediaInputPaths) {
		args.push("-i", path);
	}
	for (const imagePath of imageInputPaths) {
		args.push("-loop", "1", "-i", imagePath);
	}
	for (const audioPath of audioInputPaths) {
		args.push("-i", audioPath);
	}

	const xfadeChain = buildXfadeChainFilter({
		clips: plan.clips,
		canvasSize,
	});
	const overlayFilter = buildOverlayFilterChain({
		textOverlays: plan.textOverlays,
		imageOverlays: plan.imageOverlays,
		imageInputs: plan.imageOverlays.map((overlay, idx) => ({
			startInputIndex: mediaInputPaths.length + idx,
			overlay,
		})),
		fontFile,
	});
	const acrossfadeChain = includeAudio
		? buildAcrossfadeChainFilter({ clips: plan.clips })
		: { filter: "", finalLabel: "" };
	const audioMixChain = includeAudio
		? buildAudioMixChain({
				clipChainLabel: acrossfadeChain.finalLabel || null,
				audioElements,
				firstAudioInputIndex: mediaInputPaths.length + imageInputPaths.length,
				audioSettings: plan.audioSettings ?? null,
			})
		: { filter: "", finalLabel: "" };

	const filterParts: string[] = [];
	if (xfadeChain.filter) {
		// Alias xfade output as [base] only when overlays will chain off it
		if (overlayFilter && xfadeChain.finalLabel !== "[base]") {
			filterParts.push(
				`${xfadeChain.filter};${xfadeChain.finalLabel}null[base]`,
			);
		} else {
			filterParts.push(xfadeChain.filter);
		}
	}
	if (overlayFilter) filterParts.push(overlayFilter);
	if (acrossfadeChain.filter) filterParts.push(acrossfadeChain.filter);
	if (audioMixChain.filter) filterParts.push(audioMixChain.filter);

	const finalVideoLabel =
		plan.textOverlays.length > 0
			? `[txt${plan.textOverlays.length - 1}]`
			: plan.imageOverlays.length > 0
				? `[ovl${plan.imageOverlays.length - 1}]`
				: xfadeChain.finalLabel;

	if (filterParts.length > 0) {
		args.push("-filter_complex", filterParts.join(";"));
	}
	args.push("-map", finalVideoLabel);
	args.push(
		"-c:v",
		videoCodecForFormat(format),
		"-b:v",
		videoBitrateForQuality(quality),
		"-pix_fmt",
		"yuv420p",
		"-colorspace",
		"bt709",
		"-color_trc",
		"bt709",
		"-color_primaries",
		"bt709",
	);
	if (includeAudio) {
		args.push("-map", audioMixChain.finalLabel || acrossfadeChain.finalLabel);
		args.push(
			"-c:a",
			audioCodecForFormat(format),
			"-b:a",
			audioBitrateForQuality(quality),
		);
	} else {
		args.push("-an");
	}
	args.push("-t", xfadeChain.totalDurationSeconds.toFixed(3));
	args.push(outputPath);
	return {
		args,
		outputPath,
		contentType: format === "webm" ? "video/webm" : "video/mp4",
		supportSummary,
	};
}

export function buildConcatListFileContents({
	clips,
}: {
	clips: Array<{ localPath: string; durationSeconds: number }>;
}): string {
	return clips
		.map((clip) => `file '${clip.localPath.replace(/'/g, "'\\''")}'`)
		.join("\n");
}
