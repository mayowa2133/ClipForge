import type { TimelineDiffOp } from "@/types/clipforge";
import { wrapTimelineOpsAsCommands } from "../command-plan";
import type {
	ChatOpsProvider,
	ChatProposalResult,
} from "../types";

interface AnthropicProviderConfig {
	routePath?: string;
}

interface AnthropicPlannerRouteSuccess {
	ops: unknown[];
	provider: "anthropic";
	warnings?: string[];
	rawText?: string | null;
}

function isPlannerRouteSuccess(payload: unknown): payload is AnthropicPlannerRouteSuccess {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"ops" in payload &&
		Array.isArray((payload as { ops?: unknown }).ops)
	);
}

export class AnthropicChatOpsProvider implements ChatOpsProvider {
	private readonly routePath: string;

	constructor(config: AnthropicProviderConfig = {}) {
		this.routePath = config.routePath ?? "/api/clipforge/chat/plan";
	}

	async proposeEdits({
		userText,
		projectSummary,
		context,
		overrides,
	}: Parameters<ChatOpsProvider["proposeEdits"]>[0]): Promise<ChatProposalResult> {
		const response = await fetch(this.routePath, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				userText,
				projectSummary,
				context,
				overrides,
				provider: "anthropic",
			}),
		});

		const payload = (await response.json().catch(() => null)) as
			| AnthropicPlannerRouteSuccess
			| {
					error?: string;
			  }
			| null;

		if (!response.ok) {
			const message =
				payload && typeof payload === "object" && "error" in payload
					? payload.error
					: undefined;
			throw new Error(
				typeof message === "string"
					? message
					: `Anthropic planner request failed with status ${response.status}.`,
			);
		}

		if (!isPlannerRouteSuccess(payload)) {
			throw new Error("Anthropic planner returned an invalid payload.");
		}

		return {
			commands: wrapTimelineOpsAsCommands(payload.ops as TimelineDiffOp[]),
			ops: payload.ops as TimelineDiffOp[],
			provider: "anthropic",
			fallbackUsed: false,
			warnings: Array.isArray(payload.warnings)
				? payload.warnings.filter(
						(warning): warning is string => typeof warning === "string",
					)
				: [],
			clarification: null,
			rawText:
				typeof payload.rawText === "string" || payload.rawText === null
					? payload.rawText
					: null,
		};
	}
}
