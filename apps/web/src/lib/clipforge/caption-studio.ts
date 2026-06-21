import {
	DEFAULT_TEXT_ELEMENT,
	FONT_SIZE_SCALE_REFERENCE,
} from "@/constants/text-constants";
import {
	generateCaptionChunks,
	generateCaptionChunksFromWords,
	getCaptionTemplate,
} from "@/lib/clipforge/caption-generator";
import {
	buildTimelineTranscriptSegments,
	buildTimelineTranscriptWords,
} from "@/lib/clipforge/timeline-transcript";
import { buildEmptyTrack } from "@/lib/timeline/track-utils";
import type { TProject } from "@/types/project";
import type {
	CaptionSegmentView,
	CaptionStyleTemplate,
} from "@/types/clipforge";
import type { CaptionLineBreakOptions } from "@/lib/clipforge/caption-generator";
import type { TextElement, TextTrack } from "@/types/timeline";
import { generateUUID } from "@/utils/id";

const DEFAULT_CAPTION_OPTIONS: CaptionLineBreakOptions = {
	maxCharsPerLine: 30,
	maxLines: 2,
	minDisplaySeconds: 0.85,
	maxWordsPerChunk: 10,
};

export function isCaptionTextElement(
	element: TextElement | { type: string; role?: string | null },
): element is TextElement {
	return element.type === "text" && (element.role ?? "text") === "caption";
}

export function adoptLegacyCaptionTracks({
	project,
}: {
	project: TProject;
}): TProject {
	if (!project.clipforge) {
		return project;
	}

	let changed = false;
	const nextScenes = project.scenes.map((scene) => {
		const existingCaptionTrack = scene.tracks.find(
			(track) =>
				track.type === "text" &&
				track.elements.some(
					(element) => element.type === "text" && isCaptionTextElement(element),
				),
		);
		if (existingCaptionTrack) {
			if (
				project.clipforge?.captionTrackIdsBySceneId?.[scene.id] ===
				existingCaptionTrack.id
			) {
				return scene;
			}
			changed = true;
			return scene;
		}

		const candidates = scene.tracks
			.filter((track): track is TextTrack => track.type === "text")
			.filter(isHighConfidenceLegacyCaptionTrack);
		if (candidates.length !== 1) {
			return scene;
		}

		const candidateId = candidates[0]?.id;
		if (!candidateId) {
			return scene;
		}

		changed = true;
		return {
			...scene,
			tracks: scene.tracks.map((track) => {
				if (track.id !== candidateId || track.type !== "text") {
					return track;
				}
				return {
					...track,
					elements: track.elements.map((element) =>
						element.type !== "text"
							? element
							: {
									...element,
									role: "caption" as const,
									captionTiming: element.captionTiming ?? null,
								},
					),
				};
			}),
		};
	});

	if (!changed) {
		return project;
	}

	const captionTrackIdsBySceneId = {
		...project.clipforge.captionTrackIdsBySceneId,
	};
	for (const scene of nextScenes) {
		const captionTrack = scene.tracks.find(
			(track) =>
				track.type === "text" &&
				track.elements.some(
					(element) => element.type === "text" && isCaptionTextElement(element),
				),
		);
		if (captionTrack) {
			captionTrackIdsBySceneId[scene.id] = captionTrack.id;
		}
	}

	return {
		...project,
		scenes: nextScenes,
		clipforge: {
			...project.clipforge,
			captionTrackIdsBySceneId,
		},
	};
}

export function resolveSceneCaptionTrackId({
	project,
	sceneId,
}: {
	project: TProject;
	sceneId: string;
}): string | null {
	const scene =
		project.scenes.find((candidate) => candidate.id === sceneId) ?? null;
	if (!scene) return null;

	const mappedTrackId =
		project.clipforge?.captionTrackIdsBySceneId?.[sceneId] ?? null;
	if (mappedTrackId) {
		const mappedTrack = scene.tracks.find(
			(track) => track.id === mappedTrackId,
		);
		if (
			mappedTrack?.type === "text" &&
			mappedTrack.elements.some(
				(element) => element.type === "text" && isCaptionTextElement(element),
			)
		) {
			return mappedTrackId;
		}
	}

	const inferred = scene.tracks.find(
		(track) =>
			track.type === "text" &&
			track.elements.some(
				(element) => element.type === "text" && isCaptionTextElement(element),
			),
	);
	return inferred?.id ?? null;
}

