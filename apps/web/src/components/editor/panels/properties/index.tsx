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
	const selectedElementIds = selectedElements.map((selection) => selection.elementId);

	const rawElementsWithTracks = editor.timeline.getElementsWithTracks({
		elements: selectedElements,
	});
	const elementsWithTracks = collapseOverlaySelection({
		elementsWithTracks: rawElementsWithTracks,
	});
	const linkedSelectionLabel = getLinkedSelectionLabel({ elementsWithTracks });
	const selectionLabel = getSelectionSummaryLabel({ elementsWithTracks });

	return (
		<div className="panel bg-background flex h-full flex-col rounded-sm border border-t-0 overflow-hidden">
			<div className="border-b px-4 py-3">
				<div className="flex items-center justify-between gap-3">
					<p className="text-muted-foreground text-sm">Properties</p>
					<p className="text-xs font-medium">
						{selectionLabel ? `Selected: ${selectionLabel}` : "Selected: Nothing"}
					</p>
				</div>
			</div>
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
									<TextProperties
										element={element}
										trackId={track.id}
										selectedElementIds={selectedElementIds}
									/>
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

export function getSelectionSummaryLabel({
	elementsWithTracks,
}: {
	elementsWithTracks: Array<{ track: TimelineTrack; element: TimelineElement }>;
}): string | null {
	if (elementsWithTracks.length === 0) {
		return null;
	}
	if (elementsWithTracks.length > 1) {
		return `${elementsWithTracks.length} items`;
	}

	const [{ element }] = elementsWithTracks;
	if (!element) {
		return null;
	}
	if (element.type === "video" || element.type === "image") {
		return "Clip";
	}
	if (element.type === "audio") {
		return "Audio";
	}
	if (element.type === "sticker") {
		return "Sticker";
	}
	if (element.type === "text") {
		if (element.overlayMeta) {
			return "Overlay";
		}
		if (element.role === "caption") {
			return "Caption";
		}
		return "Text";
	}
	return null;
}

export function collapseOverlaySelection({
	elementsWithTracks,
}: {
	elementsWithTracks: Array<{ track: TimelineTrack; element: TimelineElement }>;
}): Array<{ track: TimelineTrack; element: TimelineElement }> {
	if (elementsWithTracks.length < 2) return elementsWithTracks;

	const textOverlays = elementsWithTracks.filter(
		(entry): entry is { track: TimelineTrack; element: Extract<TimelineElement, { type: "text" }> } =>
			entry.element.type === "text" && Boolean(entry.element.overlayMeta),
	);
	if (textOverlays.length !== elementsWithTracks.length) return elementsWithTracks;

	const linkedGroupIds = new Set(
		textOverlays
			.map((entry) => entry.element.linkedGroupId)
			.filter((value): value is string => typeof value === "string" && value.length > 0),
	);
	if (linkedGroupIds.size !== 1) return elementsWithTracks;

	return [textOverlays[0]];
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
