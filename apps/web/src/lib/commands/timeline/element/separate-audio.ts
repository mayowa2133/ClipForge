import { EditorCore } from "@/core";
import { Command } from "@/lib/commands/base-command";
import { buildEmptyTrack, getDefaultInsertIndexForTrack } from "@/lib/timeline";
import type { TimelineTrack, VideoElement, AudioElement } from "@/types/timeline";
import { generateUUID } from "@/utils/id";

export class SeparateAudioCommand extends Command {
	private savedState: TimelineTrack[] | null = null;
	private previousSelection: Array<{ trackId: string; elementId: string }> = [];

	constructor(
		private trackId: string,
		private elementId: string,
	) {
		super();
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		this.savedState = editor.timeline.getTracks();
		this.previousSelection = editor.selection.getSelectedElements();

		const sourceTrack = this.savedState.find((track) => track.id === this.trackId);
		const sourceElement = sourceTrack?.elements.find(
			(element) => element.id === this.elementId,
		) as VideoElement | undefined;
		if (!sourceTrack || !sourceElement || sourceElement.type !== "video") {
			return;
		}

		const linkedGroupId = sourceElement.linkedGroupId ?? generateUUID();
		const detachedAudioId = generateUUID();
		const audioElement: AudioElement = {
			id: detachedAudioId,
			type: "audio",
			sourceType: "upload",
			mediaId: sourceElement.mediaId,
			name: `${sourceElement.name} audio`,
			startTime: sourceElement.startTime,
			duration: sourceElement.duration,
			trimStart: sourceElement.trimStart,
			trimEnd: sourceElement.trimEnd,
			role: "audio",
			volume: 1,
			normalizationGainDb: null,
			muted: false,
			playbackRate: sourceElement.playbackRate ?? 1,
			fadeInDuration: 0,
			fadeOutDuration: 0,
			linkedGroupId,
		};

		const existingAudioTrack = this.savedState.find((track) => track.type === "audio");
		const audioTrackId = existingAudioTrack?.id ?? generateUUID();
		const tracksWithAudioTrack =
			existingAudioTrack !== undefined
				? this.savedState
				: [
						...this.savedState.slice(
							0,
							getDefaultInsertIndexForTrack({
								tracks: this.savedState,
								trackType: "audio",
							}),
						),
						buildEmptyTrack({ id: audioTrackId, type: "audio" }),
						...this.savedState.slice(
							getDefaultInsertIndexForTrack({
								tracks: this.savedState,
								trackType: "audio",
							}),
						),
					];

		const updatedTracks = tracksWithAudioTrack.map((track) => {
			if (track.id === sourceTrack.id) {
				return {
					...track,
					elements: track.elements.map((element) =>
						element.id === sourceElement.id
							? {
									...element,
									muted: true,
									linkedGroupId,
								}
							: element,
					),
				} as TimelineTrack;
			}

			if (track.id === audioTrackId && track.type === "audio") {
				return {
					...track,
					elements: [...track.elements, audioElement].sort(
						(a, b) => a.startTime - b.startTime,
					),
				} as TimelineTrack;
			}

			return track;
		});

		editor.timeline.updateTracks(updatedTracks);
		editor.selection.setSelectedElements({
			elements: [
				{ trackId: sourceTrack.id, elementId: sourceElement.id },
				{ trackId: audioTrackId, elementId: detachedAudioId },
			],
		});
	}

	undo(): void {
		if (!this.savedState) return;
		const editor = EditorCore.getInstance();
		editor.timeline.updateTracks(this.savedState);
		editor.selection.setSelectedElements({ elements: this.previousSelection });
	}
}
