"use client";

import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useEditor } from "@/hooks/use-editor";
import {
	FILTER_PRESETS,
	DEFAULT_VISUAL_ADJUSTMENTS,
	clampVisualAdjustments,
	findMatchingFilterPreset,
	getFilterPresetById,
	normalizeVisualEffects,
	type FilterPresetId,
	type FinishableVisualElement,
} from "@/lib/timeline";
import type { VisualAdjustments, VisualEffect, VisualEffectKind } from "@/types/timeline";
import { Section, SectionContent, SectionField, SectionFields, SectionHeader } from "../section";
import { usePropertyDraft } from "../hooks/use-property-draft";

type FinishableElement = FinishableVisualElement;

const ADJUSTMENT_FIELDS: Array<{
	key: keyof VisualAdjustments;
	label: string;
}> = [
	{ key: "exposure", label: "Exposure" },
	{ key: "contrast", label: "Contrast" },
	{ key: "saturation", label: "Saturation" },
	{ key: "temperature", label: "Temperature" },
	{ key: "tint", label: "Tint" },
	{ key: "highlights", label: "Highlights" },
	{ key: "shadows", label: "Shadows" },
];

const EFFECT_CARDS: Array<{
	kind: VisualEffectKind;
	label: string;
	description: string;
}> = [
	{ kind: "blur", label: "Blur", description: "Soften the clip with a gaussian blur pass." },
	{ kind: "vignette", label: "Vignette", description: "Darken the frame edges for focus." },
	{ kind: "sharpen", label: "Sharpen", description: "Restore edge contrast for a crisper finish." },
];

