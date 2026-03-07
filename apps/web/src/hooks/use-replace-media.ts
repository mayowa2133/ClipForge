"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { processMediaAssets } from "@/lib/media/processing";
import { useEditor } from "@/hooks/use-editor";
import type { AudioElement, ImageElement, VideoElement } from "@/types/timeline";

type ReplaceableElement = AudioElement | ImageElement | VideoElement;

function getReplaceAccept({
	element,
}: {
	element: ReplaceableElement;
}): string {
	if (element.type === "video") return "video/*";
	if (element.type === "image") return "image/*";
	return "audio/*,video/*";
}

export function useReplaceMedia({
	trackId,
	element,
}: {
	trackId: string;
	element: ReplaceableElement;
}) {
	const editor = useEditor();
	const inputRef = useRef<HTMLInputElement>(null);
	const [isReplacing, setIsReplacing] = useState(false);

	const openReplaceMediaPicker = () => {
		inputRef.current?.click();
	};

	const handleReplaceMedia = async (file: File | null) => {
		if (!file) return;

		const activeProject = editor.project.getActive();
		if (!activeProject) {
			toast.error("No active project.");
			return;
		}

		setIsReplacing(true);
		try {
			const processedAssets = await processMediaAssets({
				files: [file],
			});
			const replacementAsset = processedAssets[0];
			if (!replacementAsset) {
				throw new Error("Failed to process replacement media.");
			}

			const importedAsset = await editor.media.addMediaAsset({
				projectId: activeProject.metadata.id,
				asset: replacementAsset,
			});
			if (!importedAsset) {
				throw new Error("Failed to import replacement media.");
			}

			editor.clipforge.initializeMediaMetadata({
				mediaAssets: [importedAsset],
			});

			try {
				editor.timeline.replaceElementMedia({
					trackId,
					elementId: element.id,
					mediaId: importedAsset.id,
				});
			} catch (error) {
				await editor.media.removeMediaAsset({
					projectId: activeProject.metadata.id,
					id: importedAsset.id,
				});
				throw error;
			}

			toast.success("Media replaced.");
		} catch (error) {
			toast.error("Replace Media failed.", {
				description:
					error instanceof Error ? error.message : "Please try again.",
			});
		} finally {
			setIsReplacing(false);
		}
	};

	return {
		isReplacing,
		openReplaceMediaPicker,
		fileInputProps: {
			ref: inputRef,
			type: "file" as const,
			accept: getReplaceAccept({ element }),
			style: { display: "none" as const },
			multiple: false,
			onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
				const file = event.target.files?.[0] ?? null;
				event.currentTarget.value = "";
				void handleReplaceMedia(file);
			},
		},
	};
}
