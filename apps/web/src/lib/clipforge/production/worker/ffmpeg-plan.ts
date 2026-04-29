import type {
	RenderGraphInput,
	RenderGraphMediaRef,
} from "@/lib/clipforge/production/render-graph";
import type { ExportFormat, ExportQuality } from "@/types/export";
import type { TScene, VideoTrack } from "@/types/timeline";

export type FfmpegPlan =
	| {
			kind: "black-video";
			canvasSize: { width: number; height: number };
			durationSeconds: number;
			includeAudio: boolean;
			format: ExportFormat;
			quality: ExportQuality;
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
}: {
	scenes: TScene[];
}): string[] {
	const reasons = new Set<string>();
	let imageCount = 0;
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
					if (element.type === "image") imageCount += 1;
					if (element.type === "video") {
						if (element.transitionIn) transitionCount += 1;
						if (element.keyframes) keyframeCount += 1;
						if (element.effects && element.effects.length > 0) effectCount += 1;
						if (element.adjustments) adjustmentCount += 1;
					}
				}
			}
			if (track.type === "text") textCount += track.elements.length;
			if (track.type === "sticker") stickerCount += track.elements.length;
			if (track.type === "audio") audioCount += track.elements.length;
		}
	}

	if (imageCount > 0) reasons.add(`${imageCount} image element(s) skipped`);
	if (textCount > 0) reasons.add(`${textCount} text/caption element(s) skipped`);
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

export function buildFfmpegPlan({
	input,
}: {
	input: RenderGraphInput;
}): FfmpegPlan {
	const scenes = input.project.scenes ?? [];
	const reasons = summarizeUnsupportedFeatures({ scenes });
	const collected = collectMainVideoClips({ scenes });

	if (collected.supportedVideoClips.length === 0) {
		return {
			kind: "black-video",
			canvasSize: input.canvasSize,
			durationSeconds: Math.max(1, input.durationSeconds || 1),
			includeAudio: input.includeAudio,
			format: input.format,
			quality: input.quality,
		};
	}

	const mediaRefIndex = new Map<string, RenderGraphMediaRef>();
	for (const ref of input.mediaRefs) {
		mediaRefIndex.set(ref.mediaId, ref);
	}

	const missingMediaIds: string[] = [];
	const clips: Extract<FfmpegPlan, { kind: "video-concat" }>["clips"] = [];
	for (const clip of collected.supportedVideoClips) {
		const ref = mediaRefIndex.get(clip.mediaId);
		if (!ref || !ref.cloudStorageKey) {
			missingMediaIds.push(clip.mediaId);
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

	if (missingMediaIds.length > 0) {
		return {
			kind: "unsupported",
			reasons: [
				...reasons,
				`Missing cloud media for ${missingMediaIds.length} clip(s): ${missingMediaIds.join(", ")}. Upload media to cloud first.`,
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

export function buildBlackVideoFfmpegInvocation({
	plan,
	outputPath,
	supportSummary,
}: {
	plan: Extract<FfmpegPlan, { kind: "black-video" }>;
	outputPath: string;
	supportSummary: string[];
}): FfmpegInvocation {
	const { canvasSize, durationSeconds, includeAudio, format, quality } = plan;
	const args: string[] = [
		"-y",
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=${canvasSize.width}x${canvasSize.height}:d=${durationSeconds}`,
	];
	if (includeAudio) {
		args.push(
			"-f",
			"lavfi",
			"-i",
			`anullsrc=channel_layout=stereo:sample_rate=48000`,
			"-shortest",
		);
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
	}
	args.push(outputPath);
	return {
		args,
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
}: {
	plan: Extract<FfmpegPlan, { kind: "video-concat" }>;
	outputPath: string;
	concatListPath: string;
	supportSummary: string[];
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
		"-vf",
		`scale=${canvasSize.width}:${canvasSize.height}:force_original_aspect_ratio=decrease,pad=${canvasSize.width}:${canvasSize.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
		"-c:v",
		videoCodecForFormat(format),
		"-b:v",
		videoBitrateForQuality(quality),
		"-pix_fmt",
		"yuv420p",
	];
	if (includeAudio) {
		args.push("-c:a", audioCodecForFormat(format), "-b:a", audioBitrateForQuality(quality));
	} else {
		args.push("-an");
	}
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
