import {
	DEFAULT_BLEND_MODE,
	DEFAULT_OPACITY,
	DEFAULT_TRANSFORM,
} from "@/constants/timeline-constants";
import { buildDefaultProjectVersionPack } from "@/constants/project-constants";
import { calculateTotalDuration } from "@/lib/timeline";
import { wouldElementOverlap } from "@/lib/timeline/element-utils";
import { buildTextElement } from "@/lib/timeline/element-utils";
import { buildEmptyTrack, getDefaultInsertIndexForTrack } from "@/lib/timeline/track-utils";
import type {
	AddTextOverlayOp,
	CaptionStyleTemplate,
	ClipForgeProjectData,
	InsertBrollOp,
	MakeVersionOp,
	RemoveSilenceOp,
	TimelineDiffAuditEntry,
	TimelineDiffOp,
	TimelineDiffOpSource,
} from "@/types/clipforge";
import type { MediaAsset } from "@/types/assets";
import type { TCanvasSize } from "@/types/project";
import type { TProject } from "@/types/project";
import type {
	ImageElement,
	TextElement,
	TimelineElement,
	TimelineTrack,
	VideoElement,
} from "@/types/timeline";
import { generateUUID } from "@/utils/id";
import { applyCaptionStyleToTextElement, isCaptionTextElement } from "./caption-studio";
import {
	buildDefaultClipForgeProjectData,
	ensureClipForgeProjectData,
} from "./project-data";

const ASPECT_RATIO_PRESETS: Record<"9:16" | "1:1" | "16:9", TCanvasSize> = {
	"9:16": { width: 1080, height: 1920 },
	"1:1": { width: 1080, height: 1080 },
	"16:9": { width: 1920, height: 1080 },
};

interface SegmentLocation {
	trackIndex: number;
	elementIndex: number;
}

export interface TimelineDiffPatch {
	before: TProject;
	after: TProject;
	ops: TimelineDiffOp[];
	auditEntry: TimelineDiffAuditEntry;
}

export function buildTimelineDiffPatch({
	project,
	mediaAssets = [],
	ops,
	source = "manual",
	now = new Date(),
}: {
	project: TProject;
	mediaAssets?: MediaAsset[];
	ops: TimelineDiffOp[];
	source?: TimelineDiffOpSource;
	now?: Date;
}): TimelineDiffPatch {
	const before = structuredClone(ensureClipForgeProjectData({ project }));
	const after = applyTimelineDiffOpsToProject({
		project: before,
		mediaAssets,
		ops,
		source,
		now,
	});
	const auditEntry = after.clipforge.opsAudit.at(-1);

	return {
		before,
		after,
		ops,
		auditEntry:
			auditEntry ??
			({
				id: generateUUID(),
				source,
				createdAt: now,
				ops: [],
			} satisfies TimelineDiffAuditEntry),
	};
}

