"use client";

import { Button } from "@/components/ui/button";
import { PanelView } from "@/components/editor/panels/assets/views/base-view";
import { useEditor } from "@/hooks/use-editor";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import { findAdjacentVisualIncomingTransitionTarget } from "@/lib/timeline";
import type {
	ImageElement,
	TimelineTrack,
	TransitionPreset,
	VideoElement,
} from "@/types/timeline";

const BUILT_IN_TRANSITIONS: Array<{
	value: TransitionPreset;
	label: string;
	description: string;
	defaultDuration: number;
}> = [
	{
		value: "cross-dissolve",
		label: "Cross dissolve",
		description: "Blend the previous clip into this clip.",
		defaultDuration: 0.5,
	},
	{
		value: "fade-black",
		label: "Fade through black",
		description: "Fade the boundary through black.",
		defaultDuration: 0.5,
	},
	{
		value: "fade-white",
		label: "Fade through white",
		description: "Fade the boundary through white.",
		defaultDuration: 0.5,
	},
	{
		value: "slide",
		label: "Slide",
		description: "Slide the new clip in over the cut.",
		defaultDuration: 0.4,
	},
];

type SelectedVisualTarget = {
	track: TimelineTrack;
	element: VideoElement | ImageElement;
};

function resolveSelectedVisualTarget({
	editor,
}: {
	editor: ReturnType<typeof useEditor>;
}): SelectedVisualTarget | null {
	const selectedElements = editor.selection.getSelectedElements();
	if (selectedElements.length !== 1) return null;
	const selected = selectedElements[0];
	if (!selected) return null;
	const track = editor.timeline.getTrackById({ trackId: selected.trackId });
	if (!track || track.type !== "video") return null;
	const element = track.elements.find((candidate) => candidate.id === selected.elementId);
	if (!element || (element.type !== "video" && element.type !== "image")) return null;
	return { track, element };
}

export function TransitionsView() {
	const editor = useEditor();
	useElementSelection();

	const selectedTarget = resolveSelectedVisualTarget({ editor });
	const fps = editor.project.getActive()?.settings.fps ?? 30;
	const adjacency = selectedTarget
		? findAdjacentVisualIncomingTransitionTarget({
				track: selectedTarget.track as TimelineTrack & { type: "video" },
				elementId: selectedTarget.element.id,
				fps,
		  })
		: null;

	return (
		<PanelView title="Transitions">
			<div className="flex flex-col gap-3 p-2">
				{selectedTarget && adjacency ? (
					<p className="text-muted-foreground text-sm">
						Apply a transition into <span className="text-foreground">{selectedTarget.element.name}</span>.
					</p>
				) : (
					<div className="rounded-md border p-4">
						<p className="font-medium">Select an eligible clip</p>
						<p className="text-muted-foreground mt-1 text-sm">
							Transitions apply to a selected video or image clip that touches another visual clip immediately before it on the same video track.
						</p>
					</div>
				)}

				<div className="grid gap-3">
					{BUILT_IN_TRANSITIONS.map((transition) => (
						<div
							key={transition.value}
							className="flex items-center justify-between gap-3 rounded-md border p-3"
						>
							<div className="min-w-0">
								<p className="font-medium">{transition.label}</p>
								<p className="text-muted-foreground text-sm">
									{transition.description} Default {transition.defaultDuration.toFixed(1)}s.
								</p>
							</div>
							<Button
								size="sm"
								disabled={!selectedTarget || !adjacency}
								onClick={() => {
									if (!selectedTarget) return;
									editor.timeline.setElementTransitionIn({
										trackId: selectedTarget.track.id,
										elementId: selectedTarget.element.id,
										preset: transition.value,
										duration:
											selectedTarget.element.transitionIn?.preset === transition.value
												? selectedTarget.element.transitionIn.duration
												: transition.defaultDuration,
									});
								}}
							>
								Apply
							</Button>
						</div>
					))}
				</div>
			</div>
		</PanelView>
	);
}
