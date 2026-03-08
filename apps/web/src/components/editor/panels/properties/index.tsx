"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AudioProperties } from "./audio-properties";
import { VideoProperties } from "./video-properties";
import { TextProperties } from "./text-properties";
import { EmptyView } from "./empty-view";
import { useEditor } from "@/hooks/use-editor";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import { getElementLinkedGroupId } from "@/lib/timeline";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";

export function PropertiesPanel() {
	const editor = useEditor();
	const { selectedElements } = useElementSelection();

	const elementsWithTracks = editor.timeline.getElementsWithTracks({
		elements: selectedElements,
	});
	const linkedSelectionLabel = getLinkedSelectionLabel({ elementsWithTracks });

	return (
		<div className="panel bg-background h-full rounded-sm border border-t-0 overflow-hidden">
			{selectedElements.length > 0 ? (
				<ScrollArea className="h-full scrollbar-hidden">
					{linkedSelectionLabel ? (
						<div className="border-b px-4 py-3">
							<Badge variant="outline" className="gap-2 px-2 py-1 text-[11px] font-medium">
								<span>Linked</span>
								<span className="text-muted-foreground">{linkedSelectionLabel}</span>
							</Badge>
						</div>
					) : null}
					{elementsWithTracks.map(({ track, element }) => {
						if (element.type === "text") {
							return (
								<div key={element.id}>
									<TextProperties element={element} trackId={track.id} />
								</div>
							);
						}
						if (element.type === "audio") {
							return (
								<AudioProperties
									key={element.id}
									element={element}
									trackId={track.id}
								/>
							);
						}
						if (
							element.type === "video" ||
							element.type === "image" ||
							element.type === "sticker"
						) {
							return (
								<div key={element.id}>
									<VideoProperties element={element} trackId={track.id} />
								</div>
							);
						}
						return null;
					})}
				</ScrollArea>
			) : (
				<EmptyView />
			)}
		</div>
	);
}

export function getLinkedSelectionLabel({
	elementsWithTracks,
}: {
	elementsWithTracks: Array<{ track: TimelineTrack; element: TimelineElement }>;
}): string | null {
	if (elementsWithTracks.length < 2) return null;

	const linkedGroupIds = new Set(
		elementsWithTracks
			.map(({ element }) => getElementLinkedGroupId({ element }))
			.filter((value): value is string => typeof value === "string" && value.length > 0),
	);
	if (linkedGroupIds.size !== 1) return null;

	const hasAudio = elementsWithTracks.some(({ element }) => element.type === "audio");
	const hasVisual = elementsWithTracks.some(
		({ element }) => element.type === "video" || element.type === "image",
	);
	if (!hasAudio || !hasVisual) return null;

	return "Video + Audio";
}
