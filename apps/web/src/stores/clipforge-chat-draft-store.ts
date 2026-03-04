import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ClipForgeChatDraftState {
	draft: string;
	setDraft: (text: string) => void;
	clearDraft: () => void;
}

export function migrateClipForgeChatDraftState(persistedState: unknown): {
	draft: string;
} {
	const state = persistedState as { draft?: unknown } | null | undefined;

	return {
		draft: typeof state?.draft === "string" ? state.draft : "",
	};
}

export const useClipForgeChatDraftStore = create<ClipForgeChatDraftState>()(
	persist(
		(set) => ({
			draft: "",
			setDraft: (text) => set({ draft: text }),
			clearDraft: () => set({ draft: "" }),
		}),
		{
			name: "clipforge-chat-draft",
			version: 1,
			migrate: (persistedState) =>
				migrateClipForgeChatDraftState(persistedState),
			partialize: (state) => ({ draft: state.draft }),
		},
	),
);
