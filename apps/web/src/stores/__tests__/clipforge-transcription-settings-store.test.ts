import { beforeEach, describe, expect, test } from "bun:test";
import {
	migrateClipForgeTranscriptionSettingsState,
	useClipForgeTranscriptionSettingsStore,
} from "@/stores/clipforge-transcription-settings-store";
import { CLIPFORGE_MANAGED_TRANSCRIBER_DEFAULT } from "@/constants/feature-flags";

describe("clipforge-transcription-settings-store", () => {
	beforeEach(() => {
		useClipForgeTranscriptionSettingsStore.getState().resetUseManagedCloud();
	});

	test("defaults to the env-derived value", () => {
		expect(
			useClipForgeTranscriptionSettingsStore.getState().useManagedCloud,
		).toBe(CLIPFORGE_MANAGED_TRANSCRIBER_DEFAULT);
	});

	test("setUseManagedCloud updates state, reset restores default", () => {
		useClipForgeTranscriptionSettingsStore.getState().setUseManagedCloud(true);
		expect(
			useClipForgeTranscriptionSettingsStore.getState().useManagedCloud,
		).toBe(true);
		useClipForgeTranscriptionSettingsStore.getState().setUseManagedCloud(false);
		expect(
			useClipForgeTranscriptionSettingsStore.getState().useManagedCloud,
		).toBe(false);
		useClipForgeTranscriptionSettingsStore.getState().resetUseManagedCloud();
		expect(
			useClipForgeTranscriptionSettingsStore.getState().useManagedCloud,
		).toBe(CLIPFORGE_MANAGED_TRANSCRIBER_DEFAULT);
	});

	test("migrate keeps boolean values, falls back otherwise", () => {
		expect(
			migrateClipForgeTranscriptionSettingsState({ useManagedCloud: true }),
		).toEqual({ useManagedCloud: true });
		expect(
			migrateClipForgeTranscriptionSettingsState({ useManagedCloud: false }),
		).toEqual({ useManagedCloud: false });
		expect(
			migrateClipForgeTranscriptionSettingsState({ useManagedCloud: "yes" }),
		).toEqual({ useManagedCloud: CLIPFORGE_MANAGED_TRANSCRIBER_DEFAULT });
		expect(migrateClipForgeTranscriptionSettingsState(null)).toEqual({
			useManagedCloud: CLIPFORGE_MANAGED_TRANSCRIBER_DEFAULT,
		});
	});
});
