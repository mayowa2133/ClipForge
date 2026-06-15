import { describe, expect, mock, test } from "bun:test";

// Force the AI limiter into a "limited" state before the routes import it, so we
// can assert the 429 short-circuit without a live Upstash/Redis instance.
mock.module("@/lib/rate-limit", () => ({
	checkAiRateLimit: async () => ({ success: false, limited: true }),
	checkRateLimit: async () => ({ success: true, limited: false }),
}));

// Representative cost-bearing routes whose only runtime import is next/server +
// the rate limiter (the gate code is identical across all five AI routes).
const importers = {
	"detect-repeats": () => import("../detect-repeats/route"),
	"editorial-cut": () => import("../editorial-cut/route"),
	"generate-title": () => import("../generate-title/route"),
} as const;

describe("clipforge AI routes enforce per-IP rate limiting", () => {
	for (const [name, load] of Object.entries(importers)) {
		test(`${name} returns 429 when the limiter reports limited`, async () => {
			const { POST } = await load();
			const req = new Request(`http://localhost/api/clipforge/${name}`, {
				method: "POST",
				headers: { "x-forwarded-for": "203.0.113.7" },
				body: JSON.stringify({ words: [] }),
			});
			const res = await POST(req);
			expect(res.status).toBe(429);
			const json = (await res.json()) as { error?: string };
			expect(String(json.error)).toContain("Too many requests");
		});
	}
});
