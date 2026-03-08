import { Command } from "@/lib/commands/base-command";
import { EditorCore } from "@/core";
import type { TimelineTrack, VisualAdjustments } from "@/types/timeline";

export class SetElementAdjustmentsCommand extends Command {
	private savedState: TimelineTrack[] | null = null;

	constructor(
		private readonly trackId: string,
		private readonly elementId: string,
		private readonly adjustments: VisualAdjustments | null,
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
						? { ...element, adjustments: this.adjustments }
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
