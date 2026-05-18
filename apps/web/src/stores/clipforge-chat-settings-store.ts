import { CLIPFORGE_CHAT_PLANNER_MODE } from "@/constants/feature-flags";
import type { ChatPlannerMode } from "@/lib/clipforge/chat";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ClipForgeChatSettingsState {
	plannerMode: ChatPlannerMode;
	setPlannerMode: (mode: ChatPlannerMode) => void;
	resetPlannerMode: () => void;
}

export const DEFAULT_CLIPFORGE_CHAT_PLANNER_MODE = CLIPFORGE_CHAT_PLANNER_MODE;

export function migrateClipForgeChatSettingsState(persistedState: unknown): {
	plannerMode: ChatPlannerMode;
} {
	const state = persistedState as { plannerMode?: unknown } | null | undefined;
	const plannerMode = state?.plannerMode;

	return {
		plannerMode:
			plannerMode === "heuristic" || plannerMode === "openai" || plannerMode === "anthropic" || plannerMode === "auto"
				? plannerMode
				: DEFAULT_CLIPFORGE_CHAT_PLANNER_MODE,
	};
}

export const useClipForgeChatSettingsStore =
	create<ClipForgeChatSettingsState>()(
		persist(
			(set) => ({
				plannerMode: DEFAULT_CLIPFORGE_CHAT_PLANNER_MODE,
				setPlannerMode: (mode) => set({ plannerMode: mode }),
				resetPlannerMode: () =>
					set({ plannerMode: DEFAULT_CLIPFORGE_CHAT_PLANNER_MODE }),
			}),
			{
				name: "clipforge-chat-settings",
				version: 1,
				migrate: (persistedState) =>
					migrateClipForgeChatSettingsState(persistedState),
				partialize: (state) => ({ plannerMode: state.plannerMode }),
			},
		),
	);
