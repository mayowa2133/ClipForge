import { beforeEach, describe, expect, test } from "bun:test";
import {
	migrateClipForgeChatDraftState,
	useClipForgeChatDraftStore,
} from "@/stores/clipforge-chat-draft-store";

describe("clipforge-chat-draft-store", () => {
	beforeEach(() => {
		useClipForgeChatDraftStore.getState().clearDraft();
	});

	test("setDraft and clearDraft update the draft", () => {
		expect(useClipForgeChatDraftStore.getState().draft).toBe("");

		useClipForgeChatDraftStore.getState().setDraft("make it faster");
		expect(useClipForgeChatDraftStore.getState().draft).toBe("make it faster");

		useClipForgeChatDraftStore.getState().clearDraft();
		expect(useClipForgeChatDraftStore.getState().draft).toBe("");
	});

	test("migrate restores persisted string state", () => {
		expect(migrateClipForgeChatDraftState({ draft: "demo" })).toEqual({
			draft: "demo",
		});
		expect(migrateClipForgeChatDraftState({ draft: 123 })).toEqual({
			draft: "",
		});
	});
});
