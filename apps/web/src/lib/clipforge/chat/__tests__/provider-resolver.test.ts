import { describe, expect, test } from "bun:test";
import {
	createChatOpsProvider,
	SemanticSafeChatOpsProvider,
} from "@/lib/clipforge/chat";

describe("createChatOpsProvider", () => {
	test("wraps heuristic mode with semantic safety", () => {
		expect(createChatOpsProvider({ mode: "heuristic" })).toBeInstanceOf(
			SemanticSafeChatOpsProvider,
		);
	});

	test("wraps openai mode with semantic safety", () => {
		expect(createChatOpsProvider({ mode: "openai" })).toBeInstanceOf(
			SemanticSafeChatOpsProvider,
		);
	});

	test("wraps auto mode with semantic safety", () => {
		expect(createChatOpsProvider({ mode: "auto" })).toBeInstanceOf(
			SemanticSafeChatOpsProvider,
		);
	});
});
