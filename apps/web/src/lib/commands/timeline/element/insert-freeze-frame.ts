import { EditorCore } from "@/core";
import { Command } from "@/lib/commands/base-command";
import {
	buildImageElement,
	getElementPlaybackRate,
} from "@/lib/timeline";
import {
	shiftTrackElementsAfterTime,
} from "@/lib/timeline/manual-editing";
import type { ImageElement, TimelineTrack, VideoElement } from "@/types/timeline";
import { generateUUID } from "@/utils/id";

export class InsertFreezeFrameCommand extends Command {
	private savedState: TimelineTrack[] | null = null;
	private previousSelection: Array<{ trackId: string; elementId: string }> = [];

	constructor(
		private trackId: string,
		private elementId: string,
		private mediaId: string,
		private mediaName: string,
		private atTime: number,
		private duration: number,
		private ripple: boolean,
	) {
		super();
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		this.savedState = editor.timeline.getTracks();
		this.previousSelection = editor.selection.getSelectedElements();

		const updatedTracks = this.savedState.map((track) => {
			if (track.id !== this.trackId) return track;

			const targetElement = track.elements.find(
				(element) => element.id === this.elementId,
			) as VideoElement | undefined;
			if (!targetElement || targetElement.type !== "video") {
				return track;
			}

			const freezeElement: ImageElement = {
				id: generateUUID(),
				...buildImageElement({
					mediaId: this.mediaId,
					name: `${this.mediaName} freeze`,
					duration: this.duration,
					startTime: this.atTime,
				}),
				linkedGroupId: targetElement.linkedGroupId ?? null,
			};

			const clipStart = targetElement.startTime;
			const clipEnd = targetElement.startTime + targetElement.duration;
			const isInside = this.atTime > clipStart && this.atTime < clipEnd;
			const timelineDelta = this.duration;
			const splitOffset = this.atTime - clipStart;
			const sourceOffset =
				splitOffset * getElementPlaybackRate({ element: targetElement });

			let nextElements = track.elements.filter((element) => element.id !== targetElement.id);

			if (isInside) {
				const rightElementId = generateUUID();
				const left = {
					...targetElement,
					duration: splitOffset,
					trimEnd:
						targetElement.trimEnd +
						(clipEnd - this.atTime) *
							getElementPlaybackRate({ element: targetElement }),
					name: `${targetElement.name} (left)`,
				};
				const right = {
					...targetElement,
					id: rightElementId,
					startTime: this.atTime + this.duration,
					duration: clipEnd - this.atTime,
					trimStart: targetElement.trimStart + sourceOffset,
					name: `${targetElement.name} (right)`,
				};
				nextElements = [...nextElements, left, freezeElement, right];
			} else {
				const insertionTime = this.atTime <= clipStart ? clipStart : clipEnd;
				freezeElement.startTime = insertionTime;
				nextElements = [...nextElements, targetElement, freezeElement];
			}

			let nextTrack: TimelineTrack = {
				...track,
				elements: nextElements.sort((a, b) => a.startTime - b.startTime),
			} as TimelineTrack;

			if (this.ripple) {
				const shiftStart = this.atTime;
				nextTrack = shiftTrackElementsAfterTime({
					track: nextTrack,
					time: shiftStart,
					delta: timelineDelta,
					excludeElementId: freezeElement.id,
				});
			}

			return nextTrack;
		});

		editor.timeline.updateTracks(updatedTracks);
	}

	undo(): void {
		if (!this.savedState) return;
		const editor = EditorCore.getInstance();
		editor.timeline.updateTracks(this.savedState);
		editor.selection.setSelectedElements({ elements: this.previousSelection });
	}
}
