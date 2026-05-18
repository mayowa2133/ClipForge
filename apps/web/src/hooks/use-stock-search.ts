import { useCallback, useRef, useState } from "react";
import type { StockVideoResult } from "@/app/api/clipforge/stock/search/route";

interface StockSearchState {
	results: StockVideoResult[];
	total: number;
	page: number;
	hasMore: boolean;
	loading: boolean;
	error: string | null;
	query: string;
}

export function useStockSearch() {
	const [state, setState] = useState<StockSearchState>({
		results: [],
		total: 0,
		page: 0,
		hasMore: false,
		loading: false,
		error: null,
		query: "",
	});
	const abortRef = useRef<AbortController | null>(null);

	const fetchPage = useCallback(
		async (query: string, page: number, append: boolean) => {
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;

			setState((prev) => ({
				...prev,
				loading: true,
				error: null,
				query,
			}));

			try {
				const url = `/api/clipforge/stock/search?q=${encodeURIComponent(query)}&page=${page}&per_page=15`;
				const response = await fetch(url, { signal: controller.signal });
				if (!response.ok) {
					const body = (await response.json().catch(() => null)) as { error?: string } | null;
					throw new Error(body?.error ?? `Search failed (${response.status})`);
				}
				const data = (await response.json()) as {
					results: StockVideoResult[];
					total: number;
					page: number;
					perPage: number;
				};

				setState((prev) => ({
					results: append ? [...prev.results, ...data.results] : data.results,
					total: data.total,
					page: data.page,
					hasMore: data.page * data.perPage < data.total,
					loading: false,
					error: null,
					query,
				}));
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") return;
				setState((prev) => ({
					...prev,
					loading: false,
					error: err instanceof Error ? err.message : "Search failed.",
				}));
			}
		},
		[],
	);

	const search = useCallback(
		(query: string) => {
			if (!query.trim()) return;
			fetchPage(query.trim(), 1, false);
		},
		[fetchPage],
	);

	const loadMore = useCallback(() => {
		if (state.loading || !state.hasMore || !state.query) return;
		fetchPage(state.query, state.page + 1, true);
	}, [state.loading, state.hasMore, state.query, state.page, fetchPage]);

	const clear = useCallback(() => {
		abortRef.current?.abort();
		setState({
			results: [],
			total: 0,
			page: 0,
			hasMore: false,
			loading: false,
			error: null,
			query: "",
		});
	}, []);

	return {
		...state,
		search,
		loadMore,
		clear,
	};
}