export function ensureSceneCaptionTrack({
	project,
	sceneId,
}: {
	project: TProject;
	sceneId: string;
}): { project: TProject; sceneId: string; trackId: string } {
	const sceneIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
	if (sceneIndex < 0) {
		throw new Error("Active scene not found.");
	}
	const existingTrackId = resolveSceneCaptionTrackId({ project, sceneId });
	if (existingTrackId) {
		return {
			project: syncCaptionTrackId({
				project,
				sceneId,
				trackId: existingTrackId,
			}),
			sceneId,
			trackId: existingTrackId,
		};
	}

	const nextTrackId = generateUUID();
	const scene = project.scenes[sceneIndex];
	const captionTrack = {
		...buildEmptyTrack({ id: nextTrackId, type: "text" }),
		id: nextTrackId,
		name: "Captions",
		elements: [],
	};
	const nextScene = {
		...scene,
		tracks: [captionTrack, ...scene.tracks],
		updatedAt: new Date(),
	};
	const scenes = project.scenes.map((candidate, index) =>
		index === sceneIndex ? nextScene : candidate,
	);
	return {
		project: syncCaptionTrackId({
			project: { ...project, scenes },
			sceneId,
			trackId: nextTrackId,
		}),
		sceneId,
		trackId: nextTrackId,
	};
}

export function clearSceneCaptionsFromProject({
	project,
	sceneId,
}: {
	project: TProject;
	sceneId: string;
}): TProject {
	const trackId = resolveSceneCaptionTrackId({ project, sceneId });
	if (!trackId) {
		return project;
	}
	return updateSceneCaptionTrack({
		project,
		sceneId,
		updateElements: () => [],
	});
}

export function buildSceneCaptionSegments({
	project,
}: {
	project: TProject;
}): CaptionSegmentView[] {
	const scene =
		project.scenes.find(
			(candidate) => candidate.id === project.currentSceneId,
		) ??
		project.scenes[0] ??
		null;
	if (!scene) return [];

	return scene.tracks
		.flatMap((track) => {
			if (track.type !== "text") return [];
			return track.elements
				.filter((element): element is TextElement =>
					isCaptionTextElement(element),
				)
				.map((element) => ({
					elementId: element.id,
					trackId: track.id,
					text: element.content,
					startTime: element.startTime,
					duration: element.duration,
					endTime: element.startTime + element.duration,
					words: element.captionTiming?.words ?? null,
				}));
		})
		.sort(
			(a, b) =>
				a.startTime - b.startTime || a.elementId.localeCompare(b.elementId),
		);
}

export function applyCaptionStyleToTextElement({
	element,
	style,
	canvasHeight,
	sizeMultiplier = 1,
}: {
	element: TextElement;
	style: CaptionStyleTemplate;
	canvasHeight: number;
	sizeMultiplier?: number;
}): TextElement {
	const positionY =
		style.position === "bottom" ? Math.round(canvasHeight * 0.35) : 0;
	// style.size is intended output pixels; convert to internal fontSize units.
	// Renderer does: fontSize * (canvasHeight / FONT_SIZE_SCALE_REFERENCE) = output pixels.
	// So: fontSize = style.size * (FONT_SIZE_SCALE_REFERENCE / canvasHeight).
	const effectiveSizePx =
		style.size * Math.max(0.5, Math.min(3, sizeMultiplier));
	const fontSize = effectiveSizePx * (FONT_SIZE_SCALE_REFERENCE / canvasHeight);

	// Outline = text stroke (ctx.strokeText), NOT a background box.
	// Stroke width ~25% of font size gives a thick CapCut-like outlined look.
	const strokeOutline = style.outline
		? {
				color: style.outline_color ?? "#000000",
				width: fontSize * 0.25,
			}
		: null;

	return {
		...element,
		role: "caption",
		fontFamily: style.font,
		fontSize,
		color: style.color ?? "#ffffff",
		fontWeight:
			style.font_weight ??
			(style.style_id === "bold-center" || style.position === "center"
				? "bold"
				: "normal"),
		fontStyle: style.font_style ?? "normal",
		textAlign: "center",
		stroke: strokeOutline,
		background: {
			...element.background,
			color: "transparent",
			cornerRadius: 0,
			paddingX: 0,
			paddingY: 0,
		},
		transform: {
			...element.transform,
			position: {
				...element.transform.position,
				y: positionY,
			},
		},
	};
}

