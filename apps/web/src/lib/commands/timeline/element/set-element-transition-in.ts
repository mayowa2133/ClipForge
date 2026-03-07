import { Command } from "@/lib/commands/base-command";
import { EditorCore } from "@/core";
import type { ElementTransitionIn, TimelineTrack } from "@/types/timeline";

export class SetElementTransitionInCommand extends Command {
	private savedState: TimelineTrack[] | null = null;

	constructor(
		private readonly trackId: string,
		private readonly elementId: string,
		private readonly transitionIn: ElementTransitionIn,
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
				elements: track.elements.map((element) =>
					element.id === this.elementId
						? { ...element, transitionIn: this.transitionIn }
						: element,
				),
			} as typeof track;
		});
		editor.timeline.updateTracks(updatedTracks);
	}

	undo(): void {
		if (!this.savedState) return;
		EditorCore.getInstance().timeline.updateTracks(this.savedState);
	}
}
