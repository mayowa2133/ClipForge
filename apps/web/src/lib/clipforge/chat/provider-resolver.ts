import { AmbiguitySafeChatOpsProvider } from "./providers/ambiguity-safe";
import { AnthropicChatOpsProvider } from "./providers/anthropic";
import { FallbackChatOpsProvider } from "./providers/fallback";
import { HeuristicChatOpsProvider } from "./providers/heuristic";
import { OpenAIChatOpsProvider } from "./providers/openai";
import { SemanticSafeChatOpsProvider } from "./providers/semantic-safe";
import type { ChatOpsProvider, ChatPlannerMode } from "./types";

export function createChatOpsProvider({
	mode,
}: {
	mode: ChatPlannerMode;
}): ChatOpsProvider {
	let baseProvider: ChatOpsProvider;
	switch (mode) {
		case "heuristic":
			baseProvider = new HeuristicChatOpsProvider();
			break;
		case "openai":
			baseProvider = new OpenAIChatOpsProvider();
			break;
		case "anthropic":
			baseProvider = new AnthropicChatOpsProvider();
			break;
		case "auto":
		default:
			baseProvider = new FallbackChatOpsProvider(
				new HeuristicChatOpsProvider(),
				new FallbackChatOpsProvider(
					new AnthropicChatOpsProvider(),
					new OpenAIChatOpsProvider(),
				),
			);
			break;
	}

	return new SemanticSafeChatOpsProvider(
		new AmbiguitySafeChatOpsProvider(baseProvider),
	);
}
