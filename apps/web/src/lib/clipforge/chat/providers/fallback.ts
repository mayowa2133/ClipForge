import { normalizeChatPlanResult } from "../command-plan";
import type { ChatOpsProvider, ChatProposalResult } from "../types";

export class FallbackChatOpsProvider implements ChatOpsProvider {
	constructor(
		private readonly primary: ChatOpsProvider,
		private readonly fallback: ChatOpsProvider,
	) {}

	async proposeEdits(
		args: Parameters<ChatOpsProvider["proposeEdits"]>[0],
	): Promise<ChatProposalResult> {
		try {
			const result = normalizeChatPlanResult(await this.primary.proposeEdits(args));
			if (result.commands.length > 0 || result.clarification) {
				return result;
			}

			const fallbackResult = normalizeChatPlanResult(
				await this.fallback.proposeEdits(args),
			);
			return {
				...fallbackResult,
				fallbackUsed: true,
				warnings: [
					...result.warnings,
					fallbackResult.clarification
						? "Model plan was not definitive; using deterministic clarification."
						: "Primary planner returned no ops; heuristic fallback was used.",
					...fallbackResult.warnings,
				],
			};
		} catch (error) {
			const fallbackResult = normalizeChatPlanResult(
				await this.fallback.proposeEdits(args),
			);
			return {
				...fallbackResult,
				fallbackUsed: true,
				warnings: [
					`Primary planner failed: ${
						error instanceof Error ? error.message : "Unknown error."
					}`,
					...fallbackResult.warnings,
				],
			};
		}
	}
}
