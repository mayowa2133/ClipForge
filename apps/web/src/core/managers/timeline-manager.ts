import type { EditorCore } from "@/core";
import type {
	SceneBeatMarker,
	TrackType,
	TimelineTrack,
	TimelineElement,
	ClipboardItem,
	OverlayMeta,
	OverlayStyleVariantId,
	OverlayTextSlot,
	SocialOverlayPresetId,
	TextElement,
	StickerElement,
	ImageElement,
} from "@/types/timeline";
import type { ComponentTemplate } from "@/types/templates";
import { calculateTotalDuration } from "@/lib/timeline";
import { useTimelineStore } from "@/stores/timeline-store";
import {
	AddTrackCommand,
	RemoveTrackCommand,
	ToggleTrackMuteCommand,
	UpdateTrackVolumeCommand,
	ToggleTrackVisibilityCommand,
	InsertElementCommand,
	UpdateElementTrimCommand,
	UpdateElementDurationCommand,
	DeleteElementsCommand,
	DuplicateElementsCommand,
	ToggleElementsVisibilityCommand,
	ToggleElementsMutedCommand,
	UpdateElementCommand,
	SplitElementsCommand,
	PasteCommand,
	UpdateElementStartTimeCommand,
	MoveElementCommand,
	TracksSnapshotCommand,
	ReplaceElementMediaCommand,
	UpdateElementPlaybackRateCommand,
	SeparateAudioCommand,
	InsertFreezeFrameCommand,
	SetElementAdjustmentsCommand,
	ResetElementAdjustmentsCommand,
	ApplyElementFilterPresetCommand,
	AddElementEffectCommand,
	UpdateElementEffectCommand,
	RemoveElementEffectCommand,
	MoveElementEffectCommand,
	ClearElementFinishingCommand,
	SetElementTransitionInCommand,
	ClearElementTransitionInCommand,
	SetElementKeyframeCommand,
	RemoveElementKeyframeCommand,
	ClearElementKeyframesCommand,
} from "@/lib/commands/timeline";
import {
	BatchCommand,
	PreviewTracker,
	UpsertCreatorTemplateCommand,
} from "@/lib/commands";
import type { InsertElementParams } from "@/lib/commands/timeline/element/insert-element";
import {
	canPreserveElementSourceSpan,
	clampPlaybackRate,
	getElementSourceTimeAtTimelineTime,
} from "@/lib/timeline/manual-editing";
import {
	clampTransitionDuration,
	findAdjacentVisualIncomingTransitionTarget,
	getBasePropertyValue,
	getElementLocalTime,
	getElementPlaybackRate,
	isVisualElementWithMotion,
	isTransitionPreset,
	removePropertyKeyframeValue,
	clampVisualAdjustments,
	normalizeVisualEffects,
	createDefaultEffect,
	applyFilterPreset,
	type FilterPresetId,
	type FinishableVisualElement,
	type AnimatableVisualProperty,
	type GraphicsMotionPresetId,
	type GraphicsPresetId,
	applyOverlayStyleVariantToElements,
	buildGraphicsPresetElements,
	buildSocialOverlayPresetElements,
	applyGraphicsMotionPreset,
	resolveProjectOverlayDefaults,
	buildComponentTemplatePayload,
	instantiateTemplateElements,
} from "@/lib/timeline";
import { mediaSupportsAudio } from "@/lib/media/media-utils";
import {
	buildAutoMontageWindows,
	quantizeTimeToMarkers,
	resolveSceneBeatMarkers,
} from "@/lib/media/beat-analysis";
import type { VisualAdjustments, VisualEffect, VisualEffectKind } from "@/types/timeline";
import { generateUUID } from "@/utils/id";

export class TimelineManager {
	private listeners = new Set<() => void>();
	private previewTracker = new PreviewTracker<TimelineTrack[]>();

	constructor(private editor: EditorCore) {}

	addTrack({ type, index }: { type: TrackType; index?: number }): string {
		const command = new AddTrackCommand(type, index);
		this.editor.command.execute({ command });
		return command.getTrackId();
	}

	removeTrack({ trackId }: { trackId: string }): void {
		const command = new RemoveTrackCommand(trackId);
		this.editor.command.execute({ command });
	}

	insertElement({ element, placement }: InsertElementParams): void {
		const command = new InsertElementCommand({ element, placement });
		this.editor.command.execute({ command });
	}

	updateElementTrim({
		elementId,
		trimStart,
		trimEnd,
		pushHistory = true,
	}: {
		elementId: string;
		trimStart: number;
		trimEnd: number;
		pushHistory?: boolean;
	}): void {
		const command = new UpdateElementTrimCommand(elementId, trimStart, trimEnd);
		if (pushHistory) {
			this.editor.command.execute({ command });
		} else {
			command.execute();
		}
	}