export function applyTimelineDiffOpsToProject({
	project,
	mediaAssets = [],
	ops,
	source = "manual",
	now = new Date(),
}: {
	project: TProject;
	mediaAssets?: MediaAsset[];
	ops: TimelineDiffOp[];
	source?: TimelineDiffOpSource;
	now?: Date;
}): TProject & { clipforge: ClipForgeProjectData } {
	const nextProject = structuredClone(ensureClipForgeProjectData({ project }));
	const activeScene =
		nextProject.scenes.find((scene) => scene.id === nextProject.currentSceneId) ??
		nextProject.scenes[0];
	if (!activeScene) {
		return nextProject;
	}

	for (const op of ops) {
		switch (op.type) {
			case "REMOVE_SILENCE":
				applyRemoveSilenceOp({ tracks: activeScene.tracks, op, project: nextProject });
				break;
			case "TRIM_CLIP":
				applyTrimClipOp({ tracks: activeScene.tracks, op });
				break;
			case "CUT_RANGE":
				applyCutRangeOp({ tracks: activeScene.tracks, startMs: op.start_ms, endMs: op.end_ms });
				break;
			case "ADD_TEXT_OVERLAY":
				applyAddTextOverlayOp({
					project: nextProject,
					tracks: activeScene.tracks,
					op,
				});
				break;
			case "MOVE_SEGMENT":
				applyMoveSegmentOp({
					tracks: activeScene.tracks,
					segmentId: op.segment_id,
					toMs: op.to_ms,
				});
				break;
			case "SWAP_SEGMENTS":
				applySwapSegmentsOp({ tracks: activeScene.tracks, aId: op.a_id, bId: op.b_id });
				break;
			case "DELETE_SEGMENT":
				applyDeleteSegmentOp({ tracks: activeScene.tracks, segmentId: op.segment_id });
				break;
			case "DUPLICATE_SEGMENT":
				applyDuplicateSegmentOp({
					tracks: activeScene.tracks,
					segmentId: op.segment_id,
					toMs: op.to_ms,
				});
				break;
			case "INSERT_BROLL":
				applyInsertBrollOp({
					tracks: activeScene.tracks,
					op,
					mediaAssets,
				});
				break;
			case "SET_ASPECT_RATIO":
				applySetAspectRatioOp({ project: nextProject, preset: op.preset });
				break;
			case "SET_CAPTION_STYLE":
				applySetCaptionStyleOp({ project: nextProject, tracks: activeScene.tracks, op });
				break;
			case "FIX_CAPTION_TEXT":
				applyFixCaptionTextOp({
					tracks: activeScene.tracks,
					segmentId: op.segment_id,
					from: op.from,
					to: op.to,
				});
				break;
			case "MAKE_VERSION":
				applyMakeVersionOp({ tracks: activeScene.tracks, op });
				break;
		}
	}

	for (const track of activeScene.tracks) {
		track.elements.sort((a, b) => a.startTime - b.startTime);
	}

	nextProject.metadata = {
		...nextProject.metadata,
		duration: calculateTotalDuration({ tracks: activeScene.tracks }),
		updatedAt: now,
	};
	nextProject.clipforge.opsAudit.push({
		id: generateUUID(),
		source,
		createdAt: now,
		ops,
	});

	return nextProject;
}

export function applyTimelineDiffPatch({
	patch,
}: {
	patch: TimelineDiffPatch;
}): TProject {
	return structuredClone(patch.after);
}

export function revertTimelineDiffPatch({
	patch,
}: {
	patch: TimelineDiffPatch;
}): TProject {
	return structuredClone(patch.before);
}

function applyTrimClipOp({
	tracks,
	op,
}: {
	tracks: TimelineTrack[];
	op: Extract<TimelineDiffOp, { type: "TRIM_CLIP" }>;
}): void {
	const location = getSegmentLocationById({ tracks, segmentId: op.clip_id });
	if (!location) return;

	const element = tracks[location.trackIndex].elements[location.elementIndex];
	const sourceDuration = element.duration + element.trimStart + element.trimEnd;
	const nextIn = clamp(op.in_ms, 0, sourceDuration - 1);
	const nextOut = clamp(op.out_ms, 0, sourceDuration - nextIn - 1);
	const nextDuration = sourceDuration - nextIn - nextOut;

	element.trimStart = nextIn;
	element.trimEnd = nextOut;
	element.duration = Math.max(1, nextDuration);
}

