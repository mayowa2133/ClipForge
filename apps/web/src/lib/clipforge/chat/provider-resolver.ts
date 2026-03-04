import { AmbiguitySafeChatOpsProvider } from "./providers/ambiguity-safe";
import { FallbackChatOpsProvider } from "./providers/fallback";
import { HeuristicChatOpsProvider } from "./providers/heuristic";
import { OpenAIChatOpsProvider } from "./providers/openai";
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
		case "auto":
		default:
			baseProvider = new FallbackChatOpsProvider(
				new OpenAIChatOpsProvider(),
				new HeuristicChatOpsProvider(),
			);
			break;
	}

	return new AmbiguitySafeChatOpsProvider(baseProvider);
}
