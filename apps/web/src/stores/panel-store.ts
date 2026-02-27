import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PANEL_CONFIG } from "@/constants/editor-constants";

export interface PanelSizes {
	tools: number;
	preview: number;
	rightSidebar: number;
	mainContent: number;
	timeline: number;
	inspector: number;
	chat: number;
}

export type PanelId = keyof PanelSizes;

interface PanelState {
	panels: PanelSizes;
	setPanel: (panel: PanelId, size: number) => void;
	setPanels: (sizes: Partial<PanelSizes>) => void;
	resetPanels: () => void;
}

type PersistedPanelsShape =
	| (Partial<PanelSizes> & { properties?: number })
	| null
	| undefined;

type LegacyPersistedPanelState =
	| {
			panels?: PersistedPanelsShape;
			toolsPanel?: number;
			previewPanel?: number;
			propertiesPanel?: number;
			mainContent?: number;
			timeline?: number;
			tools?: number;
			preview?: number;
			properties?: number;
	  }
	| undefined
	| null;

function toNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePanels(panels: PersistedPanelsShape): PanelSizes {
	return {
		tools: toNumber(panels?.tools) ?? PANEL_CONFIG.panels.tools,
		preview: toNumber(panels?.preview) ?? PANEL_CONFIG.panels.preview,
		rightSidebar:
			toNumber(panels?.rightSidebar) ??
			toNumber(panels?.properties) ??
			PANEL_CONFIG.panels.rightSidebar,
		mainContent: toNumber(panels?.mainContent) ?? PANEL_CONFIG.panels.mainContent,
		timeline: toNumber(panels?.timeline) ?? PANEL_CONFIG.panels.timeline,
		inspector: toNumber(panels?.inspector) ?? PANEL_CONFIG.panels.inspector,
		chat: toNumber(panels?.chat) ?? PANEL_CONFIG.panels.chat,
	};
}

export function migratePanelState(persistedState: unknown): {
	panels: PanelSizes;
} {
	const state = persistedState as LegacyPersistedPanelState;

	if (!state) return { panels: { ...PANEL_CONFIG.panels } };

	if (state.panels && typeof state.panels === "object") {
		return { panels: normalizePanels(state.panels) };
	}

	return {
		panels: normalizePanels({
			tools: state.tools ?? state.toolsPanel,
			preview: state.preview ?? state.previewPanel,
			properties: state.properties ?? state.propertiesPanel,
			mainContent: state.mainContent,
			timeline: state.timeline,
		}),
	};
}

export const usePanelStore = create<PanelState>()(
	persist(
		(set) => ({
			...PANEL_CONFIG,
			setPanel: (panel, size) =>
				set((state) => ({
					panels: {
						...state.panels,
						[panel]: size,
					},
				})),
			setPanels: (sizes) =>
				set((state) => ({
					panels: {
						...state.panels,
						...sizes,
					},
				})),
			resetPanels: () => set({ ...PANEL_CONFIG }),
		}),
		{
			name: "panel-sizes",
			version: 3,
			migrate: (persistedState) => migratePanelState(persistedState),
			partialize: (state) => ({
				panels: state.panels,
			}),
		},
	),
);
