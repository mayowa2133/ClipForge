import { beforeEach, describe, expect, test } from "bun:test";
import {
	DEFAULT_CLIPFORGE_CHAT_PLANNER_MODE,
	migrateClipForgeChatSettingsState,
	useClipForgeChatSettingsStore,
} from "@/stores/clipforge-chat-settings-store";

describe("clipforge-chat-settings-store", () => {
	beforeEach(() => {
		useClipForgeChatSettingsStore.getState().resetPlannerMode();
	});

	test("defaults to the env-derived planner mode", () => {
		expect(useClipForgeChatSettingsStore.getState().plannerMode).toBe(
			DEFAULT_CLIPFORGE_CHAT_PLANNER_MODE,
		);
	});

	test("persists planner mode updates and resets correctly", () => {
		useClipForgeChatSettingsStore.getState().setPlannerMode("openai");
		expect(useClipForgeChatSettingsStore.getState().plannerMode).toBe("openai");

		useClipForgeChatSettingsStore.getState().resetPlannerMode();
		expect(useClipForgeChatSettingsStore.getState().plannerMode).toBe(
			DEFAULT_CLIPFORGE_CHAT_PLANNER_MODE,
		);
	});

	test("migrate restores valid planner modes and falls back otherwise", () => {
		expect(
			migrateClipForgeChatSettingsState({ plannerMode: "heuristic" }),
		).toEqual({
			plannerMode: "heuristic",
		});
		expect(migrateClipForgeChatSettingsState({ plannerMode: "invalid" })).toEqual({
			plannerMode: DEFAULT_CLIPFORGE_CHAT_PLANNER_MODE,
		});
	});
});
