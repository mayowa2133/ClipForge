"use client";

import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useEditor } from "@/hooks/use-editor";
import { useReplaceMedia } from "@/hooks/use-replace-media";
import { useTimelineStore } from "@/stores/timeline-store";
import type { ImageElement, StickerElement, VideoElement } from "@/types/timeline";
import { BlendingSection, TransformSection } from "./sections";
import { Section, SectionContent, SectionField, SectionFields, SectionHeader } from "./section";
import { usePropertyDraft } from "./hooks/use-property-draft";
import {
	clampPlaybackRate,
	getElementVisibleSourceSpan,
	getPlaybackDurationForSourceSpan,
} from "@/lib/timeline/manual-editing";
import { formatTimeCode } from "@/lib/time";
import type { TransitionPreset } from "@/types/timeline";
import {
	clampTransitionDuration,
	findAdjacentVisualIncomingTransitionTarget,
} from "@/lib/timeline";
import { AdjustmentsSection, EffectsSection, FilterSection } from "./sections/finishing";

const TRANSITION_PRESETS: Array<{
	value: TransitionPreset;
	label: string;
	description: string;
	defaultDuration: number;
}> = [
	{
		value: "cross-dissolve",
		label: "Cross dissolve",
		description: "Blend the outgoing and incoming clips.",
		defaultDuration: 0.5,
	},
	{
		value: "fade-black",
		label: "Fade through black",
		description: "Fade out to black, then bring in the next clip.",
		defaultDuration: 0.5,
	},
	{
		value: "fade-white",
		label: "Fade through white",
		description: "Fade out to white, then bring in the next clip.",
		defaultDuration: 0.5,
	},
	{
		value: "slide",
		label: "Slide",
		description: "Slide the new clip in from the right.",
		defaultDuration: 0.4,
	},
];

const SPEED_PRESETS = [0.5, 1, 1.5, 2];

export function VideoProperties({
	element,
	trackId,
}: {
	element: VideoElement | ImageElement | StickerElement;
	trackId: string;
}) {
	return (
		<div className="flex h-full flex-col">
			<SourceSection element={element} trackId={trackId} />
			{element.type === "video" ? (
				<SpeedSection element={element} trackId={trackId} />
			) : null}
			{element.type !== "sticker" ? (
				<TransitionSection element={element} trackId={trackId} />
			) : null}
			<TransformSection element={element} trackId={trackId} />
			<BlendingSection element={element} trackId={trackId} />
			{element.type === "video" || element.type === "image" ? (
				<>
					<FilterSection element={element} trackId={trackId} />
					<AdjustmentsSection element={element} trackId={trackId} />
					<EffectsSection element={element} trackId={trackId} />
				</>
			) : null}
		</div>
	);
}

