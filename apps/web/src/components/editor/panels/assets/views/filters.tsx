"use client";

import { Button } from "@/components/ui/button";
import { PanelView } from "./base-view";
import { useEditor } from "@/hooks/use-editor";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import { FILTER_PRESETS, findMatchingFilterPreset } from "@/lib/timeline";
import { resolveSelectedFinishableTarget } from "./finishable-selection";

export function FiltersView() {
	const editor = useEditor();
	useElementSelection();
	const target = resolveSelectedFinishableTarget({ editor });
	const activePreset = target
		? findMatchingFilterPreset({
				adjustments: target.element.adjustments ?? null,
				effects: target.element.effects ?? null,
		  })
		: null;

	return (
		<PanelView title="Filters">
			<div className="flex flex-col gap-3 p-2">
				{target ? (
					<p className="text-muted-foreground text-sm">
						Apply a look to <span className="text-foreground">{target.element.name}</span>.
					</p>
				) : (
					<div className="rounded-md border p-4">
						<p className="font-medium">Select a visual clip</p>
						<p className="text-muted-foreground mt-1 text-sm">
							Browse looks for one visual clip. Linked audio can stay selected.
						</p>
					</div>
				)}

				<div className="grid gap-3">
					{FILTER_PRESETS.map((preset) => (
						<div
							key={preset.id}
							className="flex items-center justify-between gap-3 rounded-md border p-3"
						>
							<div className="min-w-0">
								<p className="font-medium">{preset.label}</p>
								<p className="text-muted-foreground text-sm">{preset.description}</p>
							</div>
							<Button
								size="sm"
								variant={activePreset === preset.id ? "secondary" : "outline"}
								disabled={!target}
								onClick={() => {
									if (!target) return;
									editor.timeline.applyElementFilterPreset({
										trackId: target.track.id,
										elementId: target.element.id,
										presetId: preset.id,
									});
								}}
							>
								{activePreset === preset.id ? "Applied" : "Apply"}
							</Button>
						</div>
					))}
				</div>
			</div>
		</PanelView>
	);
}