function applyCutRangeOp({
	tracks,
	startMs,
	endMs,
}: {
	tracks: TimelineTrack[];
	startMs: number;
	endMs: number;
}): void {
	const cutDuration = endMs - startMs;
	if (cutDuration <= 0) return;

	for (const track of tracks) {
		const nextElements: TimelineElement[] = [];

		for (const element of track.elements) {
			const elementStart = element.startTime;
			const elementEnd = element.startTime + element.duration;

			if (elementEnd <= startMs) {
				nextElements.push(element);
				continue;
			}

			if (elementStart >= endMs) {
				nextElements.push({
					...element,
					startTime: element.startTime - cutDuration,
				});
				continue;
			}

			// Keep left side only.
			if (elementStart < startMs && elementEnd <= endMs) {
				const keptDuration = startMs - elementStart;
				if (keptDuration > 0) {
					nextElements.push({
						...element,
						duration: keptDuration,
						trimEnd: element.trimEnd + (element.duration - keptDuration),
					});
				}
				continue;
			}

			// Keep right side only.
			if (elementStart >= startMs && elementEnd > endMs) {
				const removedHead = endMs - elementStart;
				const keptDuration = elementEnd - endMs;
				if (keptDuration > 0) {
					nextElements.push({
						...element,
						startTime: startMs,
						duration: keptDuration,
						trimStart: element.trimStart + removedHead,
					});
				}
				continue;
			}

			// Keep both sides: split into two elements.
			if (elementStart < startMs && elementEnd > endMs) {
				const leftDuration = startMs - elementStart;
				const rightDuration = elementEnd - endMs;
				const removedHead = endMs - elementStart;

				if (leftDuration > 0) {
					nextElements.push({
						...element,
						duration: leftDuration,
						trimEnd: element.trimEnd + (element.duration - leftDuration),
					});
				}

				if (rightDuration > 0) {
					nextElements.push({
						...element,
						id: generateUUID(),
						startTime: startMs,
						duration: rightDuration,
						trimStart: element.trimStart + removedHead,
					});
				}
			}
		}

		track.elements = nextElements as typeof track.elements;
	}
}

function applyAddTextOverlayOp({
	project,
	tracks,
	op,
}: {
	project: TProject & { clipforge: ClipForgeProjectData };
	tracks: TimelineTrack[];
	op: AddTextOverlayOp;
}): void {
	let targetTrack = tracks.find(
		(track): track is Extract<TimelineTrack, { type: "text" }> =>
			track.type === "text" && track.hidden === false,
	);

	if (!targetTrack) {
		const nextTrack = buildEmptyTrack({
			id: generateUUID(),
			type: "text",
			name: "Text",
		});
		if (nextTrack.type !== "text") {
			return;
		}
		const insertIndex = getDefaultInsertIndexForTrack({
			tracks,
			trackType: "text",
		});
		tracks.splice(insertIndex, 0, nextTrack);
		targetTrack = nextTrack;
	}

	const verticalOffset =
		op.position === "top"
			? -project.settings.canvasSize.height * 0.32
			: op.position === "bottom"
				? project.settings.canvasSize.height * 0.32
				: 0;
	const backgroundColor =
		op.outline || op.background ? "#000000cc" : "transparent";

	const textElement = buildTextElement({
		startTime: Math.max(0, op.start_ms / 1000),
		raw: {
			name: "Chat overlay",
			content: op.text,
			duration: Math.max(0.1, (op.end_ms - op.start_ms) / 1000),
			fontSize: op.size,
			fontFamily: op.font,
			color: op.color,
			background: {
				color: backgroundColor,
				cornerRadius: op.outline || op.background ? 16 : 0,
				paddingX: op.outline || op.background ? 30 : 0,
				paddingY: op.outline || op.background ? 18 : 0,
				offsetX: 0,
				offsetY: 0,
			},
			textAlign: "center",
			fontWeight:
				op.style_id === "bold-center" || op.position === "center"
					? "bold"
					: "normal",
			fontStyle: "normal",
			textDecoration: "none",
			transform: {
				...DEFAULT_TRANSFORM,
				position: {
					x: 0,
					y: verticalOffset,
				},
			},
			opacity: DEFAULT_OPACITY,
			blendMode: DEFAULT_BLEND_MODE,
		},
	});
	if (textElement.type !== "text") {
		return;
	}

	targetTrack.elements.push({
		...textElement,
		id: generateUUID(),
		hidden: false,
	});
}

function applyMoveSegmentOp({
	tracks,
	segmentId,
	toMs,
}: {
	tracks: TimelineTrack[];
	segmentId: string;
	toMs: number;
}): void {
	const location = getSegmentLocationById({ tracks, segmentId });
	if (!location) return;

	const element = tracks[location.trackIndex].elements[location.elementIndex];
	element.startTime = clampTimelineSecondsFromMs(toMs);
}

