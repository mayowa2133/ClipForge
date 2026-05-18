import { useCallback, useMemo, useState } from "react";
import { useEditor } from "@/hooks/use-editor";
import { buildProjectSummary } from "@/lib/clipforge/chat/project-summarizer";
import {
	findPhraseOccurrences,
	type PhraseMatch,
} from "@/lib/clipforge/phrase-resolution";

export function useTranscriptSearch() {
	const editor = useEditor();
	const [query, setQuery] = useState("");
	const [matches, setMatches] = useState<PhraseMatch[]>([]);
	const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
		new Set(),
	);

	const search = useCallback(
		(phrase: string) => {
			setQuery(phrase);
			setSelectedIndices(new Set());

			if (!phrase.trim()) {
				setMatches([]);
				return;
			}

			const project = editor.project.getActive();
			if (!project) {
				setMatches([]);
				return;
			}

			const mediaAssets =
				typeof editor.media?.getAssets === "function"
					? editor.media.getAssets()
					: [];

			const summary = buildProjectSummary({ project, mediaAssets });
			const found = findPhraseOccurrences({
				projectSummary: summary,
				phrase: phrase.trim(),
			});
			setMatches(found);
		},
		[editor],
	);

	const toggleSelection = useCallback((index: number) => {
		setSelectedIndices((prev) => {
			const next = new Set(prev);
			if (next.has(index)) {
				next.delete(index);
			} else {
				next.add(index);
			}
			return next;
		});
	}, []);

	const selectAll = useCallback(() => {
		setSelectedIndices(new Set(matches.map((_, i) => i)));
	}, [matches]);

	const clearSelection = useCallback(() => {
		setSelectedIndices(new Set());
	}, []);

	const selectedMatches = useMemo(
		() => matches.filter((_, i) => selectedIndices.has(i)),
		[matches, selectedIndices],
	);

	const seekToMatch = useCallback(
		(match: PhraseMatch) => {
			editor.playback.seek({ time: match.start_ms / 1000 });
		},
		[editor],
	);

	return {
		query,
		matches,
		selectedIndices,
		selectedMatches,
		search,
		toggleSelection,
		selectAll,
		clearSelection,
		seekToMatch,
	};
}
