import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ChatPanelPersistedState {
	isOpen?: unknown;
}

interface ChatPanelState {
	isOpen: boolean;
	open: () => void;
	close: () => void;
	toggle: () => void;
}

export function migrateChatPanelState(persistedState: unknown): {
	isOpen: boolean;
} {
	const state = persistedState as ChatPanelPersistedState | null | undefined;

	return {
		isOpen: typeof state?.isOpen === "boolean" ? state.isOpen : true,
	};
}

export const useChatPanelStore = create<ChatPanelState>()(
	persist(
		(set) => ({
			isOpen: true,
			open: () => set({ isOpen: true }),
			close: () => set({ isOpen: false }),
			toggle: () => set((state) => ({ isOpen: !state.isOpen })),
		}),
		{
			name: "clipforge-chat-panel",
			version: 2,
			migrate: (persistedState) => migrateChatPanelState(persistedState),
			partialize: (state) => ({ isOpen: state.isOpen }),
		},
	),
);
