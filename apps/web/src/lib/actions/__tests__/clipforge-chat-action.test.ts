import { describe, expect, test } from "bun:test";
import { ACTIONS, getDefaultShortcuts } from "@/lib/actions";

describe("clipforge chat action", () => {
	test("registers action with default shortcut", () => {
		expect(ACTIONS["clipforge-toggle-chat-panel"]).toBeDefined();
		expect(ACTIONS["clipforge-toggle-chat-panel"]?.defaultShortcuts).toContain(
			"ctrl+/",
		);
		expect(getDefaultShortcuts()["ctrl+/"]).toBe("clipforge-toggle-chat-panel");
	});
});
