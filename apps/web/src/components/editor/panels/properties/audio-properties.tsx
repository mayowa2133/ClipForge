"use client";

import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import { useEditor } from "@/hooks/use-editor";
import { useReplaceMedia } from "@/hooks/use-replace-media";
import { useTimelineStore } from "@/stores/timeline-store";
import type { AudioElement } from "@/types/timeline";
import { Section, SectionContent, SectionField, SectionFields, SectionHeader } from "./section";
import { usePropertyDraft } from "./hooks/use-property-draft";
import AudioWaveform from "../timeline/audio-waveform";
import { formatTimeCode } from "@/lib/time";
import {
	clampPlaybackRate,
	getElementVisibleSourceSpan,
	getPlaybackDurationForSourceSpan,
} from "@/lib/timeline/manual-editing";
import { toast } from "sonner";

const SPEED_PRESETS = [0.5, 1, 1.5, 2];

export function AudioProperties({
	element,
	trackId,
}: {
	element: AudioElement;
	trackId: string;
}) {
	const editor = useEditor();
	const mediaAsset =
		element.sourceType === "upload"
			? editor.media.getAssets().find((asset) => asset.id === element.mediaId) ?? null
			: null;
	const audioBuffer =
		element.sourceType === "library" ? element.buffer : undefined;
	const audioUrl =
		element.sourceType === "library"
			? element.sourceUrl
			: mediaAsset?.url;

	return (
		<div className="flex h-full flex-col">
			<SourceSection
				element={element}
				trackId={trackId}
				audioBuffer={audioBuffer}
				audioUrl={audioUrl}
			/>
			<AudioMixSection element={element} trackId={trackId} />
			<SpeedSection element={element} trackId={trackId} />
		</div>
	);
}

