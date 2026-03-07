"use client";

import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
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
			<TransformSection element={element} trackId={trackId} />
			<BlendingSection element={element} trackId={trackId} />
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
