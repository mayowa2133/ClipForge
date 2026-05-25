/**
 * Visual frame analysis using Claude's vision API.
 *
 * Extracts frames from a video at regular intervals, sends them to Claude
 * (with vision), and identifies visual conditions like:
 * - Subject looking down / away from camera
 * - Eyes closed / blinking
 * - Subject off-screen
 *
 * Returns time ranges to CUT from the video.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Types ──────────────────────────────────────────────────────

export interface VisualAnalysisOptions {
	/** What visual condition to detect and cut */
	condition: string; // e.g. "looking down", "looking away", "eyes closed"
	/** How often to sample frames in seconds (default: 2) */
	sampleIntervalS?: number;
	/** Path to ffmpeg binary */
	ffmpegBin?: string;
	/** Path to ffprobe binary */
	ffprobeBin?: string;
	/** Anthropic API key (defaults to ANTHROPIC_API_KEY env var) */
	apiKey?: string;
	/** Min duration of a bad region to actually cut it (ms, default: 500) */
	minBadDurationMs?: number;
}

export interface VisualCutRange {
	start_ms: number;
	end_ms: number;
	reason: string;
}

// ── Frame extraction ───────────────────────────────────────────

function getVideoDurationS(filePath: string, ffprobeBin: string): number {
	const out = execSync(
		`${ffprobeBin} -v quiet -print_format json -show_format "${filePath}"`,
		{ encoding: "utf-8" },
	);
	const data = JSON.parse(out) as { format: { duration: string } };
	return parseFloat(data.format.duration);
}

function extractFrames(
	filePath: string,
	outputDir: string,
	intervalS: number,
	ffmpegBin: string,
): string[] {
	mkdirSync(outputDir, { recursive: true });

	// Extract 1 frame every intervalS seconds as JPEG
	execSync(
		`${ffmpegBin} -i "${filePath}" -vf "fps=1/${intervalS},scale=640:-2" ` +
			`-q:v 5 "${outputDir}/frame_%04d.jpg" -y`,
		{ stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 },
	);

	return readdirSync(outputDir)
		.filter((f) => f.endsWith(".jpg"))
		.sort()
		.map((f) => join(outputDir, f));
}

// ── Claude vision call ─────────────────────────────────────────

interface FrameResult {
	frameIndex: number; // 0-based
	conditionMet: boolean;
}

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

function extractOpenAIResponseText(payload: unknown): string {
	if (!isRecord(payload)) return "";
	if (typeof payload.output_text === "string") return payload.output_text;
	if (Array.isArray(payload.output)) {
		for (const item of payload.output) {
			if (!isRecord(item) || !Array.isArray(item.content)) continue;
			for (const block of item.content as unknown[]) {
				if (isRecord(block) && typeof block.text === "string") return block.text;
			}
		}
	}
	return "";
}

async function analyzeFrameBatchAnthropicOrOpenAI(
	framePaths: string[],
	batchStartIndex: number,
	condition: string,
	anthropicKey: string | undefined,
	openaiKey: string | undefined,
): Promise<string> {
	const systemPrompt = `You analyze video frames for a video editor. For each frame, determine if the condition "${condition}" is true.

Return ONLY a JSON array with one entry per frame, in order:
[{"frame": 0, "condition_met": true}, {"frame": 1, "condition_met": false}, ...]

Be strict — only mark condition_met: true when clearly visible.
Return ONLY valid JSON, no other text.`;

	const userText = `Analyze these ${framePaths.length} frames (frame indices ${batchStartIndex} to ${batchStartIndex + framePaths.length - 1}) for condition: "${condition}"`;

	if (anthropicKey) {
		const imageBlocks = framePaths.map((fp) => ({
			type: "image",
			source: {
				type: "base64",
				media_type: "image/jpeg",
				data: readFileSync(fp).toString("base64"),
			},
		}));

		const response = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"x-api-key": anthropicKey,
				"anthropic-version": "2023-06-01",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "claude-haiku-4-5",
				max_tokens: 1024,
				system: systemPrompt,
				messages: [{
					role: "user",
					content: [...imageBlocks, { type: "text", text: userText }],
				}],
			}),
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`Anthropic vision call failed (${response.status}): ${body.slice(0, 200)}`);
		}
		return extractAnthropicText(await response.json());
	}

	if (openaiKey) {
		// Use Chat Completions API for vision (well-established, stable format)
		const model = process.env.CLIPFORGE_OPENAI_VISION_MODEL ?? "gpt-4o";

		const imageMessages = framePaths.map((fp) => ({
			type: "image_url",
			image_url: {
				url: `data:image/jpeg;base64,${readFileSync(fp).toString("base64")}`,
				detail: "low",
			},
		}));

		const response = await fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${openaiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				max_tokens: 1024,
				messages: [
					{ role: "system", content: systemPrompt },
					{
						role: "user",
						content: [
							...imageMessages,
							{ type: "text", text: userText },
						],
					},
				],
			}),
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`OpenAI vision call failed (${response.status}): ${body.slice(0, 200)}`);
		}

		// Chat completions response format
		const payload = await response.json() as Record<string, unknown>;
		const choices = payload.choices as Array<{ message: { content: string } }>;
		if (!choices?.length) return "";
		return choices[0].message.content ?? "";
	}

	throw new Error("No vision API key available. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
}

