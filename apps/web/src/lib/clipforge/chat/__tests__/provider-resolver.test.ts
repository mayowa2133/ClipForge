import { describe, expect, test } from "bun:test";
import {
	AmbiguitySafeChatOpsProvider,
	createChatOpsProvider,
} from "@/lib/clipforge/chat";

describe("createChatOpsProvider", () => {
	test("wraps heuristic mode with ambiguity safety", () => {
		expect(createChatOpsProvider({ mode: "heuristic" })).toBeInstanceOf(
			AmbiguitySafeChatOpsProvider,
		);
	});

	test("wraps openai mode with ambiguity safety", () => {
		expect(createChatOpsProvider({ mode: "openai" })).toBeInstanceOf(
			AmbiguitySafeChatOpsProvider,
		);
	});

	test("wraps auto mode with ambiguity safety", () => {
		expect(createChatOpsProvider({ mode: "auto" })).toBeInstanceOf(
			AmbiguitySafeChatOpsProvider,
		);
	});
});