	updateElementDuration({
		trackId,
		elementId,
		duration,
		pushHistory = true,
	}: {
		trackId: string;
		elementId: string;
		duration: number;
		pushHistory?: boolean;
	}): void {
		const command = new UpdateElementDurationCommand(
			trackId,
			elementId,
			duration,
		);
		if (pushHistory) {
			this.editor.command.execute({ command });
		} else {
			command.execute();
		}
	}

	updateElementStartTime({
		elements,
		startTime,
	}: {
		elements: { trackId: string; elementId: string }[];
		startTime: number;
	}): void {
		const command = new UpdateElementStartTimeCommand(elements, startTime);
		this.editor.command.execute({ command });
	}

	setBeatSnapping({ enabled }: { enabled: boolean }): void {
		useTimelineStore.getState().setBeatSnapping(enabled);
	}

	setBeatMarkerVisibility({ enabled }: { enabled: boolean }): void {
		useTimelineStore.getState().setBeatMarkerVisibility(enabled);
	}

	getSceneBeatMarkers(): {
		sourceMediaId: string | null;
		bpm: number | null;
		markers: SceneBeatMarker[];
	} {
		return this.editor.audio.getSceneBeatMarkers();
	}

	quantizeSelectedClipsToBeats({
		mode,
	}: {
		mode: "clip-starts" | "cuts-only";
	}): void {
		const selectedElements = this.editor.selection.getSelectedElements();
		if (selectedElements.length === 0) {
			throw new Error("Select one or more clips to quantize.");
		}

		const { markers } = this.editor.audio.getSceneBeatMarkers();
		if (markers.length === 0) {
			throw new Error("Analyze a music bed before quantizing to beats.");
		}

		const selectedSet = new Set(
			selectedElements.map((element) => `${element.trackId}:${element.elementId}`),
		);
		const beforeTracks = this.getTracks();
		const afterTracks = beforeTracks.map((track) => {
			const sortedTrackElements = [...track.elements].sort(
				(a, b) => a.startTime - b.startTime,
			);
			return {
				...track,
				elements: track.elements.map((element) => {
					const key = `${track.id}:${element.id}`;
					if (!selectedSet.has(key)) {
						return element;
					}
					if (mode === "cuts-only") {
						const isFirstOnTrack =
							sortedTrackElements.findIndex((candidate) => candidate.id === element.id) === 0;
						if (isFirstOnTrack) {
							return element;
						}
					}
					const nextStartTime = quantizeTimeToMarkers({
						time: element.startTime,
						markers,
					});
					return {
						...element,
						startTime: Math.max(0, nextStartTime),
					};
				}),
			} as TimelineTrack;
		}) as TimelineTrack[];

		this.editor.command.execute({
			command: new TracksSnapshotCommand(beforeTracks, afterTracks),
		});
	}

	splitSelectedClipsOnBeats(): void {
		const selectedElements = this.editor.selection.getSelectedElements();
		if (selectedElements.length === 0) {
			throw new Error("Select one or more clips to split on beats.");
		}

		const { markers } = this.editor.audio.getSceneBeatMarkers();
		if (markers.length === 0) {
			throw new Error("Analyze a music bed before splitting on beats.");
		}

		const selectedSet = new Set(
			selectedElements.map((element) => `${element.trackId}:${element.elementId}`),
		);
		const beforeTracks = this.getTracks();
		const afterTracks = beforeTracks.map((track) => {
			return {
				...track,
				elements: track.elements.flatMap((element) => {
					const key = `${track.id}:${element.id}`;
					if (!selectedSet.has(key)) {
						return [element];
					}
					if (
						element.type === "text" ||
						element.type === "sticker" ||
						element.duration <= 0
					) {
						return [element];
					}

					const clipStart = element.startTime;
					const clipEnd = element.startTime + element.duration;
					const splitMarkers = markers
						.filter(
							(marker) =>
								marker.time > clipStart + 1e-4 && marker.time < clipEnd - 1e-4,
						)
						.map((marker) => marker.time);

					if (splitMarkers.length === 0) {
						return [element];
					}

					const boundaries = [clipStart, ...splitMarkers, clipEnd];
					const playbackRate = getElementPlaybackRate({ element });
					const segments: TimelineElement[] = [];

					for (let index = 0; index < boundaries.length - 1; index += 1) {
						const segmentStart = boundaries[index];
						const segmentEnd = boundaries[index + 1];
						const segmentDuration = segmentEnd - segmentStart;
						if (segmentDuration <= 1e-4) {
							continue;
						}
						const elapsedTimeline = segmentStart - clipStart;
						const elapsedSource = elapsedTimeline * playbackRate;
						segments.push({
							...element,
							id: index === 0 ? element.id : generateUUID(),
							startTime: segmentStart,
							duration: segmentDuration,
							trimStart: element.trimStart + elapsedSource,
							trimEnd:
								element.trimStart +
								elapsedSource +
								segmentDuration * playbackRate,
						});
					}

					return segments.length > 0 ? segments : [element];
				}),
			} as TimelineTrack;
		}) as TimelineTrack[];

		this.editor.command.execute({
			command: new TracksSnapshotCommand(beforeTracks, afterTracks),
		});
	}

