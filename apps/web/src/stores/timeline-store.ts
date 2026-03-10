/**
 * UI state for the timeline
 * For core logic, use EditorCore instead.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ClipboardItem } from "@/types/timeline";

interface TimelineStore {
	snappingEnabled: boolean;
	toggleSnapping: () => void;
	snapToBeats: boolean;
	setBeatSnapping: (enabled: boolean) => void;
	showBeatMarkers: boolean;
	setBeatMarkerVisibility: (enabled: boolean) => void;
	selectedBeatSourceMediaId: string | null;
	setSelectedBeatSourceMediaId: (mediaId: string | null) => void;
	rippleEditingEnabled: boolean;
	toggleRippleEditing: () => void;
	clipboard: {
		items: ClipboardItem[];
	} | null;
	setClipboard: (
		clipboard: {
			items: ClipboardItem[];
		} | null,
	) => void;
}

export const useTimelineStore = create<TimelineStore>()(
	persist(
		(set) => ({
			snappingEnabled: true,

			toggleSnapping: () => {
				set((state) => ({ snappingEnabled: !state.snappingEnabled }));
			},

			snapToBeats: false,

			setBeatSnapping: (enabled) => {
				set({ snapToBeats: enabled });
			},

			showBeatMarkers: true,

			setBeatMarkerVisibility: (enabled) => {
				set({ showBeatMarkers: enabled });
			},

			selectedBeatSourceMediaId: null,

			setSelectedBeatSourceMediaId: (mediaId) => {
				set({ selectedBeatSourceMediaId: mediaId });
			},

			rippleEditingEnabled: false,

			toggleRippleEditing: () => {
				set((state) => ({
					rippleEditingEnabled: !state.rippleEditingEnabled,
				}));
			},

			clipboard: null,

			setClipboard: (clipboard) => {
				set({ clipboard });
			},
		}),
		{
			name: "timeline-store",
			partialize: (state) => ({
				snappingEnabled: state.snappingEnabled,
				snapToBeats: state.snapToBeats,
				showBeatMarkers: state.showBeatMarkers,
				selectedBeatSourceMediaId: state.selectedBeatSourceMediaId,
				rippleEditingEnabled: state.rippleEditingEnabled,
			}),
		},
	),
);
