import { EditorCore } from "@/core";
import { Command } from "@/lib/commands/base-command";
import {
	clampPlaybackRate,
	getElementVisibleSourceSpan,
	getPlaybackDurationForSourceSpan,
	shiftTrackElementsAfterTime,
} from "@/lib/timeline/manual-editing";
import type { TimelineTrack } from "@/types/timeline";

export class UpdateElementPlaybackRateCommand extends Command {
	private savedState: TimelineTrack[] | null = null;

	constructor(
		private trackId: string,
		private elementId: string,
		private playbackRate: number,
		private ripple: boolean,
	) {
		super();
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		this.savedState = editor.timeline.getTracks();
		const nextPlaybackRate = clampPlaybackRate({
			playbackRate: this.playbackRate,
		});

		const updatedTracks = this.savedState.map((track) => {
			if (track.id !== this.trackId) return track;

			const targetElement = track.elements.find((element) => element.id === this.elementId);
			if (!targetElement) return track;

			const nextDuration = getPlaybackDurationForSourceSpan({
				sourceSpan: getElementVisibleSourceSpan({ element: targetElement }),
				playbackRate: nextPlaybackRate,
			});
			const durationDelta = nextDuration - targetElement.duration;

			let nextTrack: TimelineTrack = {
				...track,
				elements: track.elements.map((element) =>
					element.id === this.elementId
						? {
								...element,
								playbackRate: nextPlaybackRate,
								duration: nextDuration,
							}
						: element,
				),
			} as TimelineTrack;

			if (this.ripple && durationDelta !== 0) {
				nextTrack = shiftTrackElementsAfterTime({
					track: nextTrack,
					time: targetElement.startTime + targetElement.duration,
					delta: durationDelta,
					excludeElementId: this.elementId,
				});
			}

			return nextTrack;
		});

		editor.timeline.updateTracks(updatedTracks);
	}

	undo(): void {
		if (!this.savedState) return;
		EditorCore.getInstance().timeline.updateTracks(this.savedState);
	}
}
