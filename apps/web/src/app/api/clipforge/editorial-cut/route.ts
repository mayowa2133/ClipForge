import { NextResponse } from "next/server";
import { aiRateLimitResponse } from "@/lib/clipforge/ai-rate-limit-guard";

export const runtime = "nodejs";

/**
 * POST /api/clipforge/editorial-cut
 *
 * AI-powered editorial pass. Receives a timestamped transcript and target
 * duration, returns CUT_RANGE ops for sections the LLM judges as:
 *   - Redundant (same idea said differently earlier)
 *   - Verbose (could be said in fewer words)
 *   - Weak/filler (doesn't advance the message)
 *   - Off-topic tangents
 *
 * This mirrors the human editor's step 4-5: reviewing the cut video for
 * content quality and removing segments that don't serve the final edit.
 */

interface TranscriptUtterance {
	startMs: number;
	endMs: number;
	text: string;
}

interface EditorialCutRequest {
	utterances: TranscriptUtterance[];
	currentDurationMs: number;
	targetDurationMs: number;
	creatorProfile?: {
		targetKeepRatio?: number | null;
		cutDensityPerMinute?: number | null;
		editorialKeepKeywords?: string[] | null;
		editorialHookKeywords?: string[] | null;
		editorialPayoffKeywords?: string[] | null;
		editorialAvoidKeywords?: string[] | null;
	} | null;
}

interface EditorialCutResponse {
	cuts: { start_ms: number; end_ms: number; reason: string }[];
	warnings: string[];
}

export async function POST(request: Request) {
	try {
		const blocked = await aiRateLimitResponse(request);
		if (blocked) return blocked;

		const body = (await request.json()) as EditorialCutRequest;

		if (!body.utterances || body.utterances.length === 0) {
			return NextResponse.json(
				{ error: "No utterances provided." },
				{ status: 400 },
			);
		}

		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			return NextResponse.json(
				{ error: "OpenAI API key not configured." },
				{ status: 503 },
			);
		}

		const model = process.env.CLIPFORGE_OPENAI_MODEL ?? "gpt-4.1-mini";
		const endpoint =
			process.env.CLIPFORGE_OPENAI_ENDPOINT ??
			"https://api.openai.com/v1/responses";

		const currentSec = Math.round(body.currentDurationMs / 1000);
		const targetSec = Math.round(body.targetDurationMs / 1000);
		const cutNeededSec = currentSec - targetSec;
		const profileGuide = buildCreatorProfileGuide(body.creatorProfile);

		// Build transcript block with timestamps for the LLM.
		// Include raw ms values so the LLM can return exact timestamps.
		const transcriptBlock = body.utterances
			.map(
				(u, i) =>
					`[${i}] ${formatTime(u.startMs)}-${formatTime(u.endMs)} [${u.startMs}-${u.endMs}ms] (${((u.endMs - u.startMs) / 1000).toFixed(1)}s): "${u.text}"`,
			)
			.join("\n");

		const systemPrompt = `You are a professional video editor reviewing a talking-head video transcript.
Your job: identify which segments to CUT to tighten the edit from ${currentSec}s to ~${targetSec}s (remove ~${cutNeededSec}s).

Rules:
- CUT segments that are redundant (same idea said earlier in different words)
- CUT segments that are verbose filler ("you know what I mean", "like I said")
- CUT segments where the speaker is rambling or going off-topic
- CUT weak transitions that don't add meaning
- KEEP the core message, key examples, and strong concluding statements
- KEEP opening hooks and closing calls-to-action
- NEVER cut the first or last utterance (hook + close)
- Each cut should remove at least 1.5 seconds
- Use the learned creator profile as style guidance when present. It is a reusable
  style/template learned from older finished videos, not a timestamp oracle.
- Return ONLY valid JSON, no markdown fences
${profileGuide ? `\nLearned creator profile:\n${profileGuide}\n` : ""}

Output format (JSON array):
[
  {"index": 3, "start_ms": 20540, "end_ms": 37820, "reason": "redundant - repeats the talent vs mindset point from segment 1"},
  ...
]

Each object: index = utterance index, start_ms/end_ms = exact millisecond values from the [ms] brackets in the transcript, reason = brief editorial justification.
Aim to cut exactly ~${cutNeededSec}s total. Don't over-cut.`;

		const userPrompt = `Here is the transcript (${body.utterances.length} segments, ${currentSec}s total). Target: ~${targetSec}s.

${transcriptBlock}

Return the JSON array of segments to cut.`;

		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				temperature: 0.3,
				input: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
			}),
		});

		if (!response.ok) {
			const errText = await response.text().catch(() => "");
			return NextResponse.json(
				{
					error: `OpenAI request failed (${response.status}): ${errText.slice(0, 200)}`,
				},
				{ status: 502 },
			);
		}

		const payload = (await response.json()) as Record<string, unknown>;

		// Extract text from OpenAI response (handles both chat and responses API)
		let rawText = "";
		if (Array.isArray(payload.output)) {
			for (const item of payload.output as Record<string, unknown>[]) {
				if (item.type === "message" && Array.isArray(item.content)) {
					for (const block of item.content as Record<string, unknown>[]) {
						if (
							block.type === "output_text" &&
							typeof block.text === "string"
						) {
							rawText += block.text;
						}
					}
				}
			}
		} else if (
			Array.isArray(payload.choices) &&
			(payload.choices as Record<string, unknown>[]).length > 0
		) {
			const msg = (payload.choices as Record<string, unknown>[])[0]
				.message as Record<string, unknown>;
			rawText = (msg?.content as string) ?? "";
		}

		if (!rawText) {
			return NextResponse.json(
				{ cuts: [], warnings: ["LLM returned empty response."] },
				{ status: 200 },
			);
		}

		// Parse JSON from response (strip markdown fences if present)
		const jsonStr = rawText
			.replace(/```json?\n?/g, "")
			.replace(/```/g, "")
			.trim();
		let parsed: {
			index: number;
			start_ms: number;
			end_ms: number;
			reason: string;
		}[];
		try {
			parsed = JSON.parse(jsonStr);
		} catch {
			return NextResponse.json(
				{
					cuts: [],
					warnings: [`Failed to parse LLM JSON: ${jsonStr.slice(0, 200)}`],
				},
				{ status: 200 },
			);
		}

		if (!Array.isArray(parsed)) {
			return NextResponse.json(
				{ cuts: [], warnings: ["LLM response is not an array."] },
				{ status: 200 },
			);
		}

		// Validate and build cuts
		const cuts: EditorialCutResponse["cuts"] = [];
		for (const item of parsed) {
			if (
				typeof item.start_ms === "number" &&
				typeof item.end_ms === "number" &&
				item.end_ms > item.start_ms
			) {
				cuts.push({
					start_ms: item.start_ms,
					end_ms: item.end_ms,
					reason: typeof item.reason === "string" ? item.reason : "editorial",
				});
			}
		}

		return NextResponse.json({
			cuts,
			warnings: [],
		} satisfies EditorialCutResponse);
	} catch (err) {
		return NextResponse.json(
			{
				error:
					err instanceof Error
						? err.message
						: "Unknown error in editorial-cut.",
			},
			{ status: 500 },
		);
	}
}

