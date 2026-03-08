"use client";

import { Button } from "@/components/ui/button";
import { PanelView } from "./base-view";
import { useEditor } from "@/hooks/use-editor";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import { normalizeVisualEffects } from "@/lib/timeline";
import { resolveSelectedFinishableTarget } from "./finishable-selection";

const EFFECT_CARDS = [
	{
		kind: "blur" as const,
		label: "Blur",
		description: "Soften the selected clip with a gaussian blur pass.",
	},
	{
		kind: "vignette" as const,
		label: "Vignette",
		description: "Darken the frame edges for focus and contrast.",
	},
	{
		kind: "sharpen" as const,
		label: "Sharpen",
		description: "Restore edge detail with a deterministic sharpen pass.",
	},
];

export function EffectsView() {
	const editor = useEditor();
	useElementSelection();
	const target = resolveSelectedFinishableTarget({ editor });
	const effects = target ? normalizeVisualEffects({ effects: target.element.effects }) ?? [] : [];

	return (
		<PanelView title="Effects">
			<div className="flex flex-col gap-3 p-2">
				{target ? (
					<p className="text-muted-foreground text-sm">
						Add effects to <span className="text-foreground">{target.element.name}</span>.
					</p>
				) : (
					<div className="rounded-md border p-4">
						<p className="font-medium">Select a visual clip</p>
						<p className="text-muted-foreground mt-1 text-sm">
							Browse effects for one visual clip. Linked audio can stay selected.
						</p>
					</div>
				)}

				<div className="grid gap-3">
					{EFFECT_CARDS.map((card) => {
						const existing = effects.find((effect) => effect.kind === card.kind);
						return (
							<div
								key={card.kind}
								className="flex items-center justify-between gap-3 rounded-md border p-3"
							>
								<div className="min-w-0">
									<p className="font-medium">{card.label}</p>
									<p className="text-muted-foreground text-sm">{card.description}</p>
								</div>
								<Button
									size="sm"
									variant={existing ? "secondary" : "outline"}
									disabled={!target || Boolean(existing)}
									onClick={() => {
										if (!target) return;
										editor.timeline.addElementEffect({
											trackId: target.track.id,
											elementId: target.element.id,
											kind: card.kind,
										});
									}}
								>
									{existing ? "Added" : "Add"}
								</Button>
							</div>
						);
					})}
				</div>
				{effects.length > 0 ? (
					<div className="rounded-md border p-3">
						<p className="mb-2 font-medium">Stack</p>
						<div className="flex flex-col gap-2">
							{effects.map((effect, index) => (
								<div key={effect.id} className="flex items-center justify-between gap-2 text-sm">
									<span>
										{index + 1}. {effect.kind}
									</span>
									<span className="text-muted-foreground">
										{effect.enabled ? "Enabled" : "Disabled"}
									</span>
								</div>
							))}
						</div>
					</div>
				) : null}
			</div>
		</PanelView>
	);
}