function SourceSection({
	element,
	trackId,
}: {
	element: VideoElement | ImageElement | StickerElement;
	trackId: string;
}) {
	if (element.type === "sticker") {
		return null;
	}

	const { fileInputProps, openReplaceMediaPicker, isReplacing } = useReplaceMedia({
		trackId,
		element,
	});

	return (
		<Section collapsible sectionKey={`${element.type}:source`} hasBorderTop={false}>
			<SectionHeader title="Source" />
			<SectionContent>
				<SectionFields>
					<SectionField label="Media">
						<div className="rounded-md border px-3 py-2 text-sm">
							{element.name}
						</div>
					</SectionField>
					<Button
						variant="outline"
						size="sm"
						onClick={openReplaceMediaPicker}
						disabled={isReplacing}
					>
						{isReplacing ? "Replacing..." : "Replace Media"}
					</Button>
					<input {...fileInputProps} />
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

function SpeedSection({
	element,
	trackId,
}: {
	element: VideoElement;
	trackId: string;
}) {
	const editor = useEditor();
	const rippleEditingEnabled = useTimelineStore((state) => state.rippleEditingEnabled);
	const playbackRate = element.playbackRate ?? 1;
	const sourceSpan = getElementVisibleSourceSpan({ element });
	const nextDuration = getPlaybackDurationForSourceSpan({
		sourceSpan,
		playbackRate,
	});

	const draft = usePropertyDraft({
		displayValue: playbackRate.toFixed(2),
		parse: (input) => {
			const parsed = parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return clampPlaybackRate({ playbackRate: parsed });
		},
		onPreview: () => {},
		onCommit: () => {},
	});

	return (
		<Section collapsible sectionKey="video:speed">
			<SectionHeader title="Speed" />
			<SectionContent>
				<SectionFields>
					<SectionField label="Playback rate">
						<NumberField
							value={draft.displayValue}
							onFocus={draft.onFocus}
							onChange={draft.onChange}
							onBlur={(event) => {
								draft.onBlur();
								const parsed = parseFloat(event.currentTarget.value);
								if (Number.isNaN(parsed)) return;
								editor.timeline.updateElementPlaybackRate({
									trackId,
									elementId: element.id,
									playbackRate: parsed,
									ripple: rippleEditingEnabled,
								});
							}}
							onReset={() =>
								editor.timeline.updateElementPlaybackRate({
									trackId,
									elementId: element.id,
									playbackRate: 1,
									ripple: rippleEditingEnabled,
								})
							}
							isDefault={playbackRate === 1}
							icon="x"
						/>
					</SectionField>
					<div className="flex flex-wrap gap-2">
						{SPEED_PRESETS.map((preset) => (
							<Button
								key={preset}
								variant={playbackRate === preset ? "secondary" : "outline"}
								size="sm"
								onClick={() =>
									editor.timeline.updateElementPlaybackRate({
										trackId,
										elementId: element.id,
										playbackRate: preset,
										ripple: rippleEditingEnabled,
									})
								}
							>
								{preset}x
							</Button>
						))}
					</div>
					<p className="text-muted-foreground text-xs">
						Result duration {formatTimeCode({ timeInSeconds: nextDuration })}
						{rippleEditingEnabled ? " with ripple." : " without ripple."}
					</p>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

function TransitionSection({
	element,
	trackId,
}: {
	element: VideoElement | ImageElement;
	trackId: string;
}) {
	const editor = useEditor();
	const track = editor.timeline.getTrackById({ trackId });
	const fps = editor.project.getActive()?.settings.fps ?? 30;
	const adjacency =
		track?.type === "video"
			? findAdjacentVisualIncomingTransitionTarget({
					track,
					elementId: element.id,
					fps,
			  })
			: null;
	const transition = element.transitionIn ?? null;
	const selectedPreset = transition?.preset ?? TRANSITION_PRESETS[0].value;
	const currentDuration = transition?.duration ?? TRANSITION_PRESETS[0].defaultDuration;
	const durationDraft = usePropertyDraft({
		displayValue: currentDuration.toFixed(2),
		parse: (input) => {
			const parsed = parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return clampTransitionDuration({
				duration: parsed,
				currentDuration: adjacency?.current.duration ?? element.duration,
				previousDuration: adjacency?.previous.duration ?? element.duration,
			});
		},
		onPreview: () => {},
		onCommit: () => {},
	});
	const helperText = adjacency
		? `Transition from "${adjacency.previous.name}" into "${adjacency.current.name}".`
		: "Transitions require a touching visual clip immediately before this clip on the same video track.";

	return (
		<Section collapsible sectionKey={`${element.type}:transition`}>
			<SectionHeader title="Transition" />
			<SectionContent>
				<SectionFields>
					<SectionField label="Preset">
						<Select
							value={selectedPreset}
							onValueChange={(value: TransitionPreset) => {
								const presetConfig =
									TRANSITION_PRESETS.find((preset) => preset.value === value) ??
									TRANSITION_PRESETS[0];
								editor.timeline.setElementTransitionIn({
									trackId,
									elementId: element.id,
									preset: value,
									duration: transition?.duration ?? presetConfig.defaultDuration,
								});
							}}
							disabled={!adjacency}
						>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Select transition" />
							</SelectTrigger>
							<SelectContent>
								{TRANSITION_PRESETS.map((preset) => (
									<SelectItem key={preset.value} value={preset.value}>
										{preset.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SectionField>

					<SectionField label="Duration">
						<NumberField
							value={durationDraft.displayValue}
							onFocus={durationDraft.onFocus}
							onChange={durationDraft.onChange}
							onBlur={() => {
								const parsed = parseFloat(durationDraft.currentValue);
								durationDraft.onBlur();
								if (Number.isNaN(parsed) || !adjacency) return;
								editor.timeline.setElementTransitionIn({
									trackId,
									elementId: element.id,
									preset: selectedPreset,
									duration: parsed,
								});
							}}
							onReset={() => {
								const presetConfig =
									TRANSITION_PRESETS.find((preset) => preset.value === selectedPreset) ??
									TRANSITION_PRESETS[0];
								editor.timeline.setElementTransitionIn({
									trackId,
									elementId: element.id,
									preset: selectedPreset,
									duration: presetConfig.defaultDuration,
								});
							}}
							isDefault={
								currentDuration ===
								(TRANSITION_PRESETS.find((preset) => preset.value === selectedPreset)
									?.defaultDuration ?? TRANSITION_PRESETS[0].defaultDuration)
							}
							disabled={!adjacency}
							icon="s"
						/>
					</SectionField>

					<p className="text-muted-foreground text-xs">{helperText}</p>

					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={!adjacency}
							onClick={() => {
								const presetConfig =
									TRANSITION_PRESETS.find((preset) => preset.value === selectedPreset) ??
									TRANSITION_PRESETS[0];
								editor.timeline.setElementTransitionIn({
									trackId,
									elementId: element.id,
									preset: selectedPreset,
									duration: transition?.duration ?? presetConfig.defaultDuration,
								});
							}}
						>
							{transition ? "Update Transition" : "Apply Transition"}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={!transition}
							onClick={() =>
								editor.timeline.clearElementTransitionIn({
									trackId,
									elementId: element.id,
								})
							}
						>
							Remove
						</Button>
					</div>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}
