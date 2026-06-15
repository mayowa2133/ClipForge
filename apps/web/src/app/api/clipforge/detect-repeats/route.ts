import { NextResponse } from "next/server";
import { checkAiRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/clipforge/detect-repeats
 *
 * AI repeat / mistake detector — the editor's "check for repeats" pass.
 * Given the word-level transcript, finds places where the speaker:
 *   - restarted a sentence after a flub ("...talent or crap. Most people think
 *     that success comes from talent or some sense of knowledge")
 *   - repeated the same phrase two or three times
 *   - false-started ("Start practicing. Start practicing abundance today...")
 * and returns the time spans of the REDUNDANT attempts to delete, keeping the
 * clean/final take.
 *
 * Uses a word-index interface: the model returns {start_index, end_index}
 * referencing the numbered word list, which the caller maps to exact
 * millisecond cut ranges. This avoids the model having to echo timestamps.
 *
 * Unlike the editorial pass, this is NOT budgeted — a mistake is always a
 * mistake regardless of target duration.
 */

interface RepeatWord {
	text: string;
	start_ms: number;
	end_ms: number;
}

interface DetectRepeatsRequest {
	words: RepeatWord[];
}

interface DetectRepeatsResponse {
	cuts: { start_ms: number; end_ms: number; reason: string }[];
	warnings: string[];
}

export async function POST(request: Request) {
	try {
		const { limited } = await checkAiRateLimit({ request });
		if (limited) {
			return NextResponse.json(
				{ error: "Too many requests" },
				{ status: 429 },
			);
		}

		const body = (await request.json()) as DetectRepeatsRequest;
		const words = body.words ?? [];

		if (words.length < 6) {
			return NextResponse.json({
				cuts: [],
				warnings: ["Too few words to analyze."],
			} satisfies DetectRepeatsResponse);
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

		// Group words into sentences.  Cutting WHOLE sentences (not arbitrary
		// word spans) guarantees clean boundaries — no orphaned "The desperate
		// candidate" stubs when consecutive takes are nearly identical.
		//
		// Split PRIMARILY on terminal punctuation (Whisper marks real sentence
		// ends).  Only use a pause as a boundary when it's LONG (> 700ms) — a
		// short mid-sentence hesitation ("...that sense of [pause] fear.") must
		// NOT split, or deleting the sentence would leave a "fear." stub.
		interface Sentence {
			startMs: number;
			endMs: number;
			text: string;
		}
		const sentences: Sentence[] = [];
		let buf: RepeatWord[] = [];
		const flush = () => {
			if (buf.length === 0) return;
			sentences.push({
				startMs: buf[0].start_ms,
				endMs: buf[buf.length - 1].end_ms,
				text: buf.map((w) => w.text.trim()).join(" ").replace(/\s+/g, " ").trim(),
			});
			buf = [];
		};
		for (let i = 0; i < words.length; i++) {
			buf.push(words[i]);
			const endsSentence = /[.!?]$/.test(words[i].text.trim());
			const next = words[i + 1];
			const gap = next ? next.start_ms - words[i].end_ms : Number.POSITIVE_INFINITY;
			if (endsSentence || gap > 700) flush();
		}
		flush();

		if (sentences.length < 2) {
			return NextResponse.json({
				cuts: [],
				warnings: ["Too few sentences to analyze."],
			} satisfies DetectRepeatsResponse);
		}

		const sentenceList = sentences
			.map((s, i) => `[${i}] "${s.text}"`)
			.join("\n");

		const systemPrompt = `You review a talking-head video transcript, split into numbered sentences, for REPEATS and MISTAKES to cut.

Find sentences that are redundant because the speaker:
- restarted after a stumble or flub (e.g. "[3] Most people think success comes from talent or crap." then "[4] Most people think success comes from talent or some sense of knowledge." — sentence 3 is the flubbed first attempt)
- repeated the same sentence two or three times in a row (e.g. three near-identical "The desperate candidate is going to feel that sense of fear..." sentences — keep only ONE)
- false-started (a short fragment right before the full sentence)

Return the INDICES of the sentences to DELETE. When a sentence is said multiple times, keep the LAST, most complete take and delete the earlier ones. Delete the WHOLE redundant sentence (never part of it).

Rules:
- CRITICAL: ALWAYS keep ONE copy of any repeated line. If a sentence is said 3 times, delete exactly 2 (keep the last). NEVER delete all copies — that destroys the point.
- Only flag genuine repeats / restarts / stumbles. Do NOT flag a topic merely revisited later with new information, lists, or normal content.
- "delete" is an array of sentence indices.
- If there are no repeats, return {"delete": []}.
- Return ONLY JSON, no markdown fences.

Output format:
{"delete": [3, 12, 13], "reasons": {"3": "flubbed first attempt", "12": "duplicate take", "13": "duplicate take"}}`;

		const userPrompt = `Sentences:\n${sentenceList}\n\nReturn the JSON of sentence indices to delete.`;

		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				temperature: 0.2,
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

		let rawText = "";
		if (Array.isArray(payload.output)) {
			for (const item of payload.output as Record<string, unknown>[]) {
				if (item.type === "message" && Array.isArray(item.content)) {
					for (const block of item.content as Record<string, unknown>[]) {
						if (block.type === "output_text" && typeof block.text === "string") {
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
			return NextResponse.json({
				cuts: [],
				warnings: ["LLM returned empty response."],
			} satisfies DetectRepeatsResponse);
		}

		const jsonStr = rawText
			.replace(/```json?\n?/g, "")
			.replace(/```/g, "")
			.trim();
		let parsed: { delete?: number[]; reasons?: Record<string, string> };
		try {
			parsed = JSON.parse(jsonStr);
		} catch {
			return NextResponse.json({
				cuts: [],
				warnings: [`Failed to parse LLM JSON: ${jsonStr.slice(0, 200)}`],
			} satisfies DetectRepeatsResponse);
		}

		let deleteIdx = Array.isArray(parsed.delete) ? parsed.delete : [];
		const reasons = parsed.reasons ?? {};

		// Safety net: never delete EVERY copy of a repeated sentence.  If the
		// model marks a run of consecutive, mutually-similar sentences for
		// deletion (the same line said 2-3 times), keep the LAST take so the
		// point survives — otherwise the section becomes incoherent.
		const wordSet = (t: string) =>
			new Set(
				t
					.toLowerCase()
					.replace(/[^a-z0-9\s]/g, "")
					.split(/\s+/)
					.filter(Boolean),
			);
		const jaccard = (a: string, b: string) => {
			const sa = wordSet(a);
			const sb = wordSet(b);
			if (sa.size === 0 || sb.size === 0) return 0;
			let inter = 0;
			for (const w of sa) if (sb.has(w)) inter++;
			return inter / (sa.size + sb.size - inter);
		};
		{
			const delSet = new Set(
				deleteIdx.filter(
					(i) => typeof i === "number" && i >= 0 && i < sentences.length,
				),
			);
			// Group consecutive mutually-similar sentences — each group is one
			// line the speaker said one or more times.
			let g = 0;
			while (g < sentences.length) {
				let end = g;
				// 0.65 so only true near-duplicate retakes group together — not
				// two distinct sentences that merely share a phrase like
				// "is going to feel that sense of".
				while (
					end + 1 < sentences.length &&
					jaccard(sentences[end].text, sentences[end + 1].text) >= 0.65
				) {
					end++;
				}
				// Group is [g..end]. If it's a repeated line (size ≥ 2) and EVERY
				// copy is marked for deletion, rescue the last so the point lives.
				if (end > g) {
					let allDeleted = true;
					for (let k = g; k <= end; k++) {
						if (!delSet.has(k)) {
							allDeleted = false;
							break;
						}
					}
					if (allDeleted) delSet.delete(end);
				}
				g = end + 1;
			}
			deleteIdx = [...delSet];
		}

		// Cut the redundant sentence's whole span (onset → last-word end), but
		// CLAMP to the neighbours: never start before the previous kept
		// sentence ends, never end after the next kept sentence begins.  This
		// removes the sentence completely (no leftover "fear." stub) while
		// guaranteeing the adjacent kept sentences' first/last words survive.
		// The natural pause between sentences stays as breathing room.
		const cuts: DetectRepeatsResponse["cuts"] = [];
		for (const idx of deleteIdx) {
			if (typeof idx !== "number" || idx < 0 || idx >= sentences.length) {
				continue;
			}
			const s = sentences[idx];
			const prev = sentences[idx - 1];
			const next = sentences[idx + 1];
			const start_ms = prev ? Math.max(s.startMs, prev.endMs) : s.startMs;
			const end_ms = next ? Math.min(s.endMs, next.startMs) : s.endMs;
			if (end_ms <= start_ms) continue;
			cuts.push({
				start_ms,
				end_ms,
				reason: reasons[String(idx)] ?? "repeat",
			});
		}

		// Sort and merge adjacent/overlapping cuts so consecutive deleted
		// sentences become one clean range.
		cuts.sort((a, b) => a.start_ms - b.start_ms);
		const merged: DetectRepeatsResponse["cuts"] = [];
		for (const c of cuts) {
			const last = merged[merged.length - 1];
			if (last && c.start_ms <= last.end_ms + 50) {
				last.end_ms = Math.max(last.end_ms, c.end_ms);
			} else {
				merged.push({ ...c });
			}
		}

		return NextResponse.json({
			cuts: merged,
			warnings: [],
		} satisfies DetectRepeatsResponse);
	} catch (err) {
		return NextResponse.json(
			{
				error:
					err instanceof Error ? err.message : "Unknown error in detect-repeats.",
			},
			{ status: 500 },
		);
	}
}
