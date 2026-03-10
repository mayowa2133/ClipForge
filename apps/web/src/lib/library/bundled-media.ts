import { buildUnknownMediaCompatibilitySnapshot } from "@/lib/media/media-compatibility";
import type { AudioLibraryItem } from "@/types/library";
import type { MediaAsset, MediaBeatAnalysis } from "@/types/assets";
import type { EditorCore } from "@/core";

function buildBundledBeatAnalysis({
	bpm,
	duration,
}: {
	bpm: number;
	duration: number;
}): MediaBeatAnalysis {
	const secondsPerBeat = 60 / bpm;
	const beats: number[] = [];
	const downbeats: number[] = [];

	for (let time = 0; time <= duration + 0.0001; time += secondsPerBeat) {
		const rounded = Number(time.toFixed(3));
		beats.push(rounded);
		if ((beats.length - 1) % 4 === 0) {
			downbeats.push(rounded);
		}
	}

	return {
		bpm,
		beats,
		downbeats,
		analyzedAt: new Date().toISOString(),
		version: 1,
	};
}

export async function ensureBundledAudioAsset({
	editor,
	item,
}: {
	editor: EditorCore;
	item: AudioLibraryItem;
}): Promise<MediaAsset> {
	const activeProject = editor.project.getActive();
	if (!activeProject) {
		throw new Error("Open a project before using bundled audio.");
	}

	const existingAsset =
		editor.media
			.getAssets()
			.find((asset) => asset.libraryItemId === item.id) ?? null;
	if (existingAsset) {
		return existingAsset;
	}

	const response = await fetch(item.url);
	if (!response.ok) {
		throw new Error(`Failed to load bundled audio: ${item.label}`);
	}
	const blob = await response.blob();
	const extension = blob.type.includes("wav") ? "wav" : "audio";
	const file = new File([blob], `${item.label}.${extension}`, {
		type: blob.type || "audio/wav",
	});

	const added = await editor.media.addMediaAsset({
		projectId: activeProject.metadata.id,
		asset: {
			name: file.name,
			type: "audio",
			file,
			url: URL.createObjectURL(file),
			duration: item.duration,
			mimeType: file.type,
			libraryItemId: item.id,
			compatibility: buildUnknownMediaCompatibilitySnapshot(),
			beatAnalysis:
				item.kind === "music" && typeof item.bpm === "number"
					? buildBundledBeatAnalysis({
							bpm: item.bpm,
							duration: item.duration,
						})
					: undefined,
		},
	});

	if (!added) {
		throw new Error(`Failed to import bundled audio: ${item.label}`);
	}
	return added;
}
