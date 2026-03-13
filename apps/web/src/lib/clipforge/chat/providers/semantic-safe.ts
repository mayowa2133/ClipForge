import { normalizeChatPlanResult, wrapTimelineOpsAsCommands } from "@/lib/clipforge/chat/command-plan";
import { evaluateSemanticPlanSafety } from "@/lib/clipforge/chat/plan-safety";
import type { ChatOpsProvider, ChatProposalResult } from "../types";

export class SemanticSafeChatOpsProvider implements ChatOpsProvider {
	constructor(private readonly wrapped: ChatOpsProvider) {}

	async proposeEdits(
		args: Parameters<ChatOpsProvider["proposeEdits"]>[0],
	): Promise<ChatProposalResult> {
		const baseResult = normalizeChatPlanResult(await this.wrapped.proposeEdits(args));
		if (baseResult.clarification) {
			return {
				...baseResult,
				safety: baseResult.safety ?? null,
			};
		}
		if (baseResult.commands.some((command) => command.kind !== "timeline-op")) {
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
			commands: wrapTimelineOpsAsCommands(safetyResult.ops),
			ops: safetyResult.ops,
			clarification: safetyResult.clarification,
			safety: safetyResult.safety,
			warnings: [...baseResult.warnings, ...safetyResult.warnings],
		};
	}
}
