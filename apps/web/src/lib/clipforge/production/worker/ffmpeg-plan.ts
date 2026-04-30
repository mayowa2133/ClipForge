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
} from "@/types/timeline";

export interface FfmpegFeatureFlags {
	textOverlays?: boolean;
	imageOverlays?: boolean;
	captionWordReveals?: boolean;
}

export const DEFAULT_FFMPEG_FEATURES: Required<FfmpegFeatureFlags> = {
	textOverlays: false,
	imageOverlays: false,
	captionWordReveals: false,
};

export interface PlanTextOverlay {
	id: string;
	content: string;
	startTime: number;
	endTime: number;
	canvasOffset: { x: number; y: number };
	fontSize: number;
	color: string;
	background: { color: string; alpha: number; paddingX: number; paddingY: number } | null;
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
			kind: "unsupported";
			reasons: string[];
	  };

interface PlanProgress {
	supportedVideoClips: Array<{
		mediaId: string;
		durationSeconds: number;
		trimStartSeconds: number;
		trimEndSeconds: number;
	}>;
	reasons: string[];
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
	let transitionCount = 0;
	let keyframeCount = 0;
	let effectCount = 0;
	let adjustmentCount = 0;

	for (const scene of scenes) {
		let videoTracksSeen = 0;
		for (const track of scene.tracks) {
			if (track.type === "video") {
				videoTracksSeen += 1;
				if (videoTracksSeen > 1) nonMainVideoTrackCount += 1;
				for (const element of track.elements) {
					if (element.type === "image" && !features.imageOverlays) imageCountInVideo += 1;
					if (element.type === "video") {
						if (element.transitionIn) transitionCount += 1;
						if (element.keyframes) keyframeCount += 1;
						if (element.effects && element.effects.length > 0) effectCount += 1;
						if (element.adjustments) adjustmentCount += 1;
					}
				}
			}
			if (track.type === "text" && !features.textOverlays) textCount += track.elements.length;
			if (track.type === "sticker") stickerCount += track.elements.length;
			if (track.type === "audio") audioCount += track.elements.length;
		}
	}

	if (imageCountInVideo > 0)
		reasons.add(`${imageCountInVideo} image element(s) skipped (enable imageOverlays to render)`);
	if (textCount > 0)
		reasons.add(`${textCount} text/caption element(s) skipped (enable textOverlays to render)`);
	if (stickerCount > 0) reasons.add(`${stickerCount} sticker element(s) skipped`);
	if (audioCount > 0) reasons.add(`${audioCount} dedicated audio track element(s) skipped`);
	if (nonMainVideoTrackCount > 0)
		reasons.add(`${nonMainVideoTrackCount} extra video track(s) skipped (only the main track is rendered)`);
	if (transitionCount > 0)
		reasons.add(`${transitionCount} transition(s) skipped`);
	if (keyframeCount > 0)
		reasons.add(`${keyframeCount} clip(s) with keyframe animation rendered without animation`);
	if (effectCount > 0)
		reasons.add(`${effectCount} clip(s) with visual effects rendered without effects`);
	if (adjustmentCount > 0)
		reasons.add(`${adjustmentCount} clip(s) with color adjustments rendered without adjustments`);
	return Array.from(reasons);
}