function applySwapSegmentsOp({
	tracks,
	aId,
	bId,
}: {
	tracks: TimelineTrack[];
	aId: string;
	bId: string;
}): void {
	const aLocation = getSegmentLocationById({ tracks, segmentId: aId });
	const bLocation = getSegmentLocationById({ tracks, segmentId: bId });
	if (!aLocation || !bLocation) return;

	const aElement = tracks[aLocation.trackIndex].elements[aLocation.elementIndex];
	const bElement = tracks[bLocation.trackIndex].elements[bLocation.elementIndex];

	const aStart = aElement.startTime;
	const bStart = bElement.startTime;

	const nextA = { ...aElement, startTime: bStart };
	const nextB = { ...bElement, startTime: aStart };

	tracks[aLocation.trackIndex].elements[aLocation.elementIndex] = nextB;
	tracks[bLocation.trackIndex].elements[bLocation.elementIndex] = nextA;
}

function applyDeleteSegmentOp({
	tracks,
	segmentId,
}: {
	tracks: TimelineTrack[];
	segmentId: string;
}): void {
	const location = getSegmentLocationById({ tracks, segmentId });
	if (!location) return;

	tracks[location.trackIndex].elements.splice(location.elementIndex, 1);
}

function applyDuplicateSegmentOp({
	tracks,
	segmentId,
	toMs,
}: {
	tracks: TimelineTrack[];
	segmentId: string;
	toMs: number;
}): void {
	const location = getSegmentLocationById({ tracks, segmentId });
	if (!location) return;

	const elements = tracks[location.trackIndex].elements as TimelineElement[];
	const element = elements[location.elementIndex];
	elements.push({
		...element,
		id: generateUUID(),
		startTime: clampTimelineSecondsFromMs(toMs),
	});
}

function clampTimelineSecondsFromMs(valueMs: number): number {
	return Math.max(0, valueMs / 1000);
}

function applyInsertBrollOp({
	tracks,
	op,
	mediaAssets,
}: {
	tracks: TimelineTrack[];
	op: InsertBrollOp;
	mediaAssets: MediaAsset[];
}): void {
	const asset = mediaAssets.find((candidate) => candidate.id === op.media_id);
	if (!asset || (asset.type !== "video" && asset.type !== "image")) {
		return;
	}

	const startTime = Math.max(0, op.start_ms / 1000);
	const duration = Math.max(0.001, (op.end_ms - op.start_ms) / 1000);
	const endTime = startTime + duration;

	let targetTrack = tracks.find(
		(track) =>
			track.type === "video" &&
			track.isMain === false &&
			!wouldElementOverlap({
				elements: track.elements,
				startTime,
				endTime,
			}),
	);

	if (!targetTrack) {
		const nextTrack = buildEmptyTrack({
			id: generateUUID(),
			type: "video",
			name: "B-roll",
		});
		const mainTrackIndex = tracks.findIndex(
			(track) => track.type === "video" && track.isMain,
		);
		const insertIndex = mainTrackIndex >= 0 ? mainTrackIndex : 0;
		tracks.splice(insertIndex, 0, nextTrack);
		targetTrack = nextTrack;
	}

	const baseElement = {
		id: generateUUID(),
		name: asset.name,
		duration,
		startTime,
		trimStart: 0,
		trimEnd: 0,
		hidden: false,
		transform: { ...DEFAULT_TRANSFORM },
		opacity: DEFAULT_OPACITY,
		blendMode: DEFAULT_BLEND_MODE,
	};

	if (asset.type === "image") {
		(targetTrack.elements as TimelineElement[]).push({
			...baseElement,
			type: "image",
			mediaId: asset.id,
		} satisfies ImageElement);
		return;
	}

	(targetTrack.elements as TimelineElement[]).push({
		...baseElement,
		type: "video",
		mediaId: asset.id,
		muted: op.mute,
	} satisfies VideoElement);
}

function applySetAspectRatioOp({
	project,
	preset,
}: {
	project: TProject & { clipforge: ClipForgeProjectData };
	preset: "9:16" | "1:1" | "16:9";
}): void {
	const nextCanvasSize = ASPECT_RATIO_PRESETS[preset];
	project.settings = {
		...project.settings,
		canvasSize: nextCanvasSize,
		originalCanvasSize: project.settings.originalCanvasSize ?? project.settings.canvasSize,
		versionPack: buildDefaultProjectVersionPack({
			canvasSize: nextCanvasSize,
		}),
	};
}

