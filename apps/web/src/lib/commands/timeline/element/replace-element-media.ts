import { EditorCore } from "@/core";
import { Command } from "@/lib/commands/base-command";
import type { MediaAsset } from "@/types/assets";
import type {
	AudioElement,
	ImageElement,
	TimelineElement,
	TimelineTrack,
	VideoElement,
} from "@/types/timeline";

export class ReplaceElementMediaCommand extends Command {
	private savedState: TimelineTrack[] | null = null;

	constructor(
		private trackId: string,
		private elementId: string,
		private mediaAsset: MediaAsset,
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
					if (element.id !== this.elementId) {
						return element;
					}

					return replaceElementMedia({
						element,
						mediaAsset: this.mediaAsset,
					});
				}),
			} as TimelineTrack;
		});

		editor.timeline.updateTracks(updatedTracks);
	}

	undo(): void {
		if (!this.savedState) return;
		EditorCore.getInstance().timeline.updateTracks(this.savedState);
	}
}

function replaceElementMedia({
	element,
	mediaAsset,
}: {
	element: TimelineElement;
	mediaAsset: MediaAsset;
}): TimelineElement {
	if (element.type === "video") {
		return {
			...(element as VideoElement),
			mediaId: mediaAsset.id,
			name: mediaAsset.name,
		};
	}

	if (element.type === "image") {
		return {
			...(element as ImageElement),
			mediaId: mediaAsset.id,
			name: mediaAsset.name,
		};
	}

	if (element.type === "audio") {
		const nextElement: AudioElement =
			element.sourceType === "upload" || mediaAsset.type !== "audio"
				? {
						...element,
						sourceType: "upload",
						mediaId: mediaAsset.id,
						name: mediaAsset.name,
						buffer: undefined,
					}
				: {
						...element,
						sourceType: "upload",
						mediaId: mediaAsset.id,
						name: mediaAsset.name,
						buffer: undefined,
					};

		return nextElement;
	}

	return element;
}
