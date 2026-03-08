import { Command } from "@/lib/commands/base-command";
import { EditorCore } from "@/core";
import type { TimelineTrack, VisualEffect } from "@/types/timeline";

export class MoveElementEffectCommand extends Command {
	private savedState: TimelineTrack[] | null = null;

	constructor(
		private readonly trackId: string,
		private readonly elementId: string,
		private readonly effectId: string,
		private readonly toIndex: number,
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
					const currentEffects = [...
						((element as { effects?: VisualEffect[] | null }).effects ?? [])
					];
					const currentIndex = currentEffects.findIndex((effect) => effect.id === this.effectId);
					if (currentIndex === -1) return element;
					const [effect] = currentEffects.splice(currentIndex, 1);
					const nextIndex = Math.max(0, Math.min(currentEffects.length, this.toIndex));
					currentEffects.splice(nextIndex, 0, effect);
					return { ...element, effects: currentEffects };
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