async function analyzeFrameBatch(
	framePaths: string[],
	batchStartIndex: number,
	condition: string,
	anthropicKey: string | undefined,
	openaiKey: string | undefined,
): Promise<FrameResult[]> {
	const rawText = await analyzeFrameBatchAnthropicOrOpenAI(
		framePaths,
		batchStartIndex,
		condition,
		anthropicKey,
		openaiKey,
	);

	// Parse response
	const cleaned = rawText
		.replace(/```json\s*/gi, "")
		.replace(/```\s*/g, "")
		.trim();
	const arrStart = cleaned.indexOf("[");
	const arrEnd = cleaned.lastIndexOf("]");

	if (arrStart === -1 || arrEnd === -1) {
		console.warn(`  Vision batch ${batchStartIndex}: no JSON array in response, assuming all clear`);
		return framePaths.map((_, i) => ({
			frameIndex: batchStartIndex + i,
			conditionMet: false,
		}));
	}

	const parsed = JSON.parse(cleaned.slice(arrStart, arrEnd + 1)) as Array<{
		frame: number;
		condition_met: boolean;
	}>;

	return parsed.map((item, i) => ({
		frameIndex: item.frame ?? batchStartIndex + i,
		conditionMet: Boolean(item.condition_met),
	}));
}

// ── Range building ─────────────────────────────────────────────

function buildCutRanges(
	frameResults: FrameResult[],
	intervalS: number,
	minBadDurationMs: number,
): VisualCutRange[] {
	const cutRanges: VisualCutRange[] = [];
	let badStart: number | null = null;

	for (let i = 0; i <= frameResults.length; i++) {
		const isBad = i < frameResults.length && frameResults[i].conditionMet;
		const timeS = i * intervalS;

		if (isBad && badStart === null) {
			badStart = timeS;
		} else if (!isBad && badStart !== null) {
			const startMs = Math.round(badStart * 1000);
			const endMs = Math.round(timeS * 1000);
			if (endMs - startMs >= minBadDurationMs) {
				cutRanges.push({
					start_ms: startMs,
					end_ms: endMs,
					reason: `Visual condition detected`,
				});
			}
			badStart = null;
		}
	}

	return cutRanges;
}

// ── Main export ────────────────────────────────────────────────

/**
 * Analyze a video for visual conditions (e.g. "looking down") and return
 * time ranges that should be cut.
 */
