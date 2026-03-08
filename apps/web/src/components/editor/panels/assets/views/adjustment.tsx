"use client";

import { NumberField } from "@/components/ui/number-field";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { PanelView } from "./base-view";
import { useEditor } from "@/hooks/use-editor";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import { clampVisualAdjustments } from "@/lib/timeline";
import type { VisualAdjustments } from "@/types/timeline";
import { resolveSelectedFinishableTarget } from "./finishable-selection";
import { usePropertyDraft } from "../../properties/hooks/use-property-draft";

const ADJUSTMENT_FIELDS: Array<{ key: keyof VisualAdjustments; label: string }> = [
	{ key: "exposure", label: "Exposure" },
	{ key: "contrast", label: "Contrast" },
	{ key: "saturation", label: "Saturation" },
	{ key: "temperature", label: "Temperature" },
	{ key: "tint", label: "Tint" },
	{ key: "highlights", label: "Highlights" },
	{ key: "shadows", label: "Shadows" },
];

export function AdjustmentView() {
	const editor = useEditor();
	useElementSelection();
	const target = resolveSelectedFinishableTarget({ editor });
	const adjustments = clampVisualAdjustments({
		adjustments: target?.element.adjustments ?? null,
	});

	const updateField = (field: keyof VisualAdjustments, value: number) => {
		if (!target) return;
		editor.timeline.setElementAdjustments({
			trackId: target.track.id,
			elementId: target.element.id,
			adjustments: {
				...adjustments,
				[field]: value,
			},
		});
	};

	return (
		<PanelView title="Adjustment">
			<div className="flex flex-col gap-3 p-2">
				{target ? (
					<>
						<p className="text-muted-foreground text-sm">
							Quick adjustments for <span className="text-foreground">{target.element.name}</span>.
						</p>
						{ADJUSTMENT_FIELDS.map((field) => (
							<AdjustmentQuickRow
								key={field.key}
								label={field.label}
								value={adjustments[field.key]}
								onCommit={(value) => updateField(field.key, value)}
							/>
						))}
						<Button
							variant="outline"
							size="sm"
							onClick={() =>
								editor.timeline.resetElementAdjustments({
									trackId: target.track.id,
									elementId: target.element.id,
								})
							}
						>
							Reset all adjustments
						</Button>
					</>
				) : (
					<div className="rounded-md border p-4">
						<p className="font-medium">Select a visual clip</p>
						<p className="text-muted-foreground mt-1 text-sm">
							Adjustments apply to one visual clip at a time. Linked audio can stay selected.
						</p>
					</div>
				)}
			</div>
		</PanelView>
	);
}

function AdjustmentQuickRow({
	label,
	value,
	onCommit,
}: {
	label: string;
	value: number;
	onCommit: (value: number) => void;
}) {
	const draft = usePropertyDraft({
		displayValue: value.toFixed(2),
		parse: (input) => {
			const parsed = parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return Math.max(-1, Math.min(1, parsed));
		},
		onPreview: () => {},
		onCommit: () => {},
	});

	return (
		<div className="rounded-md border p-3">
			<div className="mb-2 flex items-center justify-between gap-3">
				<p className="font-medium">{label}</p>
				<div className="w-24">
					<NumberField
						value={draft.displayValue}
						onFocus={draft.onFocus}
						onChange={draft.onChange}
						onBlur={() => {
							const parsed = parseFloat(draft.currentValue);
							draft.onBlur();
							if (!Number.isNaN(parsed)) onCommit(parsed);
						}}
						onReset={() => onCommit(0)}
						isDefault={Math.abs(value) < 1e-6}
					/>
				</div>
			</div>
			<Slider
				min={-1}
				max={1}
				step={0.01}
				value={[value]}
				onValueCommit={(values) => onCommit(values[0] ?? 0)}
			/>
		</div>
	);
}