function SourceSection({
	element,
	trackId,
	audioBuffer,
	audioUrl,
}: {
	element: AudioElement;
	trackId: string;
	audioBuffer?: AudioBuffer;
	audioUrl?: string;
}) {
	const { fileInputProps, openReplaceMediaPicker, isReplacing } = useReplaceMedia({
		trackId,
		element,
	});

	return (
		<Section collapsible sectionKey="audio:source" hasBorderTop={false}>
			<SectionHeader title="Source" />
			<SectionContent>
				<SectionFields>
					<SectionField label="Waveform">
						<div className="rounded-md border px-3 py-2">
							<AudioWaveform
								audioBuffer={audioBuffer}
								audioUrl={audioUrl}
								height={48}
								className="w-full"
							/>
						</div>
					</SectionField>
					<Button
						variant="outline"
						size="sm"
						onClick={openReplaceMediaPicker}
						disabled={isReplacing}
					>
						{isReplacing ? "Replacing..." : "Replace"}
					</Button>
					<p className="text-muted-foreground text-xs">
						Role {getAudioRoleLabel({ element })}
					</p>
					<input {...fileInputProps} />
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

function AudioMixSection({
	element,
	trackId,
}: {
	element: AudioElement;
	trackId: string;
}) {
	const editor = useEditor();

	const commit = () => editor.timeline.commitPreview();

	const volume = usePropertyDraft({
		displayValue: Math.round(element.volume * 100).toString(),
		parse: (input) => {
			const parsed = parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return Math.max(0, Math.min(200, parsed)) / 100;
		},
		onPreview: (value) =>
			editor.timeline.previewElements({
				updates: [{ trackId, elementId: element.id, updates: { volume: value } }],
			}),
		onCommit: commit,
	});

	const fadeIn = usePropertyDraft({
		displayValue: (element.fadeInDuration ?? 0).toFixed(2),
		parse: (input) => {
			const parsed = parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return clampFadeValue({
				value: parsed,
				kind: "in",
				element,
			});
		},
		onPreview: (value) =>
			editor.timeline.previewElements({
				updates: [
					{
						trackId,
						elementId: element.id,
						updates: {
							fadeInDuration: value,
							fadeOutDuration: clampCompanionFade({
								kind: "in",
								nextValue: value,
								element,
							}),
						},
					},
				],
			}),
		onCommit: commit,
	});

	const fadeOut = usePropertyDraft({
		displayValue: (element.fadeOutDuration ?? 0).toFixed(2),
		parse: (input) => {
			const parsed = parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return clampFadeValue({
				value: parsed,
				kind: "out",
				element,
			});
		},
		onPreview: (value) =>
			editor.timeline.previewElements({
				updates: [
					{
						trackId,
						elementId: element.id,
						updates: {
							fadeOutDuration: value,
							fadeInDuration: clampCompanionFade({
								kind: "out",
								nextValue: value,
								element,
							}),
						},
					},
				],
			}),
		onCommit: commit,
	});

	const handleNormalize = async () => {
		try {
			const gainDb = await editor.audio.normalizeElement({
				trackId,
				elementId: element.id,
			});
			toast.success(`Normalization applied (${gainDb.toFixed(1)} dB).`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to normalize audio.",
			);
		}
	};

	return (
		<Section collapsible sectionKey="audio:mix">
			<SectionHeader title="Audio" />
			<SectionContent>
				<SectionFields>
					<SectionField label="Volume">
						<NumberField
							value={volume.displayValue}
							onFocus={volume.onFocus}
							onChange={volume.onChange}
							onBlur={volume.onBlur}
							onScrub={volume.scrubTo}
							onScrubEnd={volume.commitScrub}
							onReset={() =>
								editor.timeline.updateElements({
									updates: [
										{
											trackId,
											elementId: element.id,
											updates: { volume: 1 },
										},
									],
								})
							}
							isDefault={element.volume === 1}
							icon="%"
						/>
					</SectionField>
					<div className="grid grid-cols-2 gap-2">
						<SectionField label="Fade in">
							<NumberField
								value={fadeIn.displayValue}
								onFocus={fadeIn.onFocus}
								onChange={fadeIn.onChange}
								onBlur={fadeIn.onBlur}
								onScrub={fadeIn.scrubTo}
								onScrubEnd={fadeIn.commitScrub}
								onReset={() =>
									editor.timeline.updateElements({
										updates: [
											{
												trackId,
												elementId: element.id,
												updates: { fadeInDuration: 0 },
											},
										],
									})
								}
								isDefault={(element.fadeInDuration ?? 0) === 0}
								icon="In"
							/>
						</SectionField>
						<SectionField label="Fade out">
							<NumberField
								value={fadeOut.displayValue}
								onFocus={fadeOut.onFocus}
								onChange={fadeOut.onChange}
								onBlur={fadeOut.onBlur}
								onScrub={fadeOut.scrubTo}
								onScrubEnd={fadeOut.commitScrub}
								onReset={() =>
									editor.timeline.updateElements({
										updates: [
											{
												trackId,
												elementId: element.id,
												updates: { fadeOutDuration: 0 },
											},
										],
									})
								}
								isDefault={(element.fadeOutDuration ?? 0) === 0}
								icon="Out"
							/>
						</SectionField>
					</div>
					<Button
						variant={element.muted ? "secondary" : "outline"}
						size="sm"
						onClick={() =>
							editor.timeline.updateElements({
								updates: [
									{
										trackId,
										elementId: element.id,
										updates: { muted: !element.muted },
									},
								],
							})
						}
					>
						{element.muted ? "Unmute" : "Mute"}
					</Button>
					<Button variant="outline" size="sm" onClick={handleNormalize}>
						Normalize
					</Button>
					<p className="text-muted-foreground text-xs">
						Normalization {(element.normalizationGainDb ?? 0).toFixed(1)} dB
					</p>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

function SpeedSection({
	element,
	trackId,
}: {
	element: AudioElement;
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
		<Section collapsible sectionKey="audio:speed" hasBorderBottom={false}>
			<SectionHeader title="Speed" />
			<SectionContent>
				<SectionFields>
					<SectionField label="Rate">
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
						Length {formatTimeCode({ timeInSeconds: nextDuration })}
						{rippleEditingEnabled ? " · Ripple on" : " · Ripple off"}
					</p>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

function clampFadeValue({
	value,
	kind,
	element,
}: {
	value: number;
	kind: "in" | "out";
	element: AudioElement;
}) {
	const duration = Math.max(0, element.duration);
	const safeValue = Math.max(0, Math.min(duration, value));
	const other = kind === "in" ? element.fadeOutDuration ?? 0 : element.fadeInDuration ?? 0;
	return Math.max(0, Math.min(safeValue, duration - other));
}

function clampCompanionFade({
	kind,
	nextValue,
	element,
}: {
	kind: "in" | "out";
	nextValue: number;
	element: AudioElement;
}) {
	const duration = Math.max(0, element.duration);
	const current =
		kind === "in" ? element.fadeOutDuration ?? 0 : element.fadeInDuration ?? 0;
	return Math.max(0, Math.min(current, duration - nextValue));
}

function getAudioRoleLabel({ element }: { element: AudioElement }) {
	switch (element.role ?? "audio") {
		case "voiceover":
			return "Voiceover";
		case "music":
			return "Music";
		case "sfx":
			return "SFX";
		default:
			return "Audio";
	}
}
