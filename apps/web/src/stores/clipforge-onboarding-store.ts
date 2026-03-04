import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ClipForgeOnboardingPersistedState {
	hasSeenIntro?: unknown;
	hasCompletedDemoGuide?: unknown;
}

interface ClipForgeOnboardingState {
	hasSeenIntro: boolean;
	hasCompletedDemoGuide: boolean;
	pendingGuide: boolean;
	markIntroSeen: () => void;
	markDemoGuideCompleted: () => void;
	startPendingGuide: () => void;
	clearPendingGuide: () => void;
	resetForDebug: () => void;
}

export function migrateClipForgeOnboardingState(
	persistedState: unknown,
): {
	hasSeenIntro: boolean;
	hasCompletedDemoGuide: boolean;
} {
	const state = persistedState as ClipForgeOnboardingPersistedState | null | undefined;

	return {
		hasSeenIntro:
			typeof state?.hasSeenIntro === "boolean" ? state.hasSeenIntro : false,
		hasCompletedDemoGuide:
			typeof state?.hasCompletedDemoGuide === "boolean"
				? state.hasCompletedDemoGuide
				: false,
	};
}

export const useClipForgeOnboardingStore = create<ClipForgeOnboardingState>()(
	persist(
		(set) => ({
			hasSeenIntro: false,
			hasCompletedDemoGuide: false,
			pendingGuide: false,
			markIntroSeen: () => set({ hasSeenIntro: true }),
			markDemoGuideCompleted: () =>
				set({ hasCompletedDemoGuide: true, pendingGuide: false }),
			startPendingGuide: () => set({ pendingGuide: true, hasSeenIntro: true }),
			clearPendingGuide: () => set({ pendingGuide: false }),
			resetForDebug: () =>
				set({
					hasSeenIntro: false,
					hasCompletedDemoGuide: false,
					pendingGuide: false,
				}),
		}),
		{
			name: "clipforge-onboarding",
			version: 1,
			migrate: (persistedState) =>
				migrateClipForgeOnboardingState(persistedState),
			partialize: (state) => ({
				hasSeenIntro: state.hasSeenIntro,
				hasCompletedDemoGuide: state.hasCompletedDemoGuide,
			}),
		},
	),
);
