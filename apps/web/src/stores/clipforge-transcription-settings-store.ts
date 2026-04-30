import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CLIPFORGE_MANAGED_TRANSCRIBER_DEFAULT } from "@/constants/feature-flags";

interface ClipForgeTranscriptionSettingsState {
	useManagedCloud: boolean;
	setUseManagedCloud: (next: boolean) => void;
	resetUseManagedCloud: () => void;
}

export function migrateClipForgeTranscriptionSettingsState(
	persistedState: unknown,
): { useManagedCloud: boolean } {
	const state = persistedState as { useManagedCloud?: unknown } | null | undefined;
	const useManagedCloud = state?.useManagedCloud;
	return {
		useManagedCloud:
			typeof useManagedCloud === "boolean"
				? useManagedCloud
				: CLIPFORGE_MANAGED_TRANSCRIBER_DEFAULT,
	};
}

export const useClipForgeTranscriptionSettingsStore =
	create<ClipForgeTranscriptionSettingsState>()(
		persist(
			(set) => ({
				useManagedCloud: CLIPFORGE_MANAGED_TRANSCRIBER_DEFAULT,
				setUseManagedCloud: (useManagedCloud) => set({ useManagedCloud }),
				resetUseManagedCloud: () =>
					set({ useManagedCloud: CLIPFORGE_MANAGED_TRANSCRIBER_DEFAULT }),
			}),
			{
				name: "clipforge-transcription-settings",
				version: 1,
				migrate: (persistedState) =>
					migrateClipForgeTranscriptionSettingsState(persistedState),
				partialize: (state) => ({ useManagedCloud: state.useManagedCloud }),
			},
		),
	);
