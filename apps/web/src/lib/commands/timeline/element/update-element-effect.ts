import { Command } from "@/lib/commands/base-command";
import { EditorCore } from "@/core";
import type { TimelineTrack, VisualEffect } from "@/types/timeline";

export class UpdateElementEffectCommand extends Command {
	private savedState: TimelineTrack[] | null = null;

	constructor(
		private readonly trackId: string,
		private readonly elementId: string,
		private readonly effectId: string,
		private readonly updates: Partial<VisualEffect>,
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
					const currentEffects = ((element as { effects?: VisualEffect[] | null }).effects ?? []).map((effect) =>
						effect.id === this.effectId ? ({ ...effect, ...this.updates } as VisualEffect) : effect,
					);
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
