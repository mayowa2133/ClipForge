import { describe, expect, test } from "bun:test";
import {
	createChatOpsProvider,
	FallbackChatOpsProvider,
	HeuristicChatOpsProvider,
	OpenAIChatOpsProvider,
} from "@/lib/clipforge/chat";

describe("createChatOpsProvider", () => {
	test("returns heuristic provider in heuristic mode", () => {
		expect(createChatOpsProvider({ mode: "heuristic" })).toBeInstanceOf(
			HeuristicChatOpsProvider,
		);
	});

	test("returns route-backed provider in openai mode", () => {
		expect(createChatOpsProvider({ mode: "openai" })).toBeInstanceOf(
			OpenAIChatOpsProvider,
		);
	});

	test("returns fallback provider in auto mode", () => {
		expect(createChatOpsProvider({ mode: "auto" })).toBeInstanceOf(
			FallbackChatOpsProvider,
		);
	});
});
