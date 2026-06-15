import { describe, expect, test } from "bun:test";
import { aiRateLimitResponse } from "@/lib/clipforge/ai-rate-limit-guard";

// The five cost-bearing clipforge AI routes (chat/plan, creative-brief,
// detect-repeats, editorial-cut, generate-title) all gate on aiRateLimitResponse.
// We inject the limit check so the gate is exercised without a live Upstash
// instance and without mocking the shared module (which would leak across files).
const req = () =>
	new Request("http://localhost/api/clipforge/x", { method: "POST" });

describe("aiRateLimitResponse", () => {
	test("returns 429 when the limiter reports limited", async () => {
		const res = await aiRateLimitResponse(req(), async () => ({
			limited: true,
		}));
		expect(res).not.toBeNull();
		expect(res?.status).toBe(429);
		const json = (await res!.json()) as { error?: string };
		expect(String(json.error)).toContain("Too many requests");
	});

	test("returns null (allows the request) when not limited", async () => {
		const res = await aiRateLimitResponse(req(), async () => ({
			limited: false,
		}));
		expect(res).toBeNull();
	});
});
