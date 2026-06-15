import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/clipforge/generate-title
 *
 * AI title hook generator. Given the spoken transcript of a talking-head
 * video, returns a short on-screen title overlay that captures the core
 * message — the kind of hook a creator types manually in CapCut.
 *
 * Deterministic filename parsing only yields whatever the file was named
 * ("Abundance"); the real hook ("Always Operate from Abundance") requires
 * understanding the content. That is what this route provides.
 */

interface GenerateTitleRequest {
	transcript: string;
}

interface GenerateTitleResponse {
	title: string;
	warnings: string[];
}

export async function POST(request: Request) {
	try {
		const body = (await request.json()) as GenerateTitleRequest;

		const transcript = (body.transcript ?? "").trim();
		if (transcript.length < 10) {
			return NextResponse.json(
				{ error: "Transcript too short to generate a title." },
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

		// Only the opening matters for a hook — cap the prompt size.
		const opening = transcript.split(/\s+/).slice(0, 160).join(" ");

		const systemPrompt = `You write on-screen title overlays for short-form talking-head videos.
Given the transcript, write ONE short title that captures the core message — the hook a viewer sees pinned on screen for the whole video.

Rules:
- 3 to 5 words. Never more than 5.
- Title Case (capitalize main words).
- No quotes, no emoji, no hashtags, no ending punctuation.
- Make it a statement or imperative that captures the theme, not a description of the video.
- It should read like something the speaker believes, not a summary.

Return ONLY the title text on a single line. No explanation.`;

		const userPrompt = `Transcript:\n"${opening}"\n\nWrite the title.`;

		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				temperature: 0.5,
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

		// Extract text (handles both responses API and chat completions).
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

		// Sanitize: first non-empty line, strip quotes/trailing punctuation, cap to 6 words.
		const title = rawText
			.split("\n")
			.map((l) => l.trim())
			.find((l) => l.length > 0)
			?.replace(/^["'`]+|["'`]+$/g, "")
			.replace(/[.!?,;:]+$/g, "")
			.trim()
			.split(/\s+/)
			.slice(0, 5)
			.join(" ") ?? "";

		if (!title) {
			return NextResponse.json(
				{ title: "", warnings: ["LLM returned empty title."] },
				{ status: 200 },
			);
		}

		return NextResponse.json({
			title,
			warnings: [],
		} satisfies GenerateTitleResponse);
	} catch (err) {
		return NextResponse.json(
			{
				error:
					err instanceof Error ? err.message : "Unknown error in generate-title.",
			},
			{ status: 500 },
		);
	}
}
