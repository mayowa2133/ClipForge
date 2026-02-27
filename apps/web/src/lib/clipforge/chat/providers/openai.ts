import type { TimelineDiffOp } from "@/types/clipforge";
import { CHAT_OPS_FEW_SHOT_PROMPT } from "../few-shot-prompt";
import type { ChatOpsProvider, ProjectSummary } from "../types";

interface OpenAIProviderConfig {
	apiKey?: string;
	model?: string;
	endpoint?: string;
}

export class OpenAIChatOpsProvider implements ChatOpsProvider {
	private readonly apiKey?: string;
	private readonly model: string;
	private readonly endpoint: string;

	constructor(config: OpenAIProviderConfig = {}) {
		this.apiKey = config.apiKey;
		this.model = config.model ?? "gpt-4.1-mini";
		this.endpoint = config.endpoint ?? "https://api.openai.com/v1/responses";
	}

	async proposeEdits({
		userText,
		projectSummary,
	}: {
		userText: string;
		projectSummary: ProjectSummary;
	}): Promise<TimelineDiffOp[]> {
		if (!this.apiKey) {
			throw new Error(
				"OpenAI provider is not configured. Set an API key before using this provider.",
			);
		}

		const response = await fetch(this.endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: this.model,
				input: [
					{
						role: "system",
						content: CHAT_OPS_FEW_SHOT_PROMPT,
					},
					{
						role: "user",
						content: JSON.stringify({
							userText,
							projectSummary,
						}),
					},
				],
			}),
		});

		if (!response.ok) {
			throw new Error(`OpenAI request failed with status ${response.status}`);
		}

		const payload = (await response.json()) as {
			output_text?: string;
		};
		const text = payload.output_text ?? "[]";
		const parsed = JSON.parse(text) as TimelineDiffOp[];
		if (!Array.isArray(parsed)) return [];
		return parsed;
	}
}
