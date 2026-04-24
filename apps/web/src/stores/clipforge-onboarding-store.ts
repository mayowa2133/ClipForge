import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ClipForgeOnboardingPersistedState {
	hasSeenIntro?: unknown;
	hasCompletedDemoGuide?: unknown;
	hasCompletedFirstImport?: unknown;
	hasCompletedFirstAssistantAction?: unknown;
	hasCompletedFirstExport?: unknown;
}

interface ClipForgeOnboardingState {
	hasSeenIntro: boolean;
	hasCompletedDemoGuide: boolean;
	hasCompletedFirstImport: boolean;
	hasCompletedFirstAssistantAction: boolean;
	hasCompletedFirstExport: boolean;
	pendingGuide: boolean;
	markIntroSeen: () => void;
	markDemoGuideCompleted: () => void;
	markFirstImportCompleted: () => void;
	markFirstAssistantActionCompleted: () => void;
	markFirstExportCompleted: () => void;
	startPendingGuide: () => void;
	clearPendingGuide: () => void;
	resetForDebug: () => void;
}

export function migrateClipForgeOnboardingState(
	persistedState: unknown,
): {
	hasSeenIntro: boolean;
	hasCompletedDemoGuide: boolean;
	hasCompletedFirstImport: boolean;
	hasCompletedFirstAssistantAction: boolean;
	hasCompletedFirstExport: boolean;
} {
	const state = persistedState as ClipForgeOnboardingPersistedState | null | undefined;

	return {
		hasSeenIntro:
			typeof state?.hasSeenIntro === "boolean" ? state.hasSeenIntro : false,
		hasCompletedDemoGuide:
			typeof state?.hasCompletedDemoGuide === "boolean"
				? state.hasCompletedDemoGuide
				: false,
		hasCompletedFirstImport:
			typeof state?.hasCompletedFirstImport === "boolean"
				? state.hasCompletedFirstImport
				: false,
		hasCompletedFirstAssistantAction:
			typeof state?.hasCompletedFirstAssistantAction === "boolean"
				? state.hasCompletedFirstAssistantAction
				: false,
		hasCompletedFirstExport:
			typeof state?.hasCompletedFirstExport === "boolean"
				? state.hasCompletedFirstExport
				: false,
	};
}

export const useClipForgeOnboardingStore = create<ClipForgeOnboardingState>()(
	persist(
		(set) => ({
			hasSeenIntro: false,
			hasCompletedDemoGuide: false,
			hasCompletedFirstImport: false,
			hasCompletedFirstAssistantAction: false,
			hasCompletedFirstExport: false,
			pendingGuide: false,
			markIntroSeen: () => set({ hasSeenIntro: true }),
			markDemoGuideCompleted: () =>
				set({ hasCompletedDemoGuide: true, pendingGuide: false }),
			markFirstImportCompleted: () => set({ hasCompletedFirstImport: true }),
			markFirstAssistantActionCompleted: () =>
				set({ hasCompletedFirstAssistantAction: true }),
			markFirstExportCompleted: () => set({ hasCompletedFirstExport: true }),
			startPendingGuide: () => set({ pendingGuide: true, hasSeenIntro: true }),
			clearPendingGuide: () => set({ pendingGuide: false }),
			resetForDebug: () =>
				set({
					hasSeenIntro: false,
					hasCompletedDemoGuide: false,
					hasCompletedFirstImport: false,
					hasCompletedFirstAssistantAction: false,
					hasCompletedFirstExport: false,
					pendingGuide: false,
				}),
		}),
		{
			name: "clipforge-onboarding",
			version: 2,
			migrate: (persistedState) =>
				migrateClipForgeOnboardingState(persistedState),
			partialize: (state) => ({
				hasSeenIntro: state.hasSeenIntro,
				hasCompletedDemoGuide: state.hasCompletedDemoGuide,
				hasCompletedFirstImport: state.hasCompletedFirstImport,
				hasCompletedFirstAssistantAction: state.hasCompletedFirstAssistantAction,
				hasCompletedFirstExport: state.hasCompletedFirstExport,
			}),
		},
	),
);
