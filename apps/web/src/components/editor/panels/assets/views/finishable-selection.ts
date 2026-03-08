import { useEditor } from "@/hooks/use-editor";
import type { ImageElement, TimelineTrack, VideoElement } from "@/types/timeline";

export type SelectedFinishableTarget = {
	track: TimelineTrack;
	element: VideoElement | ImageElement;
};

export function resolveSelectedFinishableTarget({
	editor,
}: {
	editor: ReturnType<typeof useEditor>;
}): SelectedFinishableTarget | null {
	const selectedElements = editor.selection.getSelectedElements();
	const finishableTargets = new Map<string, SelectedFinishableTarget>();

	for (const selected of selectedElements) {
		const track = editor.timeline.getTrackById({ trackId: selected.trackId });
		if (!track || track.type !== "video") continue;
		const element = track.elements.find((candidate) => candidate.id === selected.elementId);
		if (!element || (element.type !== "video" && element.type !== "image")) continue;
		finishableTargets.set(`${track.id}:${element.id}`, { track, element });
	}

	if (finishableTargets.size !== 1) return null;
	return [...finishableTargets.values()][0] ?? null;
}
