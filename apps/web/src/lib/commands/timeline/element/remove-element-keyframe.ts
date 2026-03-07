import { Command } from "@/lib/commands/base-command";
import { EditorCore } from "@/core";
import {
	isVisualElementWithMotion,
	removePropertyKeyframeValue,
	type AnimatableVisualProperty,
} from "@/lib/timeline";
import type { TimelineTrack } from "@/types/timeline";

export class RemoveElementKeyframeCommand extends Command {
	private savedState: TimelineTrack[] | null = null;

	constructor(
		private readonly trackId: string,
		private readonly elementId: string,
		private readonly property: AnimatableVisualProperty,
		private readonly localTime: number,
	) {
		super();
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		this.savedState = editor.timeline.getTracks();
		const updatedTracks = this.savedState.map((track) => {
			if (track.id !== this.trackId) return track;
			return {
				...track,
				elements: track.elements.map((element) => {
					if (element.id !== this.elementId || !isVisualElementWithMotion(element)) {
						return element;
					}
					return {
						...element,
						keyframes: removePropertyKeyframeValue({
							element,
							property: this.property,
							localTime: this.localTime,
						}),
					};
				}),
			} as typeof track;
		});
		editor.timeline.updateTracks(updatedTracks);
	}

	undo(): void {
		if (!this.savedState) return;
		EditorCore.getInstance().timeline.updateTracks(this.savedState);
	}
}
