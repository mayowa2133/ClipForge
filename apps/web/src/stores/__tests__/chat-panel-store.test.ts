import { beforeEach, describe, expect, test } from "bun:test";
import {
	migrateChatPanelState,
	useChatPanelStore,
} from "@/stores/chat-panel-store";

describe("chat-panel-store", () => {
	beforeEach(() => {
		useChatPanelStore.setState({ isOpen: true });
	});

	test("toggle flips open state", () => {
		expect(useChatPanelStore.getState().isOpen).toBe(true);

		useChatPanelStore.getState().toggle();
		expect(useChatPanelStore.getState().isOpen).toBe(false);

		useChatPanelStore.getState().toggle();
		expect(useChatPanelStore.getState().isOpen).toBe(true);
	});

	test("migrate restores persisted boolean state", () => {
		expect(migrateChatPanelState({ isOpen: true })).toEqual({ isOpen: true });
		expect(migrateChatPanelState({ isOpen: false })).toEqual({ isOpen: false });
		expect(migrateChatPanelState({ isOpen: "true" })).toEqual({
			isOpen: true,
		});
	});
});
