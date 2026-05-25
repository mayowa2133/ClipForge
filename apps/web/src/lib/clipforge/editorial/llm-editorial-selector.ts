/**
 * LLM-driven editorial content selection.
 *
 * Given a full transcript with word-level timestamps and a natural language
 * instruction (e.g. "remove the boring parts", "keep only the main points",
 * "cut out filler words and pauses"), asks an LLM to decide which segments
 * of the video to keep.
 *
 * Uses the Anthropic API directly (same pattern as anthropic-planner.ts).
 * Falls back to OpenAI if ANTHROPIC_API_KEY is not set.
 */
import type { TranscriptWord, TranscriptSegment } from "@/types/clipforge";
import type { CutSegment } from "../content-match";

// ── Types ──────────────────────────────────────────────────────

export interface EditorialOptions {
	/** Natural language instruction: "remove boring parts", "keep key points", etc. */
	instruction: string;
	/** Desired output duration in seconds (optional hint to the LLM) */
	targetDurationS?: number;
	/** Total source video duration in seconds */
	totalDurationS: number;
	/** Padding to add around each kept segment in ms (default: 50) */
	paddingMs?: number;
}

export interface SelectedTimeRange {
	start_s: number;
	end_s: number;
	reason?: string;
}

// ── System prompt ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a world-class short-form video editor who creates viral TikTok and Instagram Reels content.

You will receive a full video transcript and must select which segments to keep to produce an engaging, high-retention short-form clip.

INPUT FORMAT:
{
  "segments": [{text, start_s, end_s}, ...],
  "instruction": "editing goal",
  "total_duration_s": number,
  "target_duration_s": number (optional)
}

OUTPUT: ONLY a JSON array — no markdown, no explanation, nothing else:
[{"start_s": 0.5, "end_s": 8.2}, {"start_s": 15.0, "end_s": 22.3}]

EDITORIAL RULES (follow these like a pro editor):

1. HOOK FIRST — The first 3 seconds must grab attention immediately. Find the most surprising, bold, or emotionally resonant opening line. Never start with small talk or weak phrases like "so today", "hey guys", "um so".

2. TIGHT STRUCTURE — Short-form video must follow: Hook → Core value → Payoff/CTA. Cut everything that doesn't serve this arc.

3. CUT MERCILESSLY — Remove:
   - Filler words: "um", "uh", "like", "you know", "so", "basically", "literally" (when used as filler)
   - False starts and repetitions
   - Any pause longer than 0.3s between sentences
   - Throat clears, restarts, tangents
   - Weak or rambling sentences that don't add value

4. MISTAKES & FALSE STARTS — NEVER include any segment where the speaker clearly made a mistake: false starts (sentence begun and abandoned), frustrated expletives used as error signals ("fuck—", "shit—" followed by a pause/restart), or explicit self-corrections ("wait no", "I mean", "let me redo"). Cut the entire bad take including the restart sentence immediately following it. Note: expletives used as INTENTIONAL emphasis ("this is fucking wild") are fine to keep if the delivery is confident and there is no restart after.

5. DUPLICATES — When the same sentence or phrase appears more than once (even across adjacent segments), keep ONLY the single best delivery. Never include the same content twice. Watch especially for: a sentence ending one segment and immediately repeating at the start of the next segment — that is a repeated take, keep only one.

6. KEEP ENERGY — Prioritize segments where the speaker sounds confident, direct, and energetic. Skip monotone or uncertain delivery if the same point is made better elsewhere.

7. COMPLETE THOUGHTS — Never cut mid-sentence. Always end on a complete thought or punchy line.

8. TARGET DURATION — Aim for target_duration_s if given (default: 30–50s for social media). Cut until you hit it.

9. STRONG ENDING — End on the most memorable, quotable, or actionable line. Not a trailing thought.

