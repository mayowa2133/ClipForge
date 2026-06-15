import { NextResponse } from "next/server";

export type AiRateCheck = (args: {
	request: Request;
}) => Promise<{ limited: boolean }>;

/**
 * Shared 429 gate for the unauthenticated clipforge AI routes (chat/plan,
 * creative-brief, detect-repeats, editorial-cut, generate-title), which spend
 * the server's paid OpenAI / Whisper budget.
 *
 * Returns a 429 response when the per-IP limit is exceeded, or null to proceed.
 *
 * `check` is injectable so tests can exercise the gate without a live limiter,
 * and `@/lib/rate-limit` is imported lazily so loading a route (or this module
 * in a unit test) does not force Upstash/env validation at import time.
 */
export async function aiRateLimitResponse(
	request: Request,
	check?: AiRateCheck,
): Promise<NextResponse | null> {
	const run = check ?? (await import("@/lib/rate-limit")).checkAiRateLimit;
	const { limited } = await run({ request });
	if (limited) {
		return NextResponse.json({ error: "Too many requests" }, { status: 429 });
	}
	return null;
}