function formatTime(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	return `${min}:${sec.toString().padStart(2, "0")}`;
}

function buildCreatorProfileGuide(
	profile: EditorialCutRequest["creatorProfile"],
): string {
	if (!profile || typeof profile !== "object") return "";
	const lines: string[] = [];
	const keepKeywords = sanitizeKeywords(profile.editorialKeepKeywords, 24);
	const hookKeywords = sanitizeKeywords(profile.editorialHookKeywords, 12);
	const payoffKeywords = sanitizeKeywords(profile.editorialPayoffKeywords, 12);
	const avoidKeywords = sanitizeKeywords(profile.editorialAvoidKeywords, 12);

	if (typeof profile.targetKeepRatio === "number") {
		lines.push(
			`- Target keep ratio: keep about ${Math.round(profile.targetKeepRatio * 100)}% of raw speech after silence/repeat cleanup.`,
		);
	}
	if (typeof profile.cutDensityPerMinute === "number") {
		lines.push(
			`- Pacing: aim for about ${profile.cutDensityPerMinute.toFixed(1)} cuts per finished minute.`,
		);
	}
	if (keepKeywords.length > 0) {
		lines.push(
			`- Preserve utterances that advance these learned themes: ${keepKeywords.join(", ")}.`,
		);
	}
	if (hookKeywords.length > 0) {
		lines.push(
			`- Strong hooks tend to contain: ${hookKeywords.join(", ")}. Avoid cutting similar opening material.`,
		);
	}
	if (payoffKeywords.length > 0) {
		lines.push(
			`- Strong payoff/closing material tends to contain: ${payoffKeywords.join(", ")}. Protect similar ending material.`,
		);
	}
	if (avoidKeywords.length > 0) {
		lines.push(
			`- Prefer cutting filler or low-signal utterances around: ${avoidKeywords.join(", ")}.`,
		);
	}

	return lines.join("\n");
}

function sanitizeKeywords(value: unknown, limit: number): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") continue;
		const keyword = entry
			.toLowerCase()
			.replace(/[^a-z0-9\s'-]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (keyword.length < 2 || seen.has(keyword)) continue;
		seen.add(keyword);
		out.push(keyword);
		if (out.length >= limit) break;
	}
	return out;
}
