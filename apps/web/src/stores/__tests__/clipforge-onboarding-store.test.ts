import { beforeEach, describe, expect, test } from "bun:test";
import {
	migrateClipForgeOnboardingState,
	useClipForgeOnboardingStore,
} from "@/stores/clipforge-onboarding-store";

describe("clipforge-onboarding-store", () => {
	beforeEach(() => {
		useClipForgeOnboardingStore.getState().resetForDebug();
	});

	test("intro and guide flags update predictably", () => {
		const store = useClipForgeOnboardingStore.getState();

		expect(store.hasSeenIntro).toBe(false);
		expect(store.hasCompletedDemoGuide).toBe(false);
		expect(store.pendingGuide).toBe(false);

		store.markIntroSeen();
		expect(useClipForgeOnboardingStore.getState().hasSeenIntro).toBe(true);

		useClipForgeOnboardingStore.getState().startPendingGuide();
		expect(useClipForgeOnboardingStore.getState().pendingGuide).toBe(true);

		useClipForgeOnboardingStore.getState().markDemoGuideCompleted();
		expect(useClipForgeOnboardingStore.getState().hasCompletedDemoGuide).toBe(true);
		expect(useClipForgeOnboardingStore.getState().pendingGuide).toBe(false);
	});

	test("migrate restores persisted booleans", () => {
		expect(
			migrateClipForgeOnboardingState({
				hasSeenIntro: true,
				hasCompletedDemoGuide: false,
			}),
		).toEqual({
			hasSeenIntro: true,
			hasCompletedDemoGuide: false,
		});
	});
});