export function createCaptionTextElements({
	project,
	styleId,
	options = DEFAULT_CAPTION_OPTIONS,
	transcriptWords,
}: {
	project: TProject;
	styleId: string;
	options?: CaptionLineBreakOptions;
	transcriptWords?: Array<{ text: string; start_ms: number; end_ms: number }>;
}): TextElement[] {
	const timelineWords = (
		transcriptWords ?? buildTimelineTranscriptWords({ project })
	).map((word) => ({
		text: word.text,
		startTime: word.start_ms / 1000,
		endTime: word.end_ms / 1000,
	}));
	const chunks =
		timelineWords.length > 0
			? generateCaptionChunksFromWords({ words: timelineWords, options })
			: generateCaptionChunks({
					segments: buildTimelineTranscriptSegments({ project }),
					options,
				});
	const style = getCaptionTemplate({ styleId });
	const canvasHeight = project.settings.canvasSize.height;
	const sizeMultiplier = project.clipforge?.captionSizeMultiplier ?? 1;
	// Word-by-word and word-highlight styles render as ALL CAPS for impact.
	const uppercase = style.highlight_mode === "word";

	return chunks.map((chunk, index) => {
		const base: TextElement = {
			...DEFAULT_TEXT_ELEMENT,
			id: generateUUID(),
			role: "caption",
			captionTiming: chunk.words ? { words: chunk.words } : null,
			name: `Caption ${index + 1}`,
			content: uppercase ? chunk.text.toUpperCase() : chunk.text,
			duration: chunk.duration,
			startTime: chunk.startTime,
		};
		return applyCaptionStyleToTextElement({
			element: base,
			style,
			canvasHeight,
			sizeMultiplier,
		});
	});
}

export function retimeCaptionElement({
	element,
	startTime,
	duration,
}: {
	element: TextElement;
	startTime: number;
	duration: number;
}): TextElement {
	const nextStartTime = Math.max(0, startTime);
	const nextDuration = Math.max(0.05, duration);
	const delta = nextStartTime - element.startTime;
	return {
		...element,
		startTime: nextStartTime,
		duration: nextDuration,
		captionTiming: element.captionTiming
			? {
					words: element.captionTiming.words.map((word) => ({
						...word,
						startTime: word.startTime + delta,
						endTime: word.endTime + delta,
					})),
				}
			: null,
	};
}

export function splitCaptionElement({
	element,
	splitWordIndex,
}: {
	element: TextElement;
	splitWordIndex: number;
}): { first: TextElement; second: TextElement } {
	const words = element.captionTiming?.words ?? [];
	if (words.length < 2) {
		throw new Error("Caption word timing is required to split captions.");
	}
	if (splitWordIndex <= 0 || splitWordIndex >= words.length) {
		throw new Error("Split word index is out of range.");
	}

	const firstWords = words.slice(0, splitWordIndex);
	const secondWords = words.slice(splitWordIndex);
	const firstStart = firstWords[0]?.startTime ?? element.startTime;
	const firstEnd =
		firstWords[firstWords.length - 1]?.endTime ?? element.startTime;
	const secondStart = secondWords[0]?.startTime ?? firstEnd;
	const secondEnd = secondWords[secondWords.length - 1]?.endTime ?? secondStart;

	const first: TextElement = {
		...element,
		content: firstWords.map((word) => word.text).join(" "),
		startTime: firstStart,
		duration: Math.max(0.05, firstEnd - firstStart),
		captionTiming: { words: firstWords },
	};
	const second: TextElement = {
		...element,
		id: generateUUID(),
		name: `${element.name} 2`,
		content: secondWords.map((word) => word.text).join(" "),
		startTime: secondStart,
		duration: Math.max(0.05, secondEnd - secondStart),
		captionTiming: { words: secondWords },
	};

	return { first, second };
}

