import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { webEnv } from "@opencut/env/web";

// Upstash credentials are optional in local dev (optionalInLocal). When they are
// absent we cannot rate-limit, so the checks below degrade to a no-op (allow)
// instead of throwing — keeping local-first flows working while still protecting
// hosted deployments, where the credentials are present.
function redisConfigured(): boolean {
	return Boolean(
		webEnv.UPSTASH_REDIS_REST_URL && webEnv.UPSTASH_REDIS_REST_TOKEN,
	);
}

let sharedRedis: Redis | null = null;
function getRedis(): Redis | null {
	if (!redisConfigured()) return null;
	if (!sharedRedis) {
		sharedRedis = new Redis({
			url: webEnv.UPSTASH_REDIS_REST_URL,
			token: webEnv.UPSTASH_REDIS_REST_TOKEN,
		});
	}
	return sharedRedis;
}

let baseLimiter: Ratelimit | null = null;
function getBaseLimiter(): Ratelimit | null {
	const redis = getRedis();
	if (!redis) return null;
	if (!baseLimiter) {
		baseLimiter = new Ratelimit({
			redis,
			limiter: Ratelimit.slidingWindow(100, "1 m"), // 100 requests per minute
			analytics: true,
			prefix: "rate-limit",
		});
	}
	return baseLimiter;
}

let aiLimiter: Ratelimit | null = null;
function getAiLimiter(): Ratelimit | null {
	const redis = getRedis();
	if (!redis) return null;
	if (!aiLimiter) {
		aiLimiter = new Ratelimit({
			redis,
			// Tighter cap: these routes spend the server's paid OpenAI / Whisper
			// budget, so they need stricter protection than ordinary endpoints.
			limiter: Ratelimit.slidingWindow(20, "1 m"), // 20 requests per minute
			analytics: true,
			prefix: "rate-limit-clipforge-ai",
		});
	}
	return aiLimiter;
}

async function check(limiter: Ratelimit | null, request: Request) {
	if (!limiter) return { success: true, limited: false };
	try {
		const ip = request.headers.get("x-forwarded-for") ?? "anonymous";
		const { success } = await limiter.limit(ip);
		return { success, limited: !success };
	} catch {
		// Fail open: a rate-limiter outage or misconfiguration must never take
		// down the route it guards.
		return { success: true, limited: false };
	}
}

export async function checkRateLimit({ request }: { request: Request }) {
	return check(getBaseLimiter(), request);
}

/**
 * Tighter per-IP limit for unauthenticated routes that spend the server's paid
 * LLM / Whisper budget (clipforge chat/plan, creative-brief, detect-repeats,
 * editorial-cut, generate-title). No-op when Redis is unconfigured (local dev).
 */
export async function checkAiRateLimit({ request }: { request: Request }) {
	return check(getAiLimiter(), request);
}
