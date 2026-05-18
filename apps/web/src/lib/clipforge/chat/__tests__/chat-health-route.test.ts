import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GET } from "@/app/api/clipforge/chat/health/route";

const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalOpenAIKey = process.env.OPENAI_API_KEY;

function restoreEnv(key: string, value: string | undefined) {
	if (typeof value === "string") {
		process.env[key] = value;
		return;
	}
	delete process.env[key];
}

describe("GET /api/clipforge/chat/health", () => {
	beforeEach(() => {
		process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
		process.env.OPENAI_API_KEY = "test-openai-key";
	});

	afterEach(() => {
		restoreEnv("ANTHROPIC_API_KEY", originalAnthropicKey);
		restoreEnv("OPENAI_API_KEY", originalOpenAIKey);
	});

	test("returns ready with anthropic as active provider when both keys are set", async () => {
		const response = await GET();
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(200);
		expect(body.status).toBe("ready");
		expect(body.activeProvider).toBe("anthropic");
		expect(body.anthropicConfigured).toBe(true);
		expect(body.openaiConfigured).toBe(true);
	});

	test("returns ready with openai when only openai key is set", async () => {
		delete process.env.ANTHROPIC_API_KEY;

		const response = await GET();
		const body = (await response.json()) as Record<string, unknown>;

		expect(body.status).toBe("ready");
		expect(body.activeProvider).toBe("openai");
		expect(body.anthropicConfigured).toBe(false);
		expect(body.openaiConfigured).toBe(true);
	});

	test("returns degraded when no api keys are set", async () => {
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.OPENAI_API_KEY;

		const response = await GET();
		const body = (await response.json()) as Record<string, unknown>;

		expect(body.status).toBe("degraded");
		expect(body.activeProvider).toBe(null);
		expect(body.anthropicConfigured).toBe(false);
		expect(body.openaiConfigured).toBe(false);
		expect(JSON.stringify(body)).not.toContain("test-anthropic-key");
		expect(JSON.stringify(body)).not.toContain("test-openai-key");
	});
});
