"use client";

import { useCallback, useRef, useState } from "react";
import { PanelView } from "./base-view";
import { useStockSearch } from "@/hooks/use-stock-search";
import { useEditor } from "@/hooks/use-editor";
import { processMediaAssets } from "@/lib/media/processing";
import type { StockVideoResult } from "@/app/api/clipforge/stock/search/route";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Search } from "lucide-react";

function formatDuration(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

function StockVideoCard({
	video,
	onImport,
}: {
	video: StockVideoResult;
	onImport: (video: StockVideoResult) => void;
}) {
	const [importing, setImporting] = useState(false);

	const handleImport = async () => {
		setImporting(true);
		try {
			onImport(video);
		} finally {
			setImporting(false);
		}
	};

	return (
		<div className="group relative overflow-hidden rounded-md border bg-muted/30">
			<div className="relative aspect-video">
				<img
					src={video.thumbnailUrl}
					alt={`Stock video by ${video.author}`}
					className="size-full object-cover"
					loading="lazy"
				/>
				<div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
					{formatDuration(video.duration)}
				</div>
				<div className="absolute right-1 bottom-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
					{video.aspectRatio}
				</div>
			</div>
			<div className="flex items-center justify-between px-2 py-1.5">
				<span className="text-muted-foreground truncate text-[11px]">
					{video.author}
				</span>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 w-6 p-0"
					onClick={handleImport}
					disabled={importing}
				>
					{importing ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Download className="size-3.5" />
					)}
				</Button>
			</div>
		</div>
	);
}

export function StockView() {
	const editor = useEditor();
	const { results, total, loading, error, hasMore, search, loadMore } =
		useStockSearch();
	const [inputValue, setInputValue] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);

	const handleSearch = (e: React.FormEvent) => {
		e.preventDefault();
		if (inputValue.trim()) {
			search(inputValue.trim());
		}
	};

	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el || !hasMore || loading) return;
		const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 100;
		if (nearBottom) {
			loadMore();
		}
	}, [hasMore, loading, loadMore]);

	const handleImport = async (video: StockVideoResult) => {
		const activeProject = editor.project.getActive();
		if (!activeProject) return;

		try {
			const response = await fetch(video.downloadUrl);
			const blob = await response.blob();
			const file = new File([blob], `pexels_${video.id}.mp4`, {
				type: "video/mp4",
			});

			const processed = await processMediaAssets({ files: [file] });
			const asset = processed[0];
			if (!asset) return;

			await editor.media.addMediaAsset({
				projectId: activeProject.metadata.id,
				asset: {
					...asset,
					sourceLabel: `Pexels — ${video.author}`,
					sourceUrl: `https://www.pexels.com/video/${video.id}/`,
				},
			});
		} catch (err) {
			console.warn("Stock import failed:", err);
		}
	};

	return (
		<PanelView
			title="Stock Video"
			scrollRef={scrollRef}
			onScroll={handleScroll}
		>
			<form onSubmit={handleSearch} className="mb-3 flex gap-1.5">
				<div className="relative flex-1">
					<Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
					<Input
						value={inputValue}
						onChange={(e) => setInputValue(e.target.value)}
						placeholder="Search stock video..."
						className="h-8 pl-8 text-xs"
					/>
				</div>
				<Button type="submit" size="sm" className="h-8" disabled={loading}>
					Search
				</Button>
			</form>

			{error && (
				<p className="text-destructive px-1 text-xs">{error}</p>
			)}

			{results.length > 0 && (
				<>
					<p className="text-muted-foreground mb-2 px-1 text-[11px]">
						{total.toLocaleString()} results
					</p>
					<div className="grid grid-cols-2 gap-2">
						{results.map((video) => (
							<StockVideoCard
								key={video.id}
								video={video}
								onImport={handleImport}
							/>
						))}
					</div>
				</>
			)}

			{loading && (
				<div className="flex items-center justify-center py-6">
					<Loader2 className="text-muted-foreground size-5 animate-spin" />
				</div>
			)}

			{!loading && results.length === 0 && !error && (
				<p className="text-muted-foreground py-8 text-center text-xs">
					Search for stock video footage to import into your project.
				</p>
			)}
		</PanelView>
	);
}