function applySetCaptionStyleOp({
	project,
	tracks,
	op,
}: {
	project: TProject & { clipforge: ClipForgeProjectData };
	tracks: TimelineTrack[];
	op: Extract<TimelineDiffOp, { type: "SET_CAPTION_STYLE" }>;
}): void {
	const style: CaptionStyleTemplate = {
		style_id: op.style_id,
		font: op.font,
		size: op.size,
		position: op.position,
		outline: op.outline,
		highlight_mode: op.highlight_mode,
	};

	project.clipforge.captionStylesById[style.style_id] = style;
	project.clipforge.activeCaptionStyleId = style.style_id;

	for (const track of tracks) {
		if (track.type !== "text") continue;
		for (const element of track.elements) {
			if (element.type !== "text" || !isCaptionTextElement(element)) {
				continue;
			}
			const styledElement = applyCaptionStyleToTextElement({
				element,
				style,
				canvasHeight: project.settings.canvasSize.height,
			});
			Object.assign(element, styledElement);
		}
	}
}

function applyFixCaptionTextOp({
	tracks,
	segmentId,
	from,
	to,
}: {
	tracks: TimelineTrack[];
	segmentId: string;
	from: string;
	to: string;
}): void {
	const location = getSegmentLocationById({ tracks, segmentId });
	if (!location) return;

	const element = tracks[location.trackIndex].elements[location.elementIndex];
	if (element.type !== "text") return;

	if (from.length === 0) {
		element.content = to;
		return;
	}

	element.content = element.content.replace(from, to);
}

function applyRemoveSilenceOp({
	tracks,
	op,
	project,
}: {
	tracks: TimelineTrack[];
	op: RemoveSilenceOp;
	project: TProject & { clipforge?: ClipForgeProjectData };
}): void {
	const clipforgeData = project.clipforge ?? buildDefaultClipForgeProjectData();

	for (const track of tracks) {
		const sortedElements = [...track.elements].sort(
			(a, b) => a.startTime - b.startTime,
		);

		for (const element of sortedElements) {
			if (element.type !== "video" && element.type !== "audio") continue;
			if (!("mediaId" in element) || typeof element.mediaId !== "string") continue;

			const metadata = clipforgeData.mediaMetadataById[element.mediaId];
			if (!metadata || metadata.silenceRegions.length === 0) continue;

			const windowStart = element.trimStart;
			const windowEnd = element.trimStart + element.duration;

			let removableTotal = 0;
			for (const region of metadata.silenceRegions) {
				const overlapStart = Math.max(region.start_ms, windowStart);
				const overlapEnd = Math.min(region.end_ms, windowEnd);
				const overlapDuration = overlapEnd - overlapStart;
				if (overlapDuration < op.threshold_ms) continue;
				const removable = Math.max(0, overlapDuration - op.pad_ms * 2);
				removableTotal += removable;
			}

			if (removableTotal <= 0) continue;

			const maxReduction = Math.max(0, element.duration - op.min_keep_ms);
			const reduction = Math.min(maxReduction, removableTotal);
			if (reduction <= 0) continue;

			element.duration = Math.max(op.min_keep_ms, element.duration - reduction);

			for (const peer of track.elements) {
				if (peer.id !== element.id && peer.startTime > element.startTime) {
					peer.startTime = Math.max(0, peer.startTime - reduction);
				}
			}
		}
	}
}

function applyMakeVersionOp({
	tracks,
	op,
}: {
	tracks: TimelineTrack[];
	op: MakeVersionOp;
}): void {
	const totalDuration = calculateTotalDuration({ tracks });
	const targetMs = op.duration_target_s * 1000;
	if (targetMs <= 0 || targetMs >= totalDuration) return;

	applyCutRangeOp({ tracks, startMs: targetMs, endMs: totalDuration });
}

function getSegmentLocationById({
	tracks,
	segmentId,
}: {
	tracks: TimelineTrack[];
	segmentId: string;
}): SegmentLocation | null {
	for (const [trackIndex, track] of tracks.entries()) {
		for (const [elementIndex, element] of track.elements.entries()) {
			if (element.id === segmentId) {
				return { trackIndex, elementIndex };
			}
		}
	}
	return null;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
