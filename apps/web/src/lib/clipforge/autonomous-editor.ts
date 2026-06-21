export interface AutonomousTranscriptWord {
	text: string;
	start_ms: number;
	end_ms: number;
}

export function detectUniversalFlubCuts({
	words,
}: {
	words: AutonomousTranscriptWord[];
}): Array<{ start_ms: number; end_ms: number }> {
	const flubTokens = new Set(["crap", "fuck", "fucking", "shit"]);
	const sentences: AutonomousTranscriptWord[][] = [];
	let current: AutonomousTranscriptWord[] = [];
	for (const [index, word] of words.entries()) {
		current.push(word);
		const next = words[index + 1];
		const gap = next ? next.start_ms - word.end_ms : Number.POSITIVE_INFINITY;
		if (/[.!?]$/.test(word.text.trim()) || gap > 700) {
			sentences.push(current);
			current = [];
		}
	}
	if (current.length > 0) sentences.push(current);

	const normalized = (sentence: AutonomousTranscriptWord[]) =>
		sentence
			.map((word) => word.text.toLowerCase().replace(/[^a-z']/g, ""))
			.filter(Boolean);
	const sharedPrefixLength = (left: string[], right: string[]) => {
		let count = 0;
		while (
			count < left.length &&
			count < right.length &&
			left[count] === right[count]
		) {
			count++;
		}
		return count;
	};

	return sentences.flatMap((sentence, index) => {
		const tokens = normalized(sentence);
		if (!tokens.some((token) => flubTokens.has(token))) return [];
		const previous = sentences[index - 1];
		const next = sentences[index + 1];
		const isShortFlub = tokens.length <= 2;
		const restartsNext = next
			? sharedPrefixLength(tokens, normalized(next)) >= 3
			: false;
		const interruptsRestart =
			previous && next
				? sharedPrefixLength(normalized(previous), normalized(next)) >= 3
				: false;
		if (!isShortFlub && !restartsNext && !interruptsRestart) return [];
		const first = sentence[0];
		const last = sentence[sentence.length - 1];
		return first && last
			? [{ start_ms: first.start_ms, end_ms: last.end_ms }]
			: [];
	});
}