export function mergeCaptionElements({
	first,
	second,
}: {
	first: TextElement;
	second: TextElement;
}): TextElement {
	const mergedWords =
		first.captionTiming?.words && second.captionTiming?.words
			? [...first.captionTiming.words, ...second.captionTiming.words]
			: null;
	return {
		...first,
		content: `${first.content} ${second.content}`.replace(/\s+/g, " ").trim(),
		startTime: Math.min(first.startTime, second.startTime),
		duration:
			Math.max(
				first.startTime + first.duration,
				second.startTime + second.duration,
			) - Math.min(first.startTime, second.startTime),
		captionTiming: mergedWords ? { words: mergedWords } : null,
	};
}

export function updateSceneCaptionTrack({
	project,
	sceneId,
	updateElements,
}: {
	project: TProject;
	sceneId: string;
	updateElements: (elements: TextElement[]) => TextElement[];
}): TProject {
	const sceneIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
	if (sceneIndex < 0) {
		throw new Error("Active scene not found.");
	}

	const ensured = ensureSceneCaptionTrack({ project, sceneId });
	const nextProject = ensured.project;
	const nextSceneIndex = nextProject.scenes.findIndex(
		(scene) => scene.id === sceneId,
	);
	const scene = nextProject.scenes[nextSceneIndex];
	if (!scene) return nextProject;

	const tracks = scene.tracks.map((track) => {
		if (track.id !== ensured.trackId || track.type !== "text") return track;
		const genericElements = track.elements.filter(
			(element): element is TextElement =>
				element.type === "text" && !isCaptionTextElement(element),
		);
		const captionElements = track.elements.filter(
			(element): element is TextElement =>
				element.type === "text" && isCaptionTextElement(element),
		);
		const nextCaptionElements = updateElements(captionElements)
			.map((element) => ({ ...element, role: "caption" as const }))
			.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
		return {
			...track,
			elements: [...genericElements, ...nextCaptionElements].sort(
				(a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
			),
		};
	});

	const scenes = nextProject.scenes.map((candidate, index) =>
		index === nextSceneIndex
			? { ...candidate, tracks, updatedAt: new Date() }
			: candidate,
	);
	return syncCaptionTrackId({
		project: {
			...nextProject,
			scenes,
			metadata: { ...nextProject.metadata, updatedAt: new Date() },
		},
		sceneId,
		trackId: ensured.trackId,
	});
}

function syncCaptionTrackId({
	project,
	sceneId,
	trackId,
}: {
	project: TProject;
	sceneId: string;
	trackId: string;
}): TProject {
	if (!project.clipforge) return project;
	return {
		...project,
		clipforge: {
			...project.clipforge,
			captionTrackIdsBySceneId: {
				...project.clipforge.captionTrackIdsBySceneId,
				[sceneId]: trackId,
			},
		},
	};
}

function isHighConfidenceLegacyCaptionTrack(track: TextTrack): boolean {
	if (track.elements.length < 2) {
		return false;
	}

	const normalizedTrackName = track.name.trim().toLowerCase();
	let previousEnd = Number.NEGATIVE_INFINITY;
	let allElementNamesLookLikeCaptions = true;
	for (const element of track.elements) {
		if (element.type !== "text") {
			return false;
		}
		const content = element.content.trim();
		const normalizedName = element.name.trim().toLowerCase();
		if (content.length === 0 || content.length > 160) {
			return false;
		}
		if (
			normalizedName.includes("overlay") ||
			normalizedName.includes("title") ||
			normalizedName.includes("cta") ||
			normalizedName.includes("lower third")
		) {
			return false;
		}
		if (!normalizedName.includes("caption")) {
			allElementNamesLookLikeCaptions = false;
		}
		if (element.duration <= 0 || element.duration > 6) {
			return false;
		}
		if (element.startTime + 0.05 < previousEnd) {
			return false;
		}
		previousEnd = Math.max(previousEnd, element.startTime + element.duration);
	}

	const trackNameLooksLikeCaptions =
		normalizedTrackName.includes("caption") ||
		normalizedTrackName.includes("subtitle");

	return trackNameLooksLikeCaptions || allElementNamesLookLikeCaptions;
}