export async function analyzeVideoForVisualCondition(
	videoPath: string,
	opts: VisualAnalysisOptions,
): Promise<VisualCutRange[]> {
	const {
		condition,
		sampleIntervalS = 2,
		ffmpegBin = process.env.CLIPFORGE_FFMPEG_BIN || "ffmpeg",
		ffprobeBin = (process.env.CLIPFORGE_FFMPEG_BIN || "ffmpeg").replace(/ffmpeg$/, "ffprobe"),
		minBadDurationMs = 500,
	} = opts;

	const anthropicKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
	const openaiKey = process.env.OPENAI_API_KEY;

	if (!anthropicKey && !openaiKey) {
		throw new Error("ANTHROPIC_API_KEY or OPENAI_API_KEY is required for visual analysis.");
	}

	if (!existsSync(videoPath)) {
		throw new Error(`Video not found: ${videoPath}`);
	}

	const visionProvider = anthropicKey ? "anthropic" : "openai";
	const durationS = getVideoDurationS(videoPath, ffprobeBin);
	const expectedFrames = Math.ceil(durationS / sampleIntervalS);
	console.log(
		`  Visual analysis (${visionProvider}): "${condition}" | ${expectedFrames} frames @ every ${sampleIntervalS}s`,
	);

	// Extract frames to temp directory
	const tempDir = join(tmpdir(), `clipforge-vision-${Date.now()}`);
	let framePaths: string[] = [];

	try {
		framePaths = extractFrames(videoPath, tempDir, sampleIntervalS, ffmpegBin);
		console.log(`  Extracted ${framePaths.length} frames`);

		// Process in batches of 10 (conservative for vision API)
		const BATCH_SIZE = 10;
		const allResults: FrameResult[] = [];

		for (let i = 0; i < framePaths.length; i += BATCH_SIZE) {
			const batch = framePaths.slice(i, i + BATCH_SIZE);
			const batchNum = Math.floor(i / BATCH_SIZE) + 1;
			const totalBatches = Math.ceil(framePaths.length / BATCH_SIZE);
			console.log(`  Batch ${batchNum}/${totalBatches}: analyzing ${batch.length} frames...`);

			const results = await analyzeFrameBatch(batch, i, condition, anthropicKey, openaiKey);
			allResults.push(...results);
		}

		const conditionMetCount = allResults.filter((r) => r.conditionMet).length;
		console.log(
			`  Condition "${condition}" found in ${conditionMetCount}/${allResults.length} frames`,
		);

		const cutRanges = buildCutRanges(allResults, sampleIntervalS, minBadDurationMs);
		console.log(`  → ${cutRanges.length} cut ranges identified`);

		return cutRanges;
	} finally {
		// Cleanup temp frames
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	}
}

/**
 * Check if the instruction implies a visual condition that requires frame
 * analysis (vs. a text/transcript-based decision).
 */
export function requiresVisualAnalysis(instruction: string): boolean {
	const visualKeywords = [
		"looking down",
		"look down",
		"looked down",
		"looking away",
		"look away",
		"not looking at camera",
		"eyes closed",
		"eyes down",
		"distracted",
		"off screen",
		"off-screen",
		"facing away",
	];
	const lower = instruction.toLowerCase();
	return visualKeywords.some((kw) => lower.includes(kw));
}

/**
 * Extract the visual condition from an instruction string.
 * e.g. "remove the part where I'm looking down" → "looking down"
 *
 * @internal exported for testing
 */
export function extractVisualCondition(instruction: string): string {
	const lower = instruction.toLowerCase();
	const patterns: [RegExp, string][] = [
		[/looking\s+down/i, "subject looking down, away from camera"],
		[/look(?:ing)?\s+away/i, "subject looking away from camera"],
		[/not\s+looking\s+at\s+(?:the\s+)?camera/i, "subject not looking at camera"],
		[/eyes?\s+closed/i, "subject with eyes closed"],
		[/off[- ]?screen/i, "subject off-screen or barely visible"],
		[/distracted/i, "subject appears distracted or not focused on camera"],
	];

	for (const [pattern, condition] of patterns) {
		if (pattern.test(lower)) return condition;
	}

	// Generic fallback: extract the visual part
	return `subject: ${instruction.toLowerCase().replace(/remove|cut|delete|take out|the part where|i am|i'm|where/gi, "").trim()}`;
}

// ── Segment visual quality scoring ────────────────────────────

