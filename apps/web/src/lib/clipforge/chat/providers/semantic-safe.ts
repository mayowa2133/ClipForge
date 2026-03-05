import { evaluateSemanticPlanSafety } from "@/lib/clipforge/chat/plan-safety";
import type { ChatOpsProvider, ChatProposalResult } from "../types";

export class SemanticSafeChatOpsProvider implements ChatOpsProvider {
	constructor(private readonly wrapped: ChatOpsProvider) {}

	async proposeEdits(
		args: Parameters<ChatOpsProvider["proposeEdits"]>[0],
	): Promise<ChatProposalResult> {
		const baseResult = await this.wrapped.proposeEdits(args);
		if (baseResult.clarification) {
			return {
				...baseResult,
				safety: baseResult.safety ?? null,
			};
		}

		const safetyResult = evaluateSemanticPlanSafety({
			...args,
			ops: baseResult.ops,
		});

		return {
			...baseResult,
			ops: safetyResult.ops,
			clarification: safetyResult.clarification,
			safety: safetyResult.safety,
			warnings: [...baseResult.warnings, ...safetyResult.warnings],
		};
	}
}