function collectMainVideoClips({
	scenes,
}: {
	scenes: TScene[];
}): PlanProgress {
	const progress: PlanProgress = { supportedVideoClips: [], reasons: [] };
	for (const scene of scenes) {
		const main = getMainVideoTrack(scene);
		if (!main) continue;
		const elementsInOrder = [...main.elements].sort(
			(a, b) => a.startTime - b.startTime,
		);
		for (const element of elementsInOrder) {
			if (element.type !== "video") continue;
			progress.supportedVideoClips.push({
				mediaId: element.mediaId,
				durationSeconds: element.duration,
				trimStartSeconds: element.trimStart,
				trimEndSeconds: element.trimEnd,
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
		const alpha = Number.isFinite(alphaByte) ? Math.max(0, Math.min(1, alphaByte / 255)) : 1;
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
				const { hex: bgHex, alpha: bgAlpha } = parseHexAlpha(element.background.color);
				const baseOverlay: PlanTextOverlay = {
					id: element.id,
					content: element.content,
					startTime: element.startTime,
					endTime: element.startTime + element.duration,
					canvasOffset: {
						x: Math.round(canvasSize.width / 2 + (element.transform.position.x ?? 0)),
						y: Math.round(canvasSize.height / 2 + (element.transform.position.y ?? 0)),
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
}: {
	scenes: TScene[];
	canvasSize: { width: number; height: number };
	mediaRefIndex: Map<string, RenderGraphMediaRef>;
	missingMediaIds: Set<string>;
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
				overlays.push({
					id: image.id,
					mediaId: image.mediaId,
					storageKey: ref.cloudStorageKey,
					startTime: image.startTime,
					endTime: image.startTime + image.duration,
					canvasOffset: {
						x: Math.round(canvasSize.width / 2 + (image.transform.position.x ?? 0)),
						y: Math.round(canvasSize.height / 2 + (image.transform.position.y ?? 0)),
					},
					scale: image.transform.scale ?? 1,
					opacity: image.opacity ?? 1,
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
	const reasons = summarizeUnsupportedFeatures({ scenes, features: resolvedFeatures });
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
			})
		: [];

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

	const clips: Extract<FfmpegPlan, { kind: "video-concat" }>["clips"] = [];
	for (const clip of collected.supportedVideoClips) {
		const ref = mediaRefIndex.get(clip.mediaId);
		if (!ref || !ref.cloudStorageKey) {
			missingMediaIds.add(clip.mediaId);
			continue;
		}
		clips.push({
			mediaId: clip.mediaId,
			storageKey: ref.cloudStorageKey,
			durationSeconds: clip.durationSeconds,
			trimStartSeconds: clip.trimStartSeconds,
			trimEndSeconds: clip.trimEndSeconds,
		});
	}

	if (missingMediaIds.size > 0) {
		return {
			kind: "unsupported",
			reasons: [
				...reasons,
				`Missing cloud media for ${missingMediaIds.size} clip(s)/overlay(s): ${Array.from(missingMediaIds).join(", ")}. Upload media to cloud first.`,
			],
		};
	}

	return {
		kind: "video-concat",
		canvasSize: input.canvasSize,
		includeAudio: input.includeAudio,
		format: input.format,
		quality: input.quality,
		clips,
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
	params.push(`x=${alignToX({ align: overlay.textAlign, canvasOffsetX: overlay.canvasOffset.x })}`);
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
		const opacityFilter =
			overlay.opacity < 1
				? `[${startInputIndex}:v]format=rgba,colorchannelmixer=aa=${overlay.opacity}[a${i}];`
				: "";
		const sourceLabel = overlay.opacity < 1 ? `[a${i}]` : `[${startInputIndex}:v]`;
		const xExpr = `${overlay.canvasOffset.x}-overlay_w/2`;
		const yExpr = `${overlay.canvasOffset.y}-overlay_h/2`;
		stages.push(
			`${opacityFilter}${currentLabel}${sourceLabel}overlay=x=${xExpr}:y=${yExpr}:enable='${enableExpr}'${nextLabel}`,
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
	);
	if (includeAudio) {
		args.push("-c:a", audioCodecForFormat(format), "-b:a", audioBitrateForQuality(quality));
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
		args.push(
			"-filter_complex",
			`[0:v]${baseScale}[base];${overlayFilter}`,
		);
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
	);
	if (includeAudio) {
		args.push("-c:a", audioCodecForFormat(format), "-b:a", audioBitrateForQuality(quality));
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

export function buildConcatListFileContents({
	clips,
}: {
	clips: Array<{ localPath: string; durationSeconds: number }>;
}): string {
	return clips
		.map((clip) => `file '${clip.localPath.replace(/'/g, "'\\''")}'`)
		.join("\n");
}
