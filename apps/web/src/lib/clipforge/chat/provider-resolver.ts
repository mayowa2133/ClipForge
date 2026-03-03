import { FallbackChatOpsProvider } from "./providers/fallback";
import { HeuristicChatOpsProvider } from "./providers/heuristic";
import { OpenAIChatOpsProvider } from "./providers/openai";
import type { ChatOpsProvider, ChatPlannerMode } from "./types";

export function createChatOpsProvider({
	mode,
}: {
	mode: ChatPlannerMode;
}): ChatOpsProvider {
	switch (mode) {
		case "heuristic":
			return new HeuristicChatOpsProvider();
		case "openai":
			return new OpenAIChatOpsProvider();
		case "auto":
		default:
			return new FallbackChatOpsProvider(
				new OpenAIChatOpsProvider(),
				new HeuristicChatOpsProvider(),
			);
	}
}