/**
 * Given a list of already-selected segments (from LLM editorial), extract
 * FIVE frames from each segment (at 10%, 28%, 50%, 72%, 90% of its duration)
 * and ask the vision API whether the person looks good on camera.
 *
 * Sampling positions: 10/28/50/70/88/97% — the 97th-percentile frame
 * specifically catches "look-down right before the jump cut" which
 * centre-only sampling entirely misses.
 *
 * A segment passes if BOTH:
 *   - At least half its frames are good (majority vote), AND
 *   - The last frame (97th-percentile) is not BAD.
 *
 * The last-frame rule prevents "subject looks down to read notes right before
 * the cut" from slipping through when the rest of the segment is fine.
 *
 * If fewer than 30% of segments are "good", returns all (avoids over-filtering
 * when the source footage is uniformly imperfect).
 * If 30%+ are good, removes the bad ones so only the best moments remain.
 */
export async function filterSegmentsByVisualQuality(
	videoPath: string,
	segments: Array<{ src_start_ms: number; src_end_ms: number; index: number; duration_ms: number; out_start_ms: number }>,
	opts: { ffmpegBin?: string } = {},
): Promise<typeof segments> {
	const anthropicKey = process.env.ANTHROPIC_API_KEY;
	const openaiKey = process.env.OPENAI_API_KEY;
	if (!anthropicKey && !openaiKey) return segments; // No vision API — skip

	const ffmpegBin = opts.ffmpegBin ?? process.env.CLIPFORGE_FFMPEG_BIN ?? "ffmpeg";
	const tempDir = join(tmpdir(), `clipforge-segcheck-${Date.now()}`);
	mkdirSync(tempDir, { recursive: true });

	// Sample 7 frames per segment (see SAMPLE_FRACTIONS for exact positions).
	// 7 frames with majority vote (≥4/7) catches isolated look-down moments while
	// still tolerating natural blinks (which score "bad" on at most 1-2 frames).
	const FRAMES_PER_SEGMENT = 7;

	// Sample positions: front-loaded at 3% and 10% to catch look-downs at segment
	// START. The most common pattern: speaker checks notes during a pause, starts
	// their next sentence while STILL looking down. The look-down typically lasts
	// 150–350ms from word onset.
	//
	//   0.03 = for a 3s segment ≈ 90ms after start — catches head still tilted down
	//   0.10 = for a 3s segment ≈ 300ms — catches persistent look-downs past syllable 1
	//   0.97 = catches look-downs right before the jump cut at segment end
	const SAMPLE_FRACTIONS = [0.03, 0.10, 0.28, 0.50, 0.70, 0.88, 0.97];

	try {
		// Extract FRAMES_PER_SEGMENT frames from each segment at the fractions above.
		// frameMeta maps flat frame index → segment index
		const frameMeta: Array<{ segIndex: number; frameLocal: number }> = [];
		const allFramePaths: string[] = [];

		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			for (let f = 0; f < FRAMES_PER_SEGMENT; f++) {
				// Positions biased toward edges so we don't miss a brief look-down
				// at the very start or end of a segment.
				const fraction = SAMPLE_FRACTIONS[f] ?? (f + 1) / (FRAMES_PER_SEGMENT + 1);
				const tS = (seg.src_start_ms + seg.duration_ms * fraction) / 1000;
				const framePath = join(tempDir, `seg_${i}_f${f}.jpg`);
				try {
					execSync(
						`${ffmpegBin} -y -ss ${tS.toFixed(3)} -i "${videoPath}" -frames:v 1 -q:v 3 "${framePath}"`,
						{ stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 },
					);
					allFramePaths.push(existsSync(framePath) ? framePath : "");
				} catch {
					allFramePaths.push(""); // Mark as missing
				}
				frameMeta.push({ segIndex: i, frameLocal: f });
			}
		}

		// Filter to valid paths only (keep mapping)
		const validEntries = frameMeta
			.map((m, idx) => ({ ...m, flatIndex: idx, path: allFramePaths[idx] }))
			.filter((e) => e.path && existsSync(e.path));

		if (validEntries.length === 0) return segments;

		const BATCH_SIZE = 10;
		// flatIndex → good boolean
		const scoreMap = new Map<number, boolean>();

		const systemPrompt = `You are scoring video frames for a talking-head social media video editor.
For each frame decide if it is HIGH QUALITY for a social media clip.

GOOD (mark good: true):
- Person facing the camera, eye-line at or near the lens — even if blinking mid-sentence
- Head may tilt slightly but gaze is still broadly toward the camera
- Natural expressive gestures, animated speech

BAD (mark good: false) — disqualify on ANY of these:
- Head tilted significantly DOWNWARD as if reading notes or looking at lap/phone
- Eyes directed clearly downward (not a blink — sustained gaze toward the floor)
- Face turned mostly sideways or away from camera
- Person largely off-screen or so blurry the face isn't readable

KEY DISTINCTION: A natural eye-blink (eyes briefly shut for a fraction of a second while otherwise facing camera) is GOOD. Sustained downward gaze while reading (head angled down, eyes tracking text below) is BAD.

Return ONLY a JSON array, one entry per frame in order:
[{"frame": 0, "good": true}, {"frame": 1, "good": false}, ...]
Return ONLY valid JSON, no other text.`;

		for (let i = 0; i < validEntries.length; i += BATCH_SIZE) {
			const batch = validEntries.slice(i, i + BATCH_SIZE);
			const userText = `Rate these ${batch.length} frames (indices 0 to ${batch.length - 1}) for social media quality.`;

			try {
				let rawText: string;
				if (anthropicKey) {
					const imageBlocks = batch.map((e) => ({
						type: "image",
						source: { type: "base64", media_type: "image/jpeg", data: readFileSync(e.path).toString("base64") },
					}));
					const resp = await fetch("https://api.anthropic.com/v1/messages", {
						method: "POST",
						headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
						body: JSON.stringify({
							model: "claude-haiku-4-5",
							max_tokens: 512,
							temperature: 0, // deterministic scoring — same frame always gets same score
							system: systemPrompt,
							messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: userText }] }],
						}),
					});
					const payload = await resp.json() as Record<string, unknown>;
					rawText = extractAnthropicText(payload);
				} else {
					const imageMessages = batch.map((e) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${readFileSync(e.path).toString("base64")}`, detail: "low" } }));
					const resp = await fetch("https://api.openai.com/v1/chat/completions", {
						method: "POST",
						headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
						body: JSON.stringify({
							model: "gpt-4o",
							max_tokens: 512,
							temperature: 0, // deterministic scoring — same frame always gets same score
							messages: [{ role: "system", content: systemPrompt }, { role: "user", content: [...imageMessages, { type: "text", text: userText }] }],
						}),
					});
					const payload = await resp.json() as { choices: Array<{ message: { content: string } }> };
					rawText = payload.choices?.[0]?.message?.content ?? "";
				}

				const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
				const arrS = cleaned.indexOf("[");
				const arrE = cleaned.lastIndexOf("]");
				if (arrS !== -1 && arrE !== -1) {
					const parsed = JSON.parse(cleaned.slice(arrS, arrE + 1)) as Array<{ frame: number; good: boolean }>;
					for (let j = 0; j < batch.length; j++) {
						const flatIndex = batch[j].flatIndex;
						scoreMap.set(flatIndex, Boolean(parsed[j]?.good));
					}
				} else {
					// Unparseable — default good for this batch
					for (const e of batch) scoreMap.set(e.flatIndex, true);
				}
			} catch {
				// Vision error — default good
				for (const e of batch) scoreMap.set(e.flatIndex, true);
			}
		}

		// Aggregate: each segment is "good" if at least half its frames are good,
		// AND does not have a sustained look-down right at the segment start.
		//
		// Majority vote (≥ ceil(N/2)):
		//   - 6 frames: need ≥3 good (allows up to 2 bad/blink frames)
		//   - A genuine look-down covering 3+ frames always fails
		//
		// Additional start-of-segment rules (applied AFTER majority vote passes):
		//   - frame[0] BAD + frame[1] BAD → REJECT. Two consecutive bad frames at the
		//     start mean the speaker is still looking down for the first 28% of the
		//     segment. This is directly visible to the viewer at the cut point.
		//     A blink never triggers this because the vision prompt scores blinks GOOD.
		//   - frame[0] BAD + frame[1] GOOD → TRIM. Advance src_start_ms to just before
		//     the first good frame (frame[1] position × 0.8), skipping the brief
		//     look-down moment right at the segment open. Only apply if the remaining
		//     segment is still ≥ 600ms.
		//
		// With temperature=0, scores are deterministic — the same source segment
		// always gets the same score, so the pipeline output is reproducible.
		type SegResult = { keep: boolean; trimStartMs: number };
		const segmentResult: SegResult[] = segments.map((seg, segIdx) => {
			const segEntries = validEntries
				.filter((e) => e.segIndex === segIdx)
				.sort((a, b) => a.frameLocal - b.frameLocal);
			if (segEntries.length === 0) return { keep: true, trimStartMs: 0 };

			const goodFrames = segEntries.filter((e) => scoreMap.get(e.flatIndex) === true).length;
			const majorityPass = goodFrames >= Math.ceil(segEntries.length / 2);
			if (!majorityPass) return { keep: false, trimStartMs: 0 };

			// Check start-of-segment look-down
			const frame0Good = scoreMap.get(segEntries[0].flatIndex) !== false;
			const frame1Good = segEntries.length > 1
				? scoreMap.get(segEntries[1].flatIndex) !== false
				: true;

			if (!frame0Good && !frame1Good) {
				// Sustained look-down at start (frames 0 and 1 both bad) — reject segment
				console.log(`    Segment [${(seg.src_start_ms / 1000).toFixed(1)}s–${(seg.src_end_ms / 1000).toFixed(1)}s]: rejected (look-down in first two frames)`);
				return { keep: false, trimStartMs: 0 };
			}

			if (!frame0Good && frame1Good) {
				// Brief look-down only at the very first frame — trim start to just
				// before the first good frame (SAMPLE_FRACTIONS[1] position × 0.8)
				const goodFraction = SAMPLE_FRACTIONS[1] ?? 0.28;
				const trimMs = Math.round(seg.duration_ms * goodFraction * 0.8);
				const remainingMs = seg.duration_ms - trimMs;
				if (remainingMs >= 600) {
					console.log(`    Segment [${(seg.src_start_ms / 1000).toFixed(1)}s–${(seg.src_end_ms / 1000).toFixed(1)}s]: trimmed ${trimMs}ms from start (brief look-down in frame[0])`);
					return { keep: true, trimStartMs: trimMs };
				}
				// Trim would make it too short — keep original (brief look-down is minor)
			}

			return { keep: true, trimStartMs: 0 };
		});

		const goodCount = segmentResult.filter((r) => r.keep).length;

		// Safety threshold: if fewer than 30% of segments are clearly "good",
		// the source footage is uniformly imperfect — keep all segments to avoid
		// an empty or near-empty output
		if (goodCount < Math.ceil(segments.length * 0.3)) {
			console.log(`  Visual quality: ${goodCount}/${segments.length} segments good — keeping all (low-quality footage)`);
			return segments;
		}

		// Apply keep/reject and start-trim to each segment
		const filtered = segments
			.map((seg, i) => ({ seg, result: segmentResult[i] }))
			.filter(({ result }) => result.keep)
			.map(({ seg, result }) =>
				result.trimStartMs > 0
					? {
						...seg,
						src_start_ms: seg.src_start_ms + result.trimStartMs,
						duration_ms: seg.duration_ms - result.trimStartMs,
					}
					: seg,
			);

		const removed = segments.length - filtered.length;
		if (removed > 0) {
			console.log(`  Visual quality: removed ${removed}/${segments.length} segment(s) where subject not looking at camera`);
		} else {
			console.log(`  Visual quality: all ${segments.length} segments passed`);
		}

		// Reindex out_start_ms
		let cursor = 0;
		return filtered.map((seg, i) => {
			const s = { ...seg, index: i, out_start_ms: cursor };
			cursor += seg.duration_ms;
			return s;
		});
	} finally {
		try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
	}
}
