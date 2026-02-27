import { describe, expect, mock, test } from "bun:test";
import { toggleClipForgeChatPanel } from "@/lib/clipforge/chat-panel-toggle";

describe("toggleClipForgeChatPanel", () => {
	test("toggles panel when chat is enabled", () => {
		const toggle = mock(() => {});
		const close = mock(() => {});

		toggleClipForgeChatPanel({
			isEnabled: true,
			toggle,
			close,
		});

		expect(toggle).toHaveBeenCalledTimes(1);
		expect(close).toHaveBeenCalledTimes(0);
	});

	test("forces panel closed when chat is disabled", () => {
		const toggle = mock(() => {});
		const close = mock(() => {});

		toggleClipForgeChatPanel({
			isEnabled: false,
			toggle,
			close,
		});

		expect(toggle).toHaveBeenCalledTimes(0);
		expect(close).toHaveBeenCalledTimes(1);
	});
});
