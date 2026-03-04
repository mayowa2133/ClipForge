import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GET } from "@/app/api/clipforge/chat/health/route";

const originalApiKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.CLIPFORGE_OPENAI_MODEL;
const originalEndpoint = process.env.CLIPFORGE_OPENAI_ENDPOINT;

function restoreEnv(key: string, value: string | undefined) {
	if (typeof value === "string") {
		process.env[key] = value;
		return;
	}
	delete process.env[key];
}

describe("GET /api/clipforge/chat/health", () => {
	beforeEach(() => {
		process.env.OPENAI_API_KEY = "test-key";
		process.env.CLIPFORGE_OPENAI_MODEL = "gpt-4.1-mini";
		process.env.CLIPFORGE_OPENAI_ENDPOINT = "https://example.test/v1/responses";
	});

	afterEach(() => {
		restoreEnv("OPENAI_API_KEY", originalApiKey);
		restoreEnv("CLIPFORGE_OPENAI_MODEL", originalModel);
		restoreEnv("CLIPFORGE_OPENAI_ENDPOINT", originalEndpoint);
	});

	test("returns ready when key and endpoint are configured", async () => {
		const response = await GET();
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(200);
		expect(body.status).toBe("ready");
		expect(body.openaiConfigured).toBe(true);
		expect(body.endpointConfigured).toBe(true);
		expect(body.defaultModel).toBe("gpt-4.1-mini");
	});

	test("returns degraded when the api key is missing", async () => {
		delete process.env.OPENAI_API_KEY;

		const response = await GET();
		const body = (await response.json()) as Record<string, unknown>;

		expect(body.status).toBe("degraded");
		expect(body.openaiConfigured).toBe(false);
		expect(JSON.stringify(body)).not.toContain("test-key");
	});

	test("returns degraded when the endpoint is missing", async () => {
		delete process.env.CLIPFORGE_OPENAI_ENDPOINT;

		const response = await GET();
		const body = (await response.json()) as Record<string, unknown>;

		expect(body.status).toBe("degraded");
		expect(body.endpointConfigured).toBe(false);
	});
});