	buildAutoMontageFromSelection({
		musicMediaId,
		strategy,
		beatDivision,
	}: {
		musicMediaId: string;
		strategy: "one-cut-per-beat" | "one-cut-per-two-beats";
		beatDivision: number;
	}): void {
		const selectedElements = this.editor.selection.getSelectedElements();
		const selectedVisuals = this.getElementsWithTracks({
			elements: selectedElements,
		})
			.filter(({ element }) => element.type === "video" || element.type === "image")
			.sort((a, b) => a.element.startTime - b.element.startTime);

		if (selectedVisuals.length === 0) {
			throw new Error("Select visual clips before building an auto montage.");
		}

		const { markers } = resolveSceneBeatMarkers({
			tracks: this.getTracks(),
			selectedBeatSourceMediaId: musicMediaId,
			mediaAssets: this.editor.media.getAssets(),
		});
		if (markers.length < 2) {
			throw new Error("Analyze a music bed with visible beats before building a montage.");
		}

		const effectiveDivision =
			strategy === "one-cut-per-beat"
				? 1
				: strategy === "one-cut-per-two-beats"
					? 2
					: Math.max(1, beatDivision);
		const windows = buildAutoMontageWindows({
			markers,
			beatDivision: effectiveDivision,
		});
		if (windows.length < selectedVisuals.length) {
			throw new Error("Not enough beat windows are available for the selected clips.");
		}

		const beforeTracks = this.getTracks();
		const windowByElementId = new Map(
			selectedVisuals.map(({ element }, index) => [element.id, windows[index]]),
		);
		const afterTracks = beforeTracks.map((track) => ({
			...track,
			elements: track.elements.map((element) => {
				const window = windowByElementId.get(element.id);
				if (!window) return element;
				if (element.duration + 1e-4 < window.duration) {
					throw new Error("One or more selected clips are too short for the chosen beat density.");
				}
				return {
					...element,
					startTime: window.startTime,
					duration: window.duration,
				};
			}),
		})) as TimelineTrack[];

		this.editor.command.execute({
			command: new TracksSnapshotCommand(beforeTracks, afterTracks),
		});
	}

	moveElement({
		sourceTrackId,
		targetTrackId,
		elementId,
		newStartTime,
		createTrack,
	}: {
		sourceTrackId: string;
		targetTrackId: string;
		elementId: string;
		newStartTime: number;
		createTrack?: { type: TrackType; index: number };
	}): void {
		const command = new MoveElementCommand(
			sourceTrackId,
			targetTrackId,
			elementId,
			newStartTime,
			createTrack,
		);
		this.editor.command.execute({ command });
	}

	replaceElementMedia({
		trackId,
		elementId,
		mediaId,
	}: {
		trackId: string;
		elementId: string;
		mediaId: string;
	}): void {
		const track = this.getTrackById({ trackId });
		const element = track?.elements.find((candidate) => candidate.id === elementId);
		const mediaAsset = this.editor.media.getAssets().find((asset) => asset.id === mediaId);

		if (!track || !element || !mediaAsset) {
			throw new Error("Target element or replacement media could not be found.");
		}

		if (element.type === "video" && mediaAsset.type !== "video") {
			throw new Error("Video clips can only be replaced with video media.");
		}
		if (element.type === "image" && mediaAsset.type !== "image") {
			throw new Error("Image clips can only be replaced with image media.");
		}
		if (element.type === "audio") {
			const compatibleAudio =
				mediaAsset.type === "audio" ||
				(mediaAsset.type === "video" && mediaSupportsAudio({ media: mediaAsset }));
			if (!compatibleAudio) {
				throw new Error("Audio clips require replacement media with a valid audio track.");
			}
		}

		if (
			!canPreserveElementSourceSpan({
				element,
				replacementDuration: mediaAsset.duration ?? 0,
			})
		) {
			throw new Error(
				"Replacement media is too short to preserve the existing trim and duration.",
			);
		}

		const command = new ReplaceElementMediaCommand(trackId, elementId, mediaAsset);
		this.editor.command.execute({ command });
	}

	updateElementPlaybackRate({
		trackId,
		elementId,
		playbackRate,
		ripple,
	}: {
		trackId: string;
		elementId: string;
		playbackRate: number;
		ripple: boolean;
	}): void {
		const command = new UpdateElementPlaybackRateCommand(
			trackId,
			elementId,
			clampPlaybackRate({ playbackRate }),
			ripple,
		);
		this.editor.command.execute({ command });
	}

