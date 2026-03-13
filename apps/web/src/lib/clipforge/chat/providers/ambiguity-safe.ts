import { normalizeChatPlanResult } from "@/lib/clipforge/chat/command-plan";
import { evaluateAmbiguityGuard } from "@/lib/clipforge/chat/ambiguity-guard";
import type { ChatOpsProvider, ChatProposalResult } from "../types";

export class AmbiguitySafeChatOpsProvider implements ChatOpsProvider {
	constructor(private readonly wrapped: ChatOpsProvider) {}

	async proposeEdits(
		args: Parameters<ChatOpsProvider["proposeEdits"]>[0],
	): Promise<ChatProposalResult> {
		const baseResult = normalizeChatPlanResult(await this.wrapped.proposeEdits(args));
		if (baseResult.clarification) {
			return baseResult;
		}
		if (baseResult.commands.some((command) => command.kind !== "timeline-op")) {
			return baseResult;
		}

		const guard = evaluateAmbiguityGuard(args);
		if (guard.clarification) {
			return {
				...baseResult,
				ops: [],
				clarification: guard.clarification,
				warnings: [
					...baseResult.warnings,
					"Ambiguous target detected by deterministic safety guard; clarification required before proposing ops.",
					...guard.warnings,
				],
			};
		}

		return baseResult;
	}
}
