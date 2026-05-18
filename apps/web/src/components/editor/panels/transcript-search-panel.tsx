"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranscriptSearch } from "@/hooks/use-transcript-search";
import { Check, CheckSquare, Play, Search, Square } from "lucide-react";
import { cn } from "@/utils/ui";
import type { PhraseMatch } from "@/lib/clipforge/phrase-resolution";

function formatMs(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	const millis = Math.floor((ms % 1000) / 10);
	return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(2, "0")}`;
}

function MatchRow({
	match,
	index,
	selected,
	onToggle,
	onSeek,
}: {
	match: PhraseMatch;
	index: number;
	selected: boolean;
	onToggle: () => void;
	onSeek: () => void;
}) {
	return (
		<div
			className={cn(
				"group flex items-start gap-2 rounded-md border px-2.5 py-2 transition-colors",
				selected ? "border-primary/40 bg-primary/5" : "border-transparent bg-muted/30 hover:bg-muted/50",
			)}
		>
			<Checkbox
				checked={selected}
				onCheckedChange={onToggle}
				className="mt-0.5"
			/>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<span className="text-muted-foreground text-[10px] font-mono">
						{formatMs(match.start_ms)}–{formatMs(match.end_ms)}
					</span>
					<span className="text-muted-foreground text-[10px]">
						#{match.occurrence}
					</span>
				</div>
				<p className="mt-0.5 text-xs leading-snug">
					{match.transcript_context}
				</p>
			</div>
			<Button
				variant="ghost"
				size="sm"
				className="h-6 w-6 shrink-0 p-0 opacity-0 group-hover:opacity-100"
				onClick={onSeek}
				title="Seek to this match"
			>
				<Play className="size-3" />
			</Button>
		</div>
	);
}

export function TranscriptSearchPanel() {
	const {
		matches,
		selectedIndices,
		selectedMatches,
		search,
		toggleSelection,
		selectAll,
		clearSelection,
		seekToMatch,
	} = useTranscriptSearch();
	const [inputValue, setInputValue] = useState("");

	const handleSearch = (e: React.FormEvent) => {
		e.preventDefault();
		search(inputValue);
	};

	return (
		<div className="flex h-full flex-col">
			<div className="border-b px-3 py-2.5">
				<form onSubmit={handleSearch} className="flex gap-1.5">
					<div className="relative flex-1">
						<Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
						<Input
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							placeholder="Search transcript..."
							className="h-8 pl-8 text-xs"
						/>
					</div>
					<Button type="submit" size="sm" className="h-8">
						Find
					</Button>
				</form>
			</div>

			{matches.length > 0 && (
				<div className="flex items-center justify-between border-b px-3 py-1.5">
					<span className="text-muted-foreground text-[11px]">
						{matches.length} match{matches.length !== 1 ? "es" : ""}
						{selectedIndices.size > 0 && (
							<> — {selectedIndices.size} selected</>
						)}
					</span>
					<div className="flex gap-1">
						<Button
							variant="ghost"
							size="sm"
							className="h-6 px-1.5 text-[10px]"
							onClick={selectAll}
						>
							All
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-6 px-1.5 text-[10px]"
							onClick={clearSelection}
						>
							None
						</Button>
					</div>
				</div>
			)}

			<div className="scrollbar-thin flex-1 overflow-y-auto px-2 py-2">
				{matches.length > 0 ? (
					<div className="flex flex-col gap-1.5">
						{matches.map((match, i) => (
							<MatchRow
								key={`${match.segment_id}-${match.occurrence}`}
								match={match}
								index={i}
								selected={selectedIndices.has(i)}
								onToggle={() => toggleSelection(i)}
								onSeek={() => seekToMatch(match)}
							/>
						))}
					</div>
				) : (
					<p className="text-muted-foreground py-8 text-center text-xs">
						Search for words or phrases across all clips in your project.
						Select matches to build a supercut.
					</p>
				)}
			</div>

			{selectedMatches.length > 0 && (
				<div className="border-t px-3 py-2">
					<p className="text-muted-foreground mb-1.5 text-[11px]">
						{selectedMatches.length} clip{selectedMatches.length !== 1 ? "s" : ""} selected
						({formatMs(selectedMatches.reduce((sum, m) => sum + (m.end_ms - m.start_ms), 0))} total)
					</p>
				</div>
			)}
		</div>
	);
}