10. JSON ONLY — No text outside the array. No markdown fences. Just the raw JSON array.
11. NEVER return empty array.`;

// ── LLM call ──────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractAnthropicText(payload: unknown): string {
	if (!isRecord(payload)) return "";
	const content = payload.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((b): b is Record<string, unknown> => isRecord(b) && b.type === "text")
		.map((b) => (typeof b.text === "string" ? b.text : ""))
		.join("\n")
		.trim();
}

function extractOpenAIText(payload: unknown): string {
	if (!isRecord(payload)) return "";
	// Responses API: top-level output_text shortcut
	if (typeof payload.output_text === "string") return payload.output_text;
	// Responses API: output[].content[].text
	if (Array.isArray(payload.output)) {
		for (const item of payload.output) {
			if (!isRecord(item) || !Array.isArray(item.content)) continue;
			for (const block of item.content as unknown[]) {
				if (isRecord(block) && typeof block.text === "string") return block.text;
			}
		}
	}
	// Chat completions fallback
	const choices = payload.choices;
	if (!Array.isArray(choices) || choices.length === 0) return "";
	const msg = (choices[0] as Record<string, unknown>).message;
	if (!isRecord(msg)) return "";
	return typeof msg.content === "string" ? msg.content : "";
}

async function callAnthropicEditorial(
	userContent: string,
	apiKey: string,
): Promise<string> {
	const model =
		process.env.CLIPFORGE_ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

	const response = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			max_tokens: 2048,
			temperature: 0, // deterministic — same transcript always produces same edit
			system: SYSTEM_PROMPT,
			messages: [{ role: "user", content: userContent }],
		}),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`Anthropic editorial call failed (${response.status}): ${body}`);
	}

	return extractAnthropicText(await response.json());
}

async function callOpenAIEditorial(
	userContent: string,
	apiKey: string,
): Promise<string> {
	const model = process.env.CLIPFORGE_OPENAI_MODEL ?? "gpt-4.1";
	const endpoint =
		process.env.CLIPFORGE_OPENAI_ENDPOINT ??
		"https://api.openai.com/v1/responses";

	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			temperature: 0, // deterministic — same transcript always produces same edit
			input: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: userContent },
			],
		}),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`OpenAI editorial call failed (${response.status}): ${body}`);
	}

	return extractOpenAIText(await response.json());
}

// ── JSON parsing ───────────────────────────────────────────────

function parseEditorialResponse(raw: string): SelectedTimeRange[] {
	// Strip markdown fences if present
	const cleaned = raw
		.replace(/```json\s*/gi, "")
		.replace(/```\s*/g, "")
		.trim();

	// Find the first [ ... ] block
	const start = cleaned.indexOf("[");
	const end = cleaned.lastIndexOf("]");
	if (start === -1 || end === -1) {
		throw new Error(`LLM returned no JSON array.\nRaw: ${raw.slice(0, 300)}`);
	}

	const jsonStr = cleaned.slice(start, end + 1);
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonStr);
	} catch (e) {
		throw new Error(`LLM returned invalid JSON: ${jsonStr.slice(0, 200)}`);
	}

	if (!Array.isArray(parsed)) {
		throw new Error("LLM response is not an array.");
	}

	return parsed
		.filter(
			(item): item is Record<string, unknown> =>
				isRecord(item) &&
				typeof (item as Record<string, unknown>).start_s === "number" &&
				typeof (item as Record<string, unknown>).end_s === "number",
		)
		.map((item) => ({
			start_s: item.start_s as number,
			end_s: item.end_s as number,
			reason: typeof item.reason === "string" ? item.reason : undefined,
		}));
}

// ── Segment conversion ─────────────────────────────────────────

function convertToCutSegments(
	ranges: SelectedTimeRange[],
	paddingMs: number,
): CutSegment[] {
	// Sort, deduplicate, merge overlapping
	const sorted = [...ranges].sort((a, b) => a.start_s - b.start_s);
	const merged: SelectedTimeRange[] = [];

	for (const r of sorted) {
		if (merged.length === 0) {
			merged.push({ ...r });
		} else {
			const last = merged[merged.length - 1];
			if (r.start_s <= last.end_s + 0.5) {
				last.end_s = Math.max(last.end_s, r.end_s);
			} else {
				merged.push({ ...r });
			}
		}
	}

	let outCursor = 0;
	return merged.map((r, i) => {
		const start = Math.max(0, Math.round(r.start_s * 1000) - paddingMs);
		const end = Math.round(r.end_s * 1000) + paddingMs;
		const dur = end - start;
		const seg: CutSegment = {
			index: i,
			src_start_ms: start,
			src_end_ms: end,
			duration_ms: dur,
			out_start_ms: outCursor,
		};
		outCursor += dur;
		return seg;
	});
}

// ── Mistake detection ─────────────────────────────────────────

/**
 * Fast-path: words that are strong signals the speaker made a mistake.
 * These are NOT a censorship list — they're editorial signals. When one of
 * these appears we know the speaker was frustrated with themselves and likely
 * did a false start or fumbled a sentence.
 *
 * The LLM-based detector (`detectMistakesWithLLM`) is the primary path and
 * understands context. This list is the offline fallback (no API key) and
 * the safety net for cases the LLM misses.
 */
const MISTAKE_SIGNAL_WORDS = new Set([
	// Frustration expletives — almost always signal "I messed that up"
	"fuck", "fucking", "fucked", "fucker", "fucks",
	"shit", "shitting", "shitty",
	"crap",
	"dammit", "goddammit",
	// Explicit self-corrections
	"sorry", // standalone "sorry" mid-sentence usually = restart incoming
	"wait",  // "wait—" immediately followed by silence = false start
	"nope",  // "nope" as standalone = discarding what was just said
]);

/**
 * Merge an array of possibly-overlapping cut regions, sorted by start.
 */
function mergeCutRegions<T extends { start_ms: number; end_ms: number }>(
	regions: T[],
): Array<{ start_ms: number; end_ms: number; reason: string }> {
	if (regions.length === 0) return [];
	const sorted = [...regions].sort((a, b) => a.start_ms - b.start_ms);
	const merged: Array<{ start_ms: number; end_ms: number; reason: string }> = [
		{ start_ms: sorted[0].start_ms, end_ms: sorted[0].end_ms, reason: (sorted[0] as Record<string, unknown>).reason as string ?? "" },
	];
	for (let i = 1; i < sorted.length; i++) {
		const last = merged[merged.length - 1];
		if (sorted[i].start_ms <= last.end_ms) {
			last.end_ms = Math.max(last.end_ms, sorted[i].end_ms);
		} else {
			merged.push({ start_ms: sorted[i].start_ms, end_ms: sorted[i].end_ms, reason: (sorted[i] as Record<string, unknown>).reason as string ?? "" });
		}
	}
	return merged;
}

/**
 * Merge cut regions, but let precise (word-level) cuts OVERRIDE overlapping
 * broad (segment-level) cuts that contain them.
 *
 * When the LLM mistake-detector flags e.g. [95.7s–101.5s] for a repeated
 * sentence but the intra-segment detector pinpoints [100.0s–101.5s], the
 * word-level boundary is more accurate — it preserves the clean first take.
 *
 * Rule: if a precise cut is entirely CONTAINED within a broad LLM cut, replace
 * the broad cut with the precise one (use the tighter boundary).
 * Otherwise, merge normally.
 */
function mergePreservingPrecise(
	broadCuts: Array<{ start_ms: number; end_ms: number; reason: string }>,
	preciseCuts: Array<{ start_ms: number; end_ms: number; reason: string }>,
): Array<{ start_ms: number; end_ms: number; reason: string }> {
	if (preciseCuts.length === 0) return mergeCutRegions(broadCuts);
	if (broadCuts.length === 0) return mergeCutRegions(preciseCuts);

	// Start with a mutable copy of broad cuts
	const adjusted = broadCuts.map((c) => ({ ...c }));

	for (const precise of preciseCuts) {
		// Find any broad cut that CONTAINS this precise cut
		const idx = adjusted.findIndex(
			(b) => b.start_ms <= precise.start_ms && b.end_ms >= precise.end_ms,
		);
		if (idx !== -1) {
			// Replace the overbroad cut with the precise boundary.
			// The segment BEFORE the precise cut (from b.start_ms to precise.start_ms)
			// was where the broad LLM over-extended. By shrinking to the precise cut
			// we un-cut that leading content (e.g. the first occurrence of the sentence).
			console.log(
				`  ✂ Precision override: [${(adjusted[idx].start_ms / 1000).toFixed(1)}s–${(adjusted[idx].end_ms / 1000).toFixed(1)}s] → ` +
				`[${(precise.start_ms / 1000).toFixed(1)}s–${(precise.end_ms / 1000).toFixed(1)}s] (word-level boundary)`,
			);
			adjusted[idx] = precise;
		} else {
			// No containing broad cut — add it as-is
			adjusted.push(precise);
		}
	}

	return mergeCutRegions(adjusted);
}

// ── Intra-segment duplicate detection ─────────────────────────

/**
 * Jaccard similarity between two word arrays (ignores stop words ≤ 2 chars).
 */
function wordListSimilarity(a: string[], b: string[]): number {
	const setA = new Set(a.filter((w) => w.length > 2));
	const setB = new Set(b.filter((w) => w.length > 2));
	if (setA.size === 0 || setB.size === 0) return 0;
	let intersection = 0;
	for (const w of setA) {
		if (setB.has(w)) intersection++;
	}
	const union = setA.size + setB.size - intersection;
	return union > 0 ? intersection / union : 0;
}

/**
 * Find the split point in a word sequence where the two halves are most
 * similar (repeated-sentence detection). Scans 30–70% of the word list.
 * Returns null if no split exceeds the similarity floor.
 */
function findBestRepeatSplit(
	segWords: TranscriptWord[],
): { splitIdx: number; similarity: number } | null {
	const n = segWords.length;
	let best: { splitIdx: number; similarity: number } | null = null;

	const minSplit = Math.floor(n * 0.3);
	const maxSplit = Math.ceil(n * 0.7);

	for (let i = minSplit; i <= maxSplit; i++) {
		const firstHalf = segWords.slice(0, i).map((w) => w.text.toLowerCase().replace(/[^a-z]/g, ""));
		const secondHalf = segWords.slice(i).map((w) => w.text.toLowerCase().replace(/[^a-z]/g, ""));
		if (firstHalf.length < 4 || secondHalf.length < 4) continue;
		const sim = wordListSimilarity(firstHalf, secondHalf);
		if (sim > (best?.similarity ?? 0)) {
			best = { splitIdx: i, similarity: sim };
		}
	}

	return best;
}

/**
 * Detect duplicate sentences that appear TWICE within the SAME Whisper segment.
 * Example: "You just got to take it and run. You just got to take it and run."
 *
 * The editorial LLM handles cross-segment duplicates (Rule 5), but when a
 * Whisper segment itself contains both occurrences the LLM can't split them
 * and tends to skip the whole segment. This function flags the SECOND
 * occurrence as a forced-cut region, so the segment splitter preserves the
 * first (clean) take as a selectable sub-segment.
 *
 * Uses word-level timestamps to find the repetition boundary. Only flags
 * splits with Jaccard similarity ≥ 0.75 (strong repetition signal).
 */
function detectIntraSegmentDuplicates(
	segments: TranscriptSegment[],
	words: TranscriptWord[],
): Array<{ start_ms: number; end_ms: number; reason: string }> {
	const cuts: Array<{ start_ms: number; end_ms: number; reason: string }> = [];

	for (const seg of segments) {
		const segWords = words.filter(
			(w) => w.start_ms >= seg.start_ms - 100 && w.end_ms <= seg.end_ms + 100,
		);
		if (segWords.length < 8) continue; // Need ≥8 words for a meaningful repeated sentence

		const best = findBestRepeatSplit(segWords);
		if (!best || best.similarity < 0.75) continue;

		const { splitIdx, similarity } = best;
		const splitWord = segWords[splitIdx];
		if (!splitWord) continue;

		const cutStart = splitWord.start_ms - 100;
		const cutEnd = seg.end_ms + 200;

		console.log(
			`  ⚠ Intra-segment duplicate [${(seg.start_ms / 1000).toFixed(1)}s–${(seg.end_ms / 1000).toFixed(1)}s]: ` +
			`second occurrence ~${(splitWord.start_ms / 1000).toFixed(1)}s ` +
			`(similarity ${(similarity * 100).toFixed(0)}%) → cutting second take`,
		);

		cuts.push({
			start_ms: cutStart,
			end_ms: cutEnd,
			reason: `intra-segment duplicate: same sentence said twice, keeping first take`,
		});
	}

	return cuts;
}

// ── Fast-path mistake detection ────────────────────────────────

/**
 * Fast-path mistake detection using word signals.
 *
 * Walk the word list looking for MISTAKE_SIGNAL_WORDS. For each one found,
 * widen the cut to cover the full sentence (back to the last pause > 500ms,
 * forward to the next pause > 500ms). This removes the whole bad take, not
 * just the trigger word.
 *
 * This is the FALLBACK when no LLM key is available, and a safety net that
 * runs alongside the LLM-based detector.
 */
export function detectMistakesByWordSignals(
	words: TranscriptWord[],
): Array<{ start_ms: number; end_ms: number; reason: string }> {
	const cuts: Array<{ start_ms: number; end_ms: number; reason: string }> = [];

	for (let i = 0; i < words.length; i++) {
		const normalized = words[i].text.toLowerCase().replace(/[^a-z]/g, "");
		if (!MISTAKE_SIGNAL_WORDS.has(normalized)) continue;

		// Walk backward to sentence start (last gap > 500ms)
		let sentenceStart = words[i].start_ms;
		for (let j = i - 1; j >= 0; j--) {
			const gap = words[j + 1].start_ms - words[j].end_ms;
			if (gap > 500) { sentenceStart = words[j + 1].start_ms; break; }
			sentenceStart = words[j].start_ms;
		}

		// Walk forward to sentence end (next gap > 500ms)
		let sentenceEnd = words[i].end_ms;
		for (let j = i + 1; j < words.length; j++) {
			const gap = words[j].start_ms - words[j - 1].end_ms;
			if (gap > 500) { sentenceEnd = words[j - 1].end_ms; break; }
			sentenceEnd = words[j].end_ms;
		}

		const reason = `mistake signal: "${words[i].text}" at ${(words[i].start_ms / 1000).toFixed(1)}s`;
		console.log(`  ⚠ Mistake signal: "${words[i].text}" at ${(words[i].start_ms / 1000).toFixed(1)}s → cutting ${(sentenceStart / 1000).toFixed(1)}s–${(sentenceEnd / 1000).toFixed(1)}s`);

		cuts.push({
			start_ms: sentenceStart - 50,
			end_ms: sentenceEnd + 200,
			reason,
		});
	}

	return mergeCutRegions(cuts);
}

/**
 * LLM-based mistake detection.
 *
 * The key insight: profanity in speech almost never needs to be cut for
 * content-policy reasons — it needs to be cut because it *signals the speaker
 * made a mistake*. A word-list can't tell the difference between "this is
 * fucking incredible" (keep it) and "and then you— fuck. [pause]" (cut it).
 * Only a model that reads context can.
 *
 * This function gives the LLM the full transcript and asks it to identify:
 * - False starts (speaker started a sentence, stopped, restarted)
 * - Frustration signals ("fuck", "shit", "ugh") used because they fumbled
 * - Self-corrections ("wait no", "I mean", "let me redo that")
 * - Repeated attempts at the same sentence
 *
 * Returns time ranges (ms) to force-cut regardless of content selection.
 */
export async function detectMistakesWithLLM(
	words: TranscriptWord[],
	segments: TranscriptSegment[],
): Promise<Array<{ start_ms: number; end_ms: number; reason: string }>> {
	const anthropicKey = process.env.ANTHROPIC_API_KEY;
	const openaiKey = process.env.OPENAI_API_KEY;
	if (!anthropicKey && !openaiKey) {
		// No LLM — fall back to word-signal detection
		return detectMistakesByWordSignals(words);
	}

	const transcriptLines = segments
		.map((s) => `[${(s.start_ms / 1000).toFixed(1)}s–${(s.end_ms / 1000).toFixed(1)}s] "${s.text.trim()}"`)
		.join("\n");

	const systemPrompt = `You are a speech editor analyzing a transcript for MISTAKES — moments where the speaker clearly made an error they would want removed.

A mistake is:
- A FALSE START: speaker begins a sentence, stops mid-way (often with a filler or abrupt silence), then restarts
- A FRUSTRATION SIGNAL: speaker says an expletive ("fuck", "shit", "ugh", "dammit") because they fumbled — NOT intentional emphasis
- A SELF-CORRECTION: "wait—", "no no", "I mean", "let me rephrase", "sorry" immediately followed by redoing the same point
- A REPEATED SENTENCE: the EXACT same sentence appears verbatim (or near-verbatim) in consecutive segments — flag ONLY the second (duplicate) occurrence

Do NOT flag:
- Expletives used intentionally for emphasis ("this is fucking brilliant")
- Natural filler between sentences ("um", "like" — these are filler, not mistakes)
- Rephrasing that adds new meaning (not a mistake, just a pivot)
- Content that comes AFTER a repeated sentence within the same segment (it may be valuable new material)

Return ONLY valid JSON:
{"mistakes": [{"start_s": 14.2, "end_s": 17.1, "reason": "false start + frustrated expletive + restart"}]}

CRITICAL BOUNDARY RULE: Each region must be as NARROW as possible — cover only the exact bad content.
- For a REPEATED SENTENCE: start_s = start of the duplicate sentence, end_s = end of that duplicate sentence ONLY. Do NOT extend end_s to include other sentences that follow the duplicate within the same segment.
- For a FALSE START: start_s = start of the fumbled attempt, end_s = end of the restart sentence immediately following the expletive. Stop there.

Return {"mistakes": []} if no genuine mistakes found.`;

	const userPrompt = `Identify all genuine mistakes in this transcript. Err on the side of cutting less — only flag moments where the speaker clearly and obviously fumbled.

TRANSCRIPT:
${transcriptLines}`;

	try {
		let rawText: string;

		if (anthropicKey) {
			const resp = await fetch("https://api.anthropic.com/v1/messages", {
				method: "POST",
				headers: {
					"x-api-key": anthropicKey,
					"anthropic-version": "2023-06-01",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: process.env.CLIPFORGE_ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
					max_tokens: 1024,
					temperature: 0, // deterministic — same transcript always finds same mistakes
					system: systemPrompt,
					messages: [{ role: "user", content: userPrompt }],
				}),
			});
			if (!resp.ok) throw new Error(`Anthropic mistake-detection failed (${resp.status})`);
			rawText = extractAnthropicText(await resp.json());
		} else {
			const resp = await fetch("https://api.openai.com/v1/chat/completions", {
				method: "POST",
				headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
				body: JSON.stringify({
					model: process.env.CLIPFORGE_OPENAI_MODEL ?? "gpt-4.1",
					max_tokens: 1024,
					temperature: 0, // deterministic — same transcript always finds same mistakes
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: userPrompt },
					],
				}),
			});
			if (!resp.ok) throw new Error(`OpenAI mistake-detection failed (${resp.status})`);
			const payload = await resp.json() as { choices: Array<{ message: { content: string } }> };
			rawText = payload.choices?.[0]?.message?.content ?? "";
		}

		// Parse LLM response
		const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
		const objStart = cleaned.indexOf("{");
		const objEnd = cleaned.lastIndexOf("}");
		if (objStart === -1 || objEnd === -1) throw new Error("No JSON object in response");

		const parsed = JSON.parse(cleaned.slice(objStart, objEnd + 1)) as {
			mistakes?: Array<{ start_s: number; end_s: number; reason?: string }>;
		};

		const llmMistakes = (parsed.mistakes ?? []).map((m) => ({
			start_ms: Math.round(m.start_s * 1000) - 50,
			end_ms: Math.round(m.end_s * 1000) + 200,
			reason: m.reason ?? "LLM-identified mistake",
		}));

		// Also run word-signal detection as safety net and merge
		const wordSignalMistakes = detectMistakesByWordSignals(words);
		const all = [...llmMistakes, ...wordSignalMistakes];

		const merged = mergeCutRegions(all);

		if (merged.length > 0) {
			for (const m of merged) {
				console.log(`  ✂ Mistake region: ${(m.start_ms / 1000).toFixed(1)}s–${(m.end_ms / 1000).toFixed(1)}s (${m.reason})`);
			}
		}

		return merged;
	} catch (err) {
		console.warn(`  Mistake detection LLM call failed: ${err instanceof Error ? err.message : err} — falling back to word signals`);
		return detectMistakesByWordSignals(words);
	}
}

// Keep the old name as an alias so any external callers don't break
/** @deprecated Use detectMistakesWithLLM for context-aware detection */
export const detectProfanityAndMistakes = detectMistakesByWordSignals;

/**
 * Remove any CutSegment that overlaps with a forced-cut region.
 * Trims segments whose END spills slightly into a forced-cut start (padding
 * artifact) rather than dropping them entirely — the real speech is clean.
 * Only drops segments that genuinely START inside a forced-cut region.
 */
export function applyForcedCuts(
	segments: CutSegment[],
	forcedCuts: Array<{ start_ms: number; end_ms: number }>,
): CutSegment[] {
	if (forcedCuts.length === 0) return segments;

	const result: CutSegment[] = [];
	let outCursor = 0;

	for (const seg of segments) {
		// If the segment START is inside a forced cut → drop entirely
		const startInCut = forcedCuts.some(
			(fc) => seg.src_start_ms >= fc.start_ms && seg.src_start_ms < fc.end_ms,
		);
		if (startInCut) continue;

		// If the segment END spills into a forced-cut start, trim it.
		// This happens when convertToCutSegments added paddingMs and pushed the
		// segment end past the word-level forced-cut boundary.  The actual speech
		// (verified by trimSegmentsToWordBoundaries) ends before the cut; only
		// the padding tail crosses the boundary.
		let effectiveEnd = seg.src_end_ms;
		let effectiveDur = seg.duration_ms;
		for (const fc of forcedCuts) {
			if (effectiveEnd > fc.start_ms && seg.src_start_ms < fc.start_ms) {
				// Trim tail to the cut boundary
				effectiveEnd = fc.start_ms;
				effectiveDur = effectiveEnd - seg.src_start_ms;
			}
		}

		// After trimming, require at least 400ms of content
		if (effectiveDur < 400) continue;

		result.push({
			...seg,
			src_end_ms: effectiveEnd,
			duration_ms: effectiveDur,
			index: result.length,
			out_start_ms: outCursor,
		});
		outCursor += effectiveDur;
	}

	return result;
}

// ── Speech boundary trimming ───────────────────────────────────

/**
 * Trim each segment to the actual word boundaries from the Whisper transcript.
 *
 * LLM-selected time ranges are approximate (they come from segment-level
 * timestamps). After selection we snap each segment's start/end to the first
 * and last word that falls within it, removing leading/trailing silences where
 * the subject is often pausing, thinking, or looking away.
 *
 * If no words fall inside a segment, the segment is kept unchanged.
 */
function trimSegmentsToWordBoundaries(
	segments: CutSegment[],
	words: TranscriptWord[],
	paddingMs: number,
): CutSegment[] {
	let outCursor = 0;
	return segments.map((seg, i) => {
		// Find words fully within this segment (with a small 20ms tolerance)
		const tolerance = 20;
		const withinSeg = words.filter(
			(w) =>
				w.start_ms >= seg.src_start_ms - tolerance &&
				w.end_ms <= seg.src_end_ms + tolerance,
		);

		if (withinSeg.length === 0) {
			// No words — keep original boundaries
			const s = { ...seg, index: i, out_start_ms: outCursor };
			outCursor += seg.duration_ms;
			return s;
		}

		const firstWord = withinSeg[0];
		const lastWord = withinSeg[withinSeg.length - 1];
		const newStart = Math.max(0, firstWord.start_ms - paddingMs);
		const newEnd = lastWord.end_ms + paddingMs;

		const dur = Math.max(200, newEnd - newStart); // minimum 200ms
		const s: CutSegment = {
			index: i,
			src_start_ms: newStart,
			src_end_ms: newStart + dur,
			duration_ms: dur,
			out_start_ms: outCursor,
		};
		outCursor += dur;
		return s;
	});
}

/**
 * Split segments at internal pauses longer than `minPauseMs`.
 *
 * When the LLM selects a segment that spans multiple sentences, there can be
 * long pauses between them where the speaker looks away or thinks. This
 * function splits those segments into separate sub-segments at each pause,
 * effectively removing the "looking around" gaps between sentences.
 *
 * Short sub-segments under `minSubSegMs` are dropped.
 * Only pauses ≥ `minPauseMs` trigger a split (default: 600ms).
 */
function splitSegmentsAtInternalPauses(
	segments: CutSegment[],
	words: TranscriptWord[],
	opts: { paddingMs: number; minPauseMs?: number; minSubSegMs?: number },
): CutSegment[] {
	const { paddingMs, minPauseMs = 600, minSubSegMs = 800 } = opts;
	const result: CutSegment[] = [];
	let outCursor = 0;

	for (const seg of segments) {
		const tolerance = 20;
		const segWords = words.filter(
			(w) =>
				w.start_ms >= seg.src_start_ms - tolerance &&
				w.end_ms <= seg.src_end_ms + tolerance,
		);

		if (segWords.length < 2) {
			// Not enough words to split — keep as-is
			result.push({ ...seg, index: result.length, out_start_ms: outCursor });
			outCursor += seg.duration_ms;
			continue;
		}

		// Max speech duration for a single word before treating the excess as silence.
		// Whisper often assigns trailing silence to the LAST word of a spoken phrase,
		// making e.g. "but" span 34960–37560ms when the actual speech ends at ~35200ms.
		const MAX_WORD_SPEECH_MS = 700;

		// Find gaps between consecutive words (and embedded pauses within long words)
		let subStart = Math.max(0, segWords[0].start_ms - paddingMs);

		for (let i = 0; i < segWords.length - 1; i++) {
			// Check for Whisper-embedded pause: a single word duration exceeds normal speech
			const wordDuration = segWords[i].end_ms - segWords[i].start_ms;
			const embeddedPauseMs = wordDuration > MAX_WORD_SPEECH_MS
				? wordDuration - MAX_WORD_SPEECH_MS
				: 0;

			// Gap between this word's end and next word's start (explicit silence)
			const explicitGap = segWords[i + 1].start_ms - segWords[i].end_ms;

			// Total pause = explicit gap + Whisper-embedded pause in this word
			const effectivePause = explicitGap + embeddedPauseMs;

			if (effectivePause >= minPauseMs) {
				// End sub-segment right after the real speech ends (word start + max speech)
				const realWordEnd = segWords[i].start_ms + Math.min(wordDuration, MAX_WORD_SPEECH_MS);
				const subEnd = realWordEnd + paddingMs;
				const dur = subEnd - subStart;
				if (dur >= minSubSegMs) {
					result.push({
						index: result.length,
						src_start_ms: subStart,
						src_end_ms: subEnd,
						duration_ms: dur,
						out_start_ms: outCursor,
					});
					outCursor += dur;
				}
				// Next sub-segment starts very close to the next word (20ms max pre-speech
			// silence). Less padding = less look-down visible before the speaker opens
			// their mouth — the most common complaint with talking-head footage.
			subStart = Math.max(0, segWords[i + 1].start_ms - Math.min(paddingMs, 20));
			}
		}

		// Final sub-segment
		const subEnd = segWords[segWords.length - 1].end_ms + paddingMs;
		const dur = subEnd - subStart;
		if (dur >= minSubSegMs) {
			result.push({
				index: result.length,
				src_start_ms: subStart,
				src_end_ms: subEnd,
				duration_ms: dur,
				out_start_ms: outCursor,
			});
			outCursor += dur;
		}
	}

	return result;
}

// ── Main export ────────────────────────────────────────────────

/**
 * Ask an LLM to select which segments of the video to keep, based on a
 * natural language editorial instruction.
 */
export async function selectSegmentsWithLLM(
	words: TranscriptWord[],
	segments: TranscriptSegment[],
	opts: EditorialOptions,
): Promise<CutSegment[]> {
	const { instruction, targetDurationS, totalDurationS, paddingMs = 50 } = opts;

	// Detect mistakes before content selection.
	// The LLM reads the full transcript and understands context: "fuck" mid-sentence
	// is a mistake signal, not censorship. It also catches non-profanity mistakes
	// (false starts, corrections, restarts) that a word-list can never find.
	const llmMistakeCuts = await detectMistakesWithLLM(words, segments);

	// Also detect intra-segment duplicates (same sentence said twice within a
	// single Whisper segment). The editorial LLM handles cross-segment duplicates
	// via Rule 5, but when both occurrences are inside one Whisper segment, the
	// LLM can't split them and tends to skip the whole segment. We force-cut the
	// second occurrence here so the segment splitter can expose the first (clean)
	// take as a selectable sub-segment.
	const intraDuplicateCuts = detectIntraSegmentDuplicates(segments, words);
	if (intraDuplicateCuts.length > 0) {
		console.log(`  Found ${intraDuplicateCuts.length} intra-segment duplicate(s) to force-cut`);
	}

	// Merge, but let the word-level precise intra-segment cuts OVERRIDE any
	// overbroad LLM cuts that contain them. When gpt-4.1 flags e.g. [95.7s–101.5s]
	// for a repeated sentence but the word detector pinpoints [100.0s–101.5s],
	// the word-level boundary is more accurate: it preserves the clean first take.
	const forcedCutRegions = mergePreservingPrecise(llmMistakeCuts, intraDuplicateCuts);
	if (forcedCutRegions.length > 0) {
		console.log(`  Total forced-cut regions: ${forcedCutRegions.length}`);
	}

	// Build transcript for the LLM, splitting any segment that PARTIALLY overlaps
	// a forced-cut region so the LLM can include the clean portion.
	//
	// Example: Whisper segment [1.9s–15.9s] contains a great hook AND a mistake at
	// 14.2s. Without splitting, the LLM sees one big segment and skips it entirely.
	// After splitting, the LLM sees [1.9s–14.1s] (clean hook) as a separate entry
	// it can confidently select.
	//
	// IMPORTANT: sub-portions must use word-reconstructed text, NOT the full Whisper
	// segment text. Example: [95.7s–101.3s] = "You just got to take it and run. You
	// just got to take it and run." After splitting at [99.9s], the sub-portion
	// [95.7s–99.9s] must show only the FIRST sentence. If we pass s.text (full
	// duplicate text), the editorial LLM's Rule 5 kills the entry even though it only
	// represents the clean first take.
	const MIN_SEGMENT_FOR_LLM_MS = 800; // don't show segments shorter than 800ms

	/** Reconstruct the spoken text within [start_ms, end_ms] from word timestamps. */
	const textForRange = (start_ms: number, end_ms: number, fallback: string): string => {
		const rangeWords = words.filter(
			(w) => w.start_ms >= start_ms - 200 && w.end_ms <= end_ms + 200,
		);
		return rangeWords.length > 0 ? rangeWords.map((w) => w.text).join(" ").trim() : fallback;
	};

	const segmentsForLLM: Array<{ text: string; start_s: number; end_s: number }> = [];
	for (const s of segments) {
		// Collect forced cuts that overlap (but don't wholly contain) this segment
		const overlapping = forcedCutRegions
			.filter((fc) => fc.start_ms < s.end_ms && fc.end_ms > s.start_ms)
			.sort((a, b) => a.start_ms - b.start_ms);

		if (overlapping.length === 0) {
			segmentsForLLM.push({
				text: s.text,
				start_s: Math.round(s.start_ms / 10) / 100,
				end_s: Math.round(s.end_ms / 10) / 100,
			});
			continue;
		}

		// Walk through the segment, emitting the "clean" gaps between forced cuts.
		// Use word-reconstructed text so the LLM sees only what's actually in range.
		let cursor = s.start_ms;
		for (const fc of overlapping) {
			const cleanEnd = Math.min(fc.start_ms, s.end_ms);
			if (cleanEnd - cursor >= MIN_SEGMENT_FOR_LLM_MS) {
				segmentsForLLM.push({
					text: textForRange(cursor, cleanEnd, s.text),
					start_s: Math.round(cursor / 10) / 100,
					end_s: Math.round(cleanEnd / 10) / 100,
				});
			}
			cursor = Math.max(cursor, fc.end_ms);
		}
		// Remainder after the last cut
		if (cursor < s.end_ms && s.end_ms - cursor >= MIN_SEGMENT_FOR_LLM_MS) {
			segmentsForLLM.push({
				text: textForRange(cursor, s.end_ms, s.text),
				start_s: Math.round(cursor / 10) / 100,
				end_s: Math.round(s.end_ms / 10) / 100,
			});
		}
	}

	const userContent = JSON.stringify({
		segments: segmentsForLLM,
		instruction,
		total_duration_s: Math.round(totalDurationS),
		...(targetDurationS != null ? { target_duration_s: targetDurationS } : {}),
		...(forcedCutRegions.length > 0 ? {
			avoid_regions: forcedCutRegions.map((fc) => ({
				start_s: +(fc.start_ms / 1000).toFixed(2),
				end_s: +(fc.end_ms / 1000).toFixed(2),
				reason: fc.reason,
			})),
		} : {}),
	});

	// Pick provider
	const anthropicKey = process.env.ANTHROPIC_API_KEY;
	const openaiKey = process.env.OPENAI_API_KEY;

	let rawText: string;
	let providerUsed: string;

	if (anthropicKey) {
		rawText = await callAnthropicEditorial(userContent, anthropicKey);
		providerUsed = "anthropic";
	} else if (openaiKey) {
		rawText = await callOpenAIEditorial(userContent, openaiKey);
		providerUsed = "openai";
	} else {
		throw new Error(
			"No LLM API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY to use --instruction.",
		);
	}

	console.log(`  LLM editorial (${providerUsed}): got response`);

	let selected: SelectedTimeRange[];
	try {
		selected = parseEditorialResponse(rawText);
	} catch (err) {
		console.error("  LLM returned unparseable response:", rawText.slice(0, 400));
		throw err;
	}

	if (selected.length === 0) {
		throw new Error("LLM returned empty segment list — refusing to produce empty video.");
	}

	console.log(`  LLM selected ${selected.length} segments:`);
	for (const s of selected) {
		console.log(`    → [${s.start_s.toFixed(1)}s–${s.end_s.toFixed(1)}s]`);
	}

	// Post-process: snap boundaries then split at internal pauses
	const roughSegments = convertToCutSegments(selected, paddingMs);
	if (words.length === 0) return roughSegments;

	// 1. Snap start/end to word boundaries (removes leading/trailing silence)
	const trimmed = trimSegmentsToWordBoundaries(roughSegments, words, paddingMs);

	// 2. Split at internal pauses ≥ 900ms (removes between-sentence pauses where
	//    the subject typically looks away or checks notes, but keeps normal
	//    conversational pacing which is typically 300-700ms between sentences)
	const split = splitSegmentsAtInternalPauses(trimmed, words, { paddingMs, minPauseMs: 900 });

	// 3. Hard-enforce mistake cuts — no matter what the content-selection LLM chose
	console.log(`  Pre-forcedCuts: ${split.length} sub-segments`);
	const clean = applyForcedCuts(split, forcedCutRegions);
	const forcedRemoved = split.length - clean.length;
	if (forcedRemoved > 0) {
		console.log(`  Removed ${forcedRemoved} sub-segment(s) containing mistakes/false-starts`);
	}

	const roughDur = roughSegments.reduce((s, g) => s + g.duration_ms, 0);
	const cleanDur = clean.reduce((s, g) => s + g.duration_ms, 0);
	const savedS = ((roughDur - cleanDur) / 1000).toFixed(1);
	const segDiff = clean.length - roughSegments.length;
	console.log(
		`  Trimmed to word boundaries: ${clean.length} sub-segments (saved ${savedS}s of pauses/mistakes${segDiff > 0 ? `, split ${Math.abs(segDiff)} pause(s)` : ""})`,
	);

	return clean;
}

/**
 * Apply explicit time-based cuts to exclude specific ranges.
 * Parses strings like "0:45-1:02" or "10.5-15.2" (seconds).
 */
export function applyTimeCuts(
	allSegments: CutSegment[],
	cutRanges: string[],
	totalDurationMs: number,
): CutSegment[] {
	// Parse cut ranges
	const cuts = cutRanges
		.map((r) => {
			const parts = r.split("-");
			if (parts.length !== 2) return null;
			const parseTime = (s: string): number => {
				s = s.trim();
				if (s.includes(":")) {
					const [m, sec] = s.split(":");
					return (parseInt(m, 10) * 60 + parseFloat(sec)) * 1000;
				}
				return parseFloat(s) * 1000;
			};
			const start = parseTime(parts[0]);
			const end = parseTime(parts[1]);
			if (isNaN(start) || isNaN(end) || end <= start) return null;
			return { start_ms: start, end_ms: end };
		})
		.filter((c): c is { start_ms: number; end_ms: number } => c !== null);

	if (cuts.length === 0) return allSegments;

	// Build kept ranges (everything NOT in the cut ranges)
	const keptRanges: Array<{ start_ms: number; end_ms: number }> = [];
	let cursor = 0;

	for (const cut of cuts.sort((a, b) => a.start_ms - b.start_ms)) {
		if (cut.start_ms > cursor) {
			keptRanges.push({ start_ms: cursor, end_ms: cut.start_ms });
		}
		cursor = cut.end_ms;
	}
	if (cursor < totalDurationMs) {
		keptRanges.push({ start_ms: cursor, end_ms: totalDurationMs });
	}

	// Filter existing segments to only those fully within kept ranges
	let outCursor = 0;
	const result: CutSegment[] = [];

	for (const seg of allSegments) {
		const inKept = keptRanges.some(
			(kr) => seg.src_start_ms >= kr.start_ms && seg.src_end_ms <= kr.end_ms,
		);
		if (inKept) {
			const dur = seg.duration_ms;
			result.push({
				...seg,
				index: result.length,
				out_start_ms: outCursor,
			});
			outCursor += dur;
		}
	}

	return result;
}
