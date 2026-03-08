import { Command } from "@/lib/commands/base-command";
import { EditorCore } from "@/core";
import type { TimelineTrack, VisualEffect } from "@/types/timeline";

export class AddElementEffectCommand extends Command {
	private savedState: TimelineTrack[] | null = null;

	constructor(
		private readonly trackId: string,
		private readonly elementId: string,
		private readonly effect: VisualEffect,
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
					if (element.id !== this.elementId) return element;
					const existingEffects = Array.isArray((element as { effects?: VisualEffect[] | null }).effects)
						? ((element as { effects?: VisualEffect[] | null }).effects ?? [])
						: [];
					return {
						...element,
						effects: [...existingEffects, this.effect],
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
