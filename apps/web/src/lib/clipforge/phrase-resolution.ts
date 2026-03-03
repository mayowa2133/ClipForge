import type { ProjectSummary } from "./chat/types";

export interface PhraseMatch {
	phrase: string;
	occurrence: number;
	start_ms: number;
	end_ms: number;
	segment_id: string;
	transcript_context: string;
}

export function findPhraseOccurrences({
	projectSummary,
	phrase,
}: {
	projectSummary: Pick<ProjectSummary, "timeline_words">;
	phrase: string;
}): PhraseMatch[] {
	const normalizedTokens = tokenizePhrase({ value: phrase });
	if (normalizedTokens.length === 0) return [];

	const indexedWords = projectSummary.timeline_words.map((word) => ({
		...word,
		normalized: normalizeToken({ value: word.text }),
	}));

	const matches: PhraseMatch[] = [];

	for (let index = 0; index <= indexedWords.length - normalizedTokens.length; index += 1) {
		const window = indexedWords.slice(index, index + normalizedTokens.length);
		if (window.some((word) => word.normalized.length === 0)) {
			continue;
		}
		if (
			window.some((word, tokenIndex) => word.normalized !== normalizedTokens[tokenIndex])
		) {
			continue;
		}

		matches.push({
			phrase: phrase.trim(),
			occurrence: matches.length + 1,
			start_ms: window[0].start_ms,
			end_ms: window[window.length - 1].end_ms,
			segment_id: window[0].segment_id,
			transcript_context: buildTranscriptContext({
				indexedWords,
				startIndex: index,
				endIndex: index + normalizedTokens.length - 1,
			}),
		});
	}

	return matches;
}

export function resolvePhraseWindow({
	projectSummary,
	phrase,
	occurrence = 1,
	paddingMs = 120,
}: {
	projectSummary: Pick<ProjectSummary, "timeline_words">;
	phrase: string;
	occurrence?: number;
	paddingMs?: number;
}): { start_ms: number; end_ms: number } | null {
	const matches = findPhraseOccurrences({ projectSummary, phrase });
	const match = matches.find((candidate) => candidate.occurrence === occurrence);
	if (!match) return null;

	return {
		start_ms: Math.max(0, match.start_ms - paddingMs),
		end_ms: match.end_ms + paddingMs,
	};
}

function tokenizePhrase({ value }: { value: string }): string[] {
	return value
		.split(/\s+/)
		.map((token) => normalizeToken({ value: token }))
		.filter(Boolean);
}

function normalizeToken({ value }: { value: string }): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, "");
}

function buildTranscriptContext({
	indexedWords,
	startIndex,
	endIndex,
}: {
	indexedWords: Array<{ text: string }>;
	startIndex: number;
	endIndex: number;
}): string {
	const contextStart = Math.max(0, startIndex - 3);
	const contextEnd = Math.min(indexedWords.length, endIndex + 4);
	return indexedWords
		.slice(contextStart, contextEnd)
		.map((word) => word.text)
		.join(" ")
		.trim();
}
