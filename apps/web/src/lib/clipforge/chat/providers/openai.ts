import type { TimelineDiffOp } from "@/types/clipforge";
import type { ChatOpsProvider, ChatProposalResult, ProjectSummary } from "../types";

interface OpenAIProviderConfig {
	routePath?: string;
}

interface OpenAIPlannerRouteSuccess {
	ops: unknown[];
	provider: "openai";
	warnings?: string[];
	rawText?: string | null;
}

function isPlannerRouteSuccess(payload: unknown): payload is OpenAIPlannerRouteSuccess {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"ops" in payload &&
		Array.isArray((payload as { ops?: unknown }).ops)
	);
}

export class OpenAIChatOpsProvider implements ChatOpsProvider {
	private readonly routePath: string;

	constructor(config: OpenAIProviderConfig = {}) {
		this.routePath = config.routePath ?? "/api/clipforge/chat/plan";
	}

	async proposeEdits({
		userText,
		projectSummary,
	}: {
		userText: string;
		projectSummary: ProjectSummary;
	}): Promise<ChatProposalResult> {
		const response = await fetch(this.routePath, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				userText,
				projectSummary,
			}),
		});

		const payload = (await response.json().catch(() => null)) as
			| OpenAIPlannerRouteSuccess
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
					: `OpenAI planner request failed with status ${response.status}.`,
			);
		}

		if (!isPlannerRouteSuccess(payload)) {
			throw new Error("OpenAI planner returned an invalid payload.");
		}

		return {
			ops: payload.ops as TimelineDiffOp[],
			provider: "openai",
			fallbackUsed: false,
			warnings: Array.isArray(payload.warnings)
				? payload.warnings.filter(
						(warning): warning is string => typeof warning === "string",
					)
				: [],
			rawText:
				typeof payload.rawText === "string" || payload.rawText === null
					? payload.rawText
					: null,
		};
	}
}