	separateAudio({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): void {
		const track = this.getTrackById({ trackId });
		const element = track?.elements.find((candidate) => candidate.id === elementId);
		if (!element || element.type !== "video") {
			throw new Error("Separate Audio requires a selected video clip.");
		}

		const mediaAsset = this.editor.media.getAssets().find((asset) => asset.id === element.mediaId);
		if (!mediaSupportsAudio({ media: mediaAsset })) {
			throw new Error("The selected video clip does not have a decodable audio track.");
		}

		const command = new SeparateAudioCommand(trackId, elementId);
		this.editor.command.execute({ command });
	}

	async insertFreezeFrame({
		trackId,
		elementId,
		atTime,
		duration,
		ripple,
	}: {
		trackId: string;
		elementId: string;
		atTime: number;
		duration: number;
		ripple: boolean;
	}): Promise<void> {
		const track = this.getTrackById({ trackId });
		const element = track?.elements.find((candidate) => candidate.id === elementId);
		if (!element || element.type !== "video") {
			throw new Error("Freeze Frame requires a selected video clip.");
		}

		const clipEnd = element.startTime + element.duration;
		if (atTime < element.startTime || atTime > clipEnd) {
			throw new Error("Playhead must be inside the selected clip to create a freeze frame.");
		}

		const sourceTime = getElementSourceTimeAtTimelineTime({
			element,
			time: Math.min(clipEnd, Math.max(element.startTime, atTime)),
		});
		const freezeAsset = await this.editor.media.createDerivedFreezeFrameAsset({
			sourceMediaId: element.mediaId,
			sourceTime,
		});
		if (!freezeAsset) {
			throw new Error("Failed to create a freeze-frame asset from the selected clip.");
		}

		const command = new InsertFreezeFrameCommand(
			trackId,
			elementId,
			freezeAsset.id,
			freezeAsset.name,
			atTime,
			duration,
			ripple,
		);
		this.editor.command.execute({ command });
	}

	setElementTransitionIn({
		trackId,
		elementId,
		preset,
		duration,
	}: {
		trackId: string;
		elementId: string;
		preset: string;
		duration: number;
	}): void {
		if (!isTransitionPreset(preset)) {
			throw new Error("Unsupported transition preset.");
		}

		const track = this.getTrackById({ trackId });
		const fps = this.editor.project.getActive()?.settings.fps ?? 30;
		const adjacency = track
			? findAdjacentVisualIncomingTransitionTarget({
					track,
					elementId,
					fps,
			  })
			: null;
		if (!adjacency) {
			throw new Error(
				"Transitions require an adjacent visual clip immediately before the selected clip.",
			);
		}

		const transitionDuration = clampTransitionDuration({
			duration,
			currentDuration: adjacency.current.duration,
			previousDuration: adjacency.previous.duration,
		});

		const command = new SetElementTransitionInCommand(trackId, elementId, {
			preset,
			duration: transitionDuration,
		});
		this.editor.command.execute({ command });
	}

	clearElementTransitionIn({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): void {
		const command = new ClearElementTransitionInCommand(trackId, elementId);
		this.editor.command.execute({ command });
	}

	setElementAdjustments({
		trackId,
		elementId,
		adjustments,
	}: {
		trackId: string;
		elementId: string;
		adjustments: Partial<VisualAdjustments> | null;
	}): void {
		const element = this.getFinishableElement({ trackId, elementId });
		if (!element) {
			throw new Error("Adjustments only apply to video and image clips.");
		}
		const nextAdjustments = clampVisualAdjustments({ adjustments });
		const command = new SetElementAdjustmentsCommand(
			trackId,
			elementId,
			Object.values(nextAdjustments).every((value) => Math.abs(value) < 1e-6)
				? null
				: nextAdjustments,
		);
		this.editor.command.execute({ command });
	}

	resetElementAdjustments({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): void {
		const element = this.getFinishableElement({ trackId, elementId });
		if (!element) {
			throw new Error("Adjustments only apply to video and image clips.");
		}
		const command = new ResetElementAdjustmentsCommand(trackId, elementId);
		this.editor.command.execute({ command });
	}

	applyElementFilterPreset({
		trackId,
		elementId,
		presetId,
	}: {
		trackId: string;
		elementId: string;
		presetId: FilterPresetId;
	}): void {
		const element = this.getFinishableElement({ trackId, elementId });
		if (!element) {
			throw new Error("Filters only apply to video and image clips.");
		}
		const preset = applyFilterPreset({ presetId });
		const command = new ApplyElementFilterPresetCommand(
			trackId,
			elementId,
			preset.adjustments,
			preset.effects,
		);
		this.editor.command.execute({ command });
	}

	addElementEffect({
		trackId,
		elementId,
		kind,
	}: {
		trackId: string;
		elementId: string;
		kind: VisualEffectKind;
	}): void {
		const element = this.getFinishableElement({ trackId, elementId });
		if (!element) {
			throw new Error("Effects only apply to video and image clips.");
		}
		if ((element.effects ?? []).some((effect) => effect.kind === kind)) {
			throw new Error("Only one effect of each kind can be added to a clip.");
		}
		if ((element.effects ?? []).length >= 3) {
			throw new Error("A clip can have at most three effects in M34.");
		}
		const command = new AddElementEffectCommand(
			trackId,
			elementId,
			createDefaultEffect({ kind }),
		);
		this.editor.command.execute({ command });
	}

	updateElementEffect({
		trackId,
		elementId,
		effectId,
		updates,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		updates: Partial<VisualEffect>;
	}): void {
		const element = this.getFinishableElement({ trackId, elementId });
		if (!element) {
			throw new Error("Effects only apply to video and image clips.");
		}
		if (!(element.effects ?? []).some((effect) => effect.id === effectId)) {
			throw new Error("The requested effect could not be found on this clip.");
		}
		const nextEffects =
			normalizeVisualEffects({
				effects: (element.effects ?? []).map((effect) =>
					effect.id === effectId ? ({ ...effect, ...updates } as VisualEffect) : effect,
				),
			}) ?? [];
		const nextEffect = nextEffects.find((effect) => effect.id === effectId);
		if (!nextEffect) {
			throw new Error("The requested effect could not be normalized.");
		}
		const command = new UpdateElementEffectCommand(trackId, elementId, effectId, nextEffect);
		this.editor.command.execute({ command });
	}

	removeElementEffect({
		trackId,
		elementId,
		effectId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
	}): void {
		const element = this.getFinishableElement({ trackId, elementId });
		if (!element) {
			throw new Error("Effects only apply to video and image clips.");
		}
		const command = new RemoveElementEffectCommand(trackId, elementId, effectId);
		this.editor.command.execute({ command });
	}

	moveElementEffect({
		trackId,
		elementId,
		effectId,
		toIndex,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		toIndex: number;
	}): void {
		const element = this.getFinishableElement({ trackId, elementId });
		if (!element) {
			throw new Error("Effects only apply to video and image clips.");
		}
		const command = new MoveElementEffectCommand(trackId, elementId, effectId, toIndex);
		this.editor.command.execute({ command });
	}

	clearElementFinishing({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): void {
		const element = this.getFinishableElement({ trackId, elementId });
		if (!element) {
			throw new Error("Finishing only applies to video and image clips.");
		}
		const command = new ClearElementFinishingCommand(trackId, elementId);
		this.editor.command.execute({ command });
	}

	setElementKeyframe({
		trackId,
		elementId,
		property,
		time,
		value,
	}: {
		trackId: string;
		elementId: string;
		property: AnimatableVisualProperty;
		time: number;
		value: number;
	}): void {
		const track = this.getTrackById({ trackId });
		const element = track?.elements.find((candidate) => candidate.id === elementId);
		if (!element || !isVisualElementWithMotion(element)) {
			throw new Error("Only visual elements support keyframes.");
		}
		if (!Number.isFinite(time) || !Number.isFinite(value)) {
			throw new Error("Keyframe time and value must be finite numbers.");
		}
		const localTime = getElementLocalTime({ element, time });
		const command = new SetElementKeyframeCommand(
			trackId,
			elementId,
			property,
			localTime,
			value,
		);
		this.editor.command.execute({ command });
	}

	removeElementKeyframe({
		trackId,
		elementId,
		property,
		time,
	}: {
		trackId: string;
		elementId: string;
		property: AnimatableVisualProperty;
		time: number;
	}): void {
		const track = this.getTrackById({ trackId });
		const element = track?.elements.find((candidate) => candidate.id === elementId);
		if (!element || !isVisualElementWithMotion(element)) {
			throw new Error("Only visual elements support keyframes.");
		}
		const localTime = getElementLocalTime({ element, time });
		const nextKeyframes = removePropertyKeyframeValue({
			element,
			property,
			localTime,
		});
		if (nextKeyframes === element.keyframes) {
			return;
		}
		const command = new RemoveElementKeyframeCommand(
			trackId,
			elementId,
			property,
			localTime,
		);
		this.editor.command.execute({ command });
	}

	clearElementKeyframes({
		trackId,
		elementId,
		property,
	}: {
		trackId: string;
		elementId: string;
		property?: AnimatableVisualProperty;
	}): void {
		const track = this.getTrackById({ trackId });
		const element = track?.elements.find((candidate) => candidate.id === elementId);
		if (!element || !isVisualElementWithMotion(element)) {
			throw new Error("Only visual elements support keyframes.");
		}
		const command = new ClearElementKeyframesCommand(trackId, elementId, property);
		this.editor.command.execute({ command });
	}

	insertGraphicsPreset({
		presetId,
		motionPresetId = "fade-up",
		startTime,
		duration,
	}: {
		presetId: GraphicsPresetId;
		motionPresetId?: GraphicsMotionPresetId;
		startTime: number;
		duration?: number;
	}): { trackId: string; elementId: string }[] {
		const project = this.editor.project.getActive();
		const logoMediaId = project?.settings.brandKit?.logoMediaId ?? null;
		const logoAsset =
			logoMediaId
				? this.editor.media
						.getAssets()
						.find((asset) => asset.id === logoMediaId && asset.type === "image")
				: null;
		const elements = buildGraphicsPresetElements({
			project,
			presetId,
			motionPresetId,
			startTime,
			duration,
			logoAsset: logoAsset ? { id: logoAsset.id, name: logoAsset.name } : null,
		});
		const linkedGroupId = elements.length > 1 ? generateUUID() : null;
		const commands = elements.map((element) => {
			const nextElement = linkedGroupId ? { ...element, linkedGroupId } : element;
			return new InsertElementCommand({
				element: nextElement,
				placement: {
					mode: "auto",
					trackType: nextElement.type === "image" ? "video" : "text",
				},
			});
		});
		const command = commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
		const inserted = commands
			.map((insertCommand) => ({
				trackId: insertCommand.getTrackId(),
				elementId: insertCommand.getElementId(),
			}))
			.filter(
				(candidate): candidate is { trackId: string; elementId: string } =>
					typeof candidate.trackId === "string",
			);
		if (inserted.length > 0) {
			this.editor.selection.setSelectedElements({ elements: inserted });
		}
		return inserted;
	}

	saveSelectionAsComponentTemplate({
		name,
		selection,
	}: {
		name: string;
		selection?: { trackId: string; elementId: string }[];
	}): string {
		const selectedElements = selection ?? this.editor.selection.getSelectedElements();
		if (selectedElements.length === 0) {
			throw new Error("Select one or more graphics elements before saving a component.");
		}
		const payload = buildComponentTemplatePayload({
			elementsWithTracks: this.getElementsWithTracks({ elements: selectedElements }),
		});
		const now = new Date();
		const template: ComponentTemplate = {
			id: generateUUID(),
			name,
			kind: "component",
			version: 1,
			thumbnailAssetId: null,
			createdAt: now,
			updatedAt: now,
			payload,
		};
		this.editor.command.execute({
			command: new UpsertCreatorTemplateCommand(template),
		});
		return template.id;
	}

	insertComponentTemplate({
		templateId,
		startTime,
		duration,
	}: {
		templateId: string;
		startTime: number;
		duration?: number;
	}): { trackId: string; elementId: string }[] {
		const template = this.editor.project.findTemplateById({ templateId });
		if (!template || template.kind !== "component") {
			throw new Error("Component template not found.");
		}
		const insertable = instantiateTemplateElements({
			elements: template.payload.elements,
			startTime,
			duration,
		});
		for (const { element } of insertable) {
			if (element.type === "image") {
				const hasMedia = this.editor.media
					.getAssets()
					.some((asset) => asset.id === element.mediaId);
				if (!hasMedia) {
					throw new Error(
						"This template depends on a media asset that is not available in the current workspace.",
					);
				}
			}
		}
		const commands = insertable.map(
			({ element, trackType }) =>
				new InsertElementCommand({
					element,
					placement: {
						mode: "auto",
						trackType,
					},
				}),
		);
		const command = commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
		const inserted = commands
			.map((insertCommand) => ({
				trackId: insertCommand.getTrackId(),
				elementId: insertCommand.getElementId(),
			}))
			.filter(
				(candidate): candidate is { trackId: string; elementId: string } =>
					typeof candidate.trackId === "string" && typeof candidate.elementId === "string",
			);
		if (inserted.length > 0) {
			this.editor.selection.setSelectedElements({ elements: inserted });
		}
		return inserted;
	}

	insertSocialOverlayPreset({
		presetId,
		variantId,
		motionPresetId,
		startTime,
		duration,
		values,
	}: {
		presetId: SocialOverlayPresetId;
		variantId?: OverlayStyleVariantId;
		motionPresetId?: GraphicsMotionPresetId;
		startTime: number;
		duration?: number;
		values?: Partial<Record<OverlayTextSlot, string>>;
	}): { trackId: string; elementId: string }[] {
		const project = this.editor.project.getActive();
		const overlayDefaults = resolveProjectOverlayDefaults({ project });
		const elements = buildSocialOverlayPresetElements({
			project,
			presetId,
			variantId,
			motionPresetId: motionPresetId ?? overlayDefaults.motionPresetId,
			startTime,
			duration,
			values,
		});
		const linkedGroupId = elements.length > 1 ? generateUUID() : null;
		const commands = elements.map((element) => {
			const nextElement = linkedGroupId ? { ...element, linkedGroupId } : element;
			return new InsertElementCommand({
				element: nextElement,
				placement: {
					mode: "auto",
					trackType: nextElement.type === "image" ? "video" : "text",
				},
			});
		});
		const command = commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
		const inserted = commands
			.map((insertCommand) => ({
				trackId: insertCommand.getTrackId(),
				elementId: insertCommand.getElementId(),
			}))
			.filter(
				(candidate): candidate is { trackId: string; elementId: string } =>
					typeof candidate.trackId === "string",
			);
		if (inserted.length > 0) {
			this.editor.selection.setSelectedElements({ elements: inserted });
		}
		return inserted;
	}

	applyOverlayStyleVariant({
		trackId,
		elementIds,
		variantId,
	}: {
		trackId: string;
		elementIds: string[];
		variantId: OverlayStyleVariantId;
	}): void {
		const anchorTrack = this.getTrackById({ trackId });
		const anchorElement = anchorTrack?.elements.find((candidate) => elementIds.includes(candidate.id));
		const overlayMeta = (anchorElement as { overlayMeta?: OverlayMeta | null } | undefined)?.overlayMeta;
		if (!anchorElement || !overlayMeta) {
			throw new Error("Overlay style variants require a selected overlay element.");
		}

		const overlayElements = this.getOverlayElements({
			anchorElementId: anchorElement.id,
			linkedGroupId:
				"linkedGroupId" in anchorElement ? anchorElement.linkedGroupId ?? null : null,
			elementIds,
		});
		const updates = applyOverlayStyleVariantToElements({
			project: this.editor.project.getActive(),
			kind: overlayMeta.kind,
			variantId,
			elements: overlayElements,
		});
		this.updateElements({
			updates: updates.map((update) => ({
				trackId: this.findTrackIdForElement({ elementId: update.elementId }) ?? trackId,
				elementId: update.elementId,
				updates: update.updates,
			})),
		});
	}

	updateOverlayTextSlots({
		elementIds,
		values,
	}: {
		elementIds: string[];
		values: Partial<Record<OverlayTextSlot, string>>;
	}): void {
		const updates = this.getTracks()
			.flatMap((track) =>
				track.elements
					.filter(
						(element): element is TextElement =>
							element.type === "text" &&
							elementIds.includes(element.id) &&
							typeof element.overlayMeta?.slot === "string",
					)
					.map((element) => {
						const nextValue = values[element.overlayMeta?.slot as OverlayTextSlot];
						return nextValue === undefined
							? null
							: {
									trackId: track.id,
									elementId: element.id,
									updates: { content: nextValue },
								};
					}),
			)
			.filter((update): update is { trackId: string; elementId: string; updates: { content: string } } => update !== null);
		if (updates.length === 0) return;
		this.updateElements({ updates });
	}

	applyGraphicsMotionPreset({
		trackId,
		elementId,
		motionPresetId,
	}: {
		trackId: string;
		elementId: string;
		motionPresetId: GraphicsMotionPresetId;
	}): void {
		const track = this.getTrackById({ trackId });
		const element = track?.elements.find((candidate) => candidate.id === elementId);
		if (!element || (element.type !== "text" && element.type !== "sticker")) {
			throw new Error("Graphics motion presets only apply to text and sticker elements.");
		}
		const nextKeyframes = applyGraphicsMotionPreset({
			element: element as TextElement | StickerElement,
			motionPresetId,
		});
		this.updateElements({
			updates: [
				{
					trackId,
					elementId,
					updates: { keyframes: nextKeyframes },
				},
			],
		});
	}

	findTrackIdForElement({ elementId }: { elementId: string }): string | null {
		for (const track of this.getTracks()) {
			if (track.elements.some((element) => element.id === elementId)) {
				return track.id;
			}
		}
		return null;
	}

	toggleTrackMute({ trackId }: { trackId: string }): void {
		const command = new ToggleTrackMuteCommand(trackId);
		this.editor.command.execute({ command });
	}

	updateTrackVolume({
		trackId,
		volume,
	}: {
		trackId: string;
		volume: number;
	}): void {
		const command = new UpdateTrackVolumeCommand(
			trackId,
			Math.max(0, Math.min(2, volume)),
		);
		this.editor.command.execute({ command });
	}

	toggleTrackVisibility({ trackId }: { trackId: string }): void {
		const command = new ToggleTrackVisibilityCommand(trackId);
		this.editor.command.execute({ command });
	}

	splitElements({
		elements,
		splitTime,
		retainSide = "both",
	}: {
		elements: { trackId: string; elementId: string }[];
		splitTime: number;
		retainSide?: "both" | "left" | "right";
	}): { trackId: string; elementId: string }[] {
		const command = new SplitElementsCommand(elements, splitTime, retainSide);
		this.editor.command.execute({ command });
		return command.getRightSideElements();
	}

	getTotalDuration(): number {
		return calculateTotalDuration({ tracks: this.getTracks() });
	}

	getTrackById({ trackId }: { trackId: string }): TimelineTrack | null {
		return this.getTracks().find((track) => track.id === trackId) ?? null;
	}

	getElementsWithTracks({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): Array<{ track: TimelineTrack; element: TimelineElement }> {
		const result: Array<{ track: TimelineTrack; element: TimelineElement }> =
			[];

		for (const { trackId, elementId } of elements) {
			const track = this.getTrackById({ trackId });
			const element = track?.elements.find(
				(trackElement) => trackElement.id === elementId,
			);

			if (track && element) {
				result.push({ track, element });
			}
		}

		return result;
	}

	private getOverlayElements({
		anchorElementId,
		linkedGroupId,
		elementIds,
	}: {
		anchorElementId: string;
		linkedGroupId: string | null;
		elementIds: string[];
	}): Array<TextElement | Extract<TimelineElement, { type: "image" }>> {
		const idSet = new Set(elementIds);
		return this.getTracks()
			.flatMap((track) =>
				track.elements.filter((element) => {
					if (element.id === anchorElementId) return true;
					if (idSet.has(element.id)) return true;
					return (
						Boolean(linkedGroupId) &&
						"linkedGroupId" in element &&
						element.linkedGroupId === linkedGroupId
					);
				}),
			)
			.filter(
				(element): element is TextElement | Extract<TimelineElement, { type: "image" }> =>
					(element.type === "text" || element.type === "image") &&
					Boolean((element as { overlayMeta?: OverlayMeta | null }).overlayMeta),
			);
	}

	pasteAtTime({
		time,
		clipboardItems,
	}: {
		time: number;
		clipboardItems: ClipboardItem[];
	}): { trackId: string; elementId: string }[] {
		const command = new PasteCommand(time, clipboardItems);
		this.editor.command.execute({ command });
		return command.getPastedElements();
	}

	deleteElements({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const command = new DeleteElementsCommand(elements);
		this.editor.command.execute({ command });
	}

	updateElements({
		updates,
		pushHistory = true,
	}: {
		updates: Array<{
			trackId: string;
			elementId: string;
			updates: Partial<Record<string, unknown>>;
		}>;
		pushHistory?: boolean;
	}): void {
		const commands = updates.map(
			({ trackId, elementId, updates: elementUpdates }) =>
				new UpdateElementCommand(trackId, elementId, elementUpdates),
		);
		const command =
			commands.length === 1 ? commands[0] : new BatchCommand(commands);
		if (pushHistory) {
			this.editor.command.execute({ command });
		} else {
			command.execute();
		}
	}

	isPreviewActive(): boolean {
		return this.previewTracker.isActive();
	}

	previewElements({
		updates,
	}: {
		updates: Array<{
			trackId: string;
			elementId: string;
			updates: Partial<Record<string, unknown>>;
		}>;
	}): void {
		const tracks = this.getTracks();
		this.previewTracker.begin({ state: tracks });

		let updatedTracks = tracks;
		for (const { trackId, elementId, updates: elementUpdates } of updates) {
			updatedTracks = updatedTracks.map((track) => {
				if (track.id !== trackId) return track;
				const newElements = track.elements.map((element) =>
					element.id === elementId
						? { ...element, ...elementUpdates }
						: element,
				);
				return { ...track, elements: newElements } as TimelineTrack;
			});
		}
		this.updateTracks(updatedTracks);
	}

	commitPreview(): void {
		const snapshot = this.previewTracker.end();
		if (snapshot === null) return;
		const currentTracks = this.getTracks();
		const command = new TracksSnapshotCommand(snapshot, currentTracks);
		this.editor.command.push({ command });
	}

	discardPreview(): void {
		const snapshot = this.previewTracker.end();
		if (snapshot !== null) {
			this.updateTracks(snapshot);
		}
	}

	duplicateElements({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): { trackId: string; elementId: string }[] {
		const command = new DuplicateElementsCommand({ elements });
		this.editor.command.execute({ command });
		return command.getDuplicatedElements();
	}

	toggleElementsVisibility({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const command = new ToggleElementsVisibilityCommand(elements);
		this.editor.command.execute({ command });
	}

	toggleElementsMuted({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const command = new ToggleElementsMutedCommand(elements);
		this.editor.command.execute({ command });
	}

	getTracks(): TimelineTrack[] {
		return this.editor.scenes.getActiveScene()?.tracks ?? [];
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => fn());
	}

	private getFinishableElement({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): FinishableVisualElement | null {
		const track = this.getTrackById({ trackId });
		const element = track?.elements.find((candidate) => candidate.id === elementId);
		if (!element || (element.type !== "video" && element.type !== "image")) {
			return null;
		}
		return {
			...element,
			adjustments: clampVisualAdjustments({ adjustments: element.adjustments }),
			effects: normalizeVisualEffects({ effects: element.effects }),
		};
	}

	updateTracks(newTracks: TimelineTrack[]): void {
		this.editor.scenes.updateSceneTracks({ tracks: newTracks });
		this.notify();
	}
}