export function FilterSection({
	element,
	trackId,
}: {
	element: FinishableElement;
	trackId: string;
}) {
	const editor = useEditor();
	const matchingPreset = findMatchingFilterPreset({
		adjustments: element.adjustments ?? null,
		effects: element.effects ?? null,
	});

	return (
		<Section collapsible sectionKey={`${element.type}:filter`}>
			<SectionHeader title="Filter" />
			<SectionContent>
				<SectionFields>
					<SectionField label="Preset">
						<Select
							value={matchingPreset ?? "custom"}
							onValueChange={(value) => {
								if (value === "custom") return;
								editor.timeline.applyElementFilterPreset({
									trackId,
									elementId: element.id,
									presetId: value as FilterPresetId,
								});
							}}
						>
							<SelectTrigger>
								<SelectValue placeholder="Choose a filter preset" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="custom">Custom</SelectItem>
								{FILTER_PRESETS.map((preset) => (
									<SelectItem key={preset.id} value={preset.id}>
										{preset.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SectionField>
					<p className="text-muted-foreground text-xs">
						{matchingPreset
							? getFilterPresetById({ presetId: matchingPreset })?.description
							: "This clip no longer matches an exact built-in preset."}
					</p>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => editor.timeline.clearElementFinishing({ trackId, elementId: element.id })}
						>
							Clear filter
						</Button>
					</div>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

export function AdjustmentsSection({
	element,
	trackId,
}: {
	element: FinishableElement;
	trackId: string;
}) {
	const editor = useEditor();
	return (
		<Section collapsible sectionKey={`${element.type}:adjustments`}>
			<SectionHeader title="Adjustments" />
			<SectionContent>
				<SectionFields>
					{ADJUSTMENT_FIELDS.map((field) => (
						<AdjustmentRow
							key={field.key}
							element={element}
							trackId={trackId}
							field={field.key}
							label={field.label}
						/>
					))}
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							editor.timeline.resetElementAdjustments({
								trackId,
								elementId: element.id,
							})
						}
					>
						Reset all adjustments
					</Button>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

function AdjustmentRow({
	element,
	trackId,
	field,
	label,
}: {
	element: FinishableElement;
	trackId: string;
	field: keyof VisualAdjustments;
	label: string;
}) {
	const editor = useEditor();
	const currentAdjustments = clampVisualAdjustments({ adjustments: element.adjustments });
	const currentValue = currentAdjustments[field];

	const previewValue = (value: number) => {
		const nextAdjustments = clampVisualAdjustments({
			adjustments: {
				...currentAdjustments,
				[field]: value,
			},
		});
		editor.timeline.previewElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: {
						adjustments: Object.values(nextAdjustments).every((entry) => Math.abs(entry) < 1e-6)
							? null
							: nextAdjustments,
					},
				},
			],
		});
	};

	const commitValue = (value: number) => {
		if (editor.timeline.isPreviewActive()) {
			editor.timeline.discardPreview();
		}
		editor.timeline.setElementAdjustments({
			trackId,
			elementId: element.id,
			adjustments: {
				...currentAdjustments,
				[field]: value,
			},
		});
	};

	const draft = usePropertyDraft({
		displayValue: currentValue.toFixed(2),
		parse: (input) => {
			const parsed = parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return Math.max(-1, Math.min(1, parsed));
		},
		onPreview: previewValue,
		onCommit: () => {},
	});

	return (
		<SectionField label={label}>
			<div className="flex items-center gap-2">
				<Slider
					className="flex-1"
					min={-1}
					max={1}
					step={0.01}
					value={[currentValue]}
					onValueChange={(values) => previewValue(values[0] ?? 0)}
					onValueCommit={(values) => commitValue(values[0] ?? 0)}
				/>
				<div className="w-24">
					<NumberField
						value={draft.displayValue}
						onFocus={draft.onFocus}
						onChange={draft.onChange}
						onBlur={() => {
							const parsed = parseFloat(draft.currentValue);
							draft.onBlur();
							if (!Number.isNaN(parsed)) {
								commitValue(parsed);
							}
						}}
						onScrub={draft.scrubTo}
						onScrubEnd={() => {
							const parsed = parseFloat(draft.currentValue);
							draft.commitScrub();
							commitValue(Number.isNaN(parsed) ? currentValue : parsed);
						}}
						onReset={() => commitValue(DEFAULT_VISUAL_ADJUSTMENTS[field])}
						isDefault={Math.abs(currentValue - DEFAULT_VISUAL_ADJUSTMENTS[field]) < 1e-6}
					/>
				</div>
			</div>
		</SectionField>
	);
}

export function EffectsSection({
	element,
	trackId,
}: {
	element: FinishableElement;
	trackId: string;
}) {
	const editor = useEditor();
	const effects = normalizeVisualEffects({ effects: element.effects }) ?? [];
	const availableEffects = EFFECT_CARDS.filter(
		(card) => !effects.some((effect) => effect.kind === card.kind),
	);

	return (
		<Section collapsible sectionKey={`${element.type}:effects`}>
			<SectionHeader title="Effects" />
			<SectionContent>
				<SectionFields>
					{effects.length === 0 ? (
						<p className="text-muted-foreground text-sm">No effects applied yet.</p>
					) : (
						effects.map((effect, index) => (
							<EffectEditor
								key={effect.id}
								element={element}
								trackId={trackId}
								effect={effect}
								index={index}
								canMoveUp={index > 0}
								canMoveDown={index < effects.length - 1}
							/>
						))
					)}
					<div className="grid gap-2">
						{availableEffects.map((card) => (
							<div key={card.kind} className="flex items-center justify-between rounded-md border p-3">
								<div>
									<p className="font-medium">{card.label}</p>
									<p className="text-muted-foreground text-xs">{card.description}</p>
								</div>
								<Button
									size="sm"
									onClick={() =>
										editor.timeline.addElementEffect({
											trackId,
											elementId: element.id,
											kind: card.kind,
										})
									}
								>
									Add
								</Button>
							</div>
						))}
					</div>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

function EffectEditor({
	element,
	trackId,
	effect,
	index,
	canMoveUp,
	canMoveDown,
}: {
	element: FinishableElement;
	trackId: string;
	effect: VisualEffect;
	index: number;
	canMoveUp: boolean;
	canMoveDown: boolean;
}) {
	const editor = useEditor();
	const field = effect.kind === "blur" ? "radius" : effect.kind === "vignette" ? "intensity" : "amount";
	const label = effect.kind === "blur" ? "Radius" : effect.kind === "vignette" ? "Intensity" : "Amount";
	const min = 0;
	const max = effect.kind === "blur" ? 40 : 1;
	const step = effect.kind === "blur" ? 0.5 : 0.01;
	const defaultValue =
		effect.kind === "blur" ? 12 : effect.kind === "vignette" ? 0.45 : 0.35;
	const currentValue =
		effect.kind === "blur"
			? effect.radius
			: effect.kind === "vignette"
				? effect.intensity
				: effect.amount;

	const previewValue = (value: number) => {
		const nextEffects = normalizeVisualEffects({
			effects: (element.effects ?? []).map((candidate) =>
				candidate.id === effect.id
					? effect.kind === "blur"
						? { ...candidate, radius: value }
						: effect.kind === "vignette"
							? { ...candidate, intensity: value }
							: { ...candidate, amount: value }
					: candidate,
			),
		});
		editor.timeline.previewElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: { effects: nextEffects },
				},
			],
		});
	};

	const applyUpdate = (value: number) => {
		if (editor.timeline.isPreviewActive()) {
			editor.timeline.discardPreview();
		}
		editor.timeline.updateElementEffect({
			trackId,
			elementId: element.id,
			effectId: effect.id,
			updates:
				effect.kind === "blur"
					? { ...effect, radius: value }
					: effect.kind === "vignette"
						? { ...effect, intensity: value }
						: { ...effect, amount: value },
		});
	};

	const draft = usePropertyDraft({
		displayValue: currentValue.toFixed(effect.kind === "blur" ? 1 : 2),
		parse: (input) => {
			const parsed = parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return Math.max(min, Math.min(max, parsed));
		},
		onPreview: previewValue,
		onCommit: () => {},
	});

	return (
		<div className="rounded-md border p-3">
			<div className="mb-3 flex items-center justify-between gap-2">
				<div>
					<p className="font-medium capitalize">{effect.kind}</p>
					<p className="text-muted-foreground text-xs">Effect {index + 1}</p>
				</div>
				<div className="flex items-center gap-2">
					<Switch
						checked={effect.enabled}
						onCheckedChange={(checked) =>
							editor.timeline.updateElementEffect({
								trackId,
								elementId: element.id,
								effectId: effect.id,
								updates: { ...effect, enabled: checked },
							})
						}
					/>
					<Button
						variant="outline"
						size="sm"
						disabled={!canMoveUp}
						onClick={() =>
							editor.timeline.moveElementEffect({
								trackId,
								elementId: element.id,
								effectId: effect.id,
								toIndex: index - 1,
							})
						}
					>
						Up
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={!canMoveDown}
						onClick={() =>
							editor.timeline.moveElementEffect({
								trackId,
								elementId: element.id,
								effectId: effect.id,
								toIndex: index + 1,
							})
						}
					>
						Down
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							editor.timeline.removeElementEffect({
								trackId,
								elementId: element.id,
								effectId: effect.id,
							})
						}
					>
						Remove
					</Button>
				</div>
			</div>
			<SectionField label={label}>
				<div className="flex items-center gap-2">
					<Slider
						className="flex-1"
						min={min}
						max={max}
						step={step}
						value={[currentValue]}
						onValueChange={(values) => previewValue(values[0] ?? currentValue)}
						onValueCommit={(values) => applyUpdate(values[0] ?? currentValue)}
					/>
					<div className="w-24">
						<NumberField
							value={draft.displayValue}
							onFocus={draft.onFocus}
							onChange={draft.onChange}
							onBlur={() => {
								const parsed = parseFloat(draft.currentValue);
								draft.onBlur();
								if (!Number.isNaN(parsed)) {
									applyUpdate(parsed);
								}
							}}
							onScrub={draft.scrubTo}
							onScrubEnd={() => {
								const parsed = parseFloat(draft.currentValue);
								draft.commitScrub();
								applyUpdate(Number.isNaN(parsed) ? defaultValue : parsed);
							}}
							onReset={() => applyUpdate(defaultValue)}
							isDefault={
								Math.abs(currentValue - defaultValue) < 1e-6
							}
						/>
					</div>
				</div>
			</SectionField>
		</div>
	);
}
