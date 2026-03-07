import { Command } from "@/lib/commands/base-command";
import { EditorCore } from "@/core";
import {
	isVisualElementWithMotion,
	setPropertyKeyframeValue,
	type AnimatableVisualProperty,
} from "@/lib/timeline";
import type { TimelineTrack } from "@/types/timeline";

export class SetElementKeyframeCommand extends Command {
	private savedState: TimelineTrack[] | null = null;

	constructor(
		private readonly trackId: string,
		private readonly elementId: string,
		private readonly property: AnimatableVisualProperty,
		private readonly localTime: number,
		private readonly value: number,
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
						keyframes: setPropertyKeyframeValue({
							element,
							property: this.property,
							localTime: this.localTime,
							value: this.value,
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
