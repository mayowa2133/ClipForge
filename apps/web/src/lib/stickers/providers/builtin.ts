import { BUNDLED_STICKERS } from "@/lib/library";
import { parseStickerId } from "../sticker-id";
import type { StickerItem, StickerProvider, StickerSearchResult } from "../types";

const BUILTIN_PROVIDER_ID = "builtin";

function toStickerItem({
	id,
	label,
	url,
	tags,
}: {
	id: string;
	label: string;
	url: string;
	tags: string[];
}): StickerItem {
	return {
		id,
		provider: BUILTIN_PROVIDER_ID,
		name: label,
		previewUrl: url,
		metadata: { tags },
	};
}

function filterResults({
	query,
}: {
	query: string;
}): StickerSearchResult {
	const normalized = query.trim().toLowerCase();
	const items = BUNDLED_STICKERS.filter((item) => {
		if (!normalized) return true;
		return (
			item.label.toLowerCase().includes(normalized) ||
			item.tags.some((tag) => tag.toLowerCase().includes(normalized))
		);
	}).map((item) =>
		toStickerItem({
			id: item.id,
			label: item.label,
			url: item.url,
			tags: item.tags,
		}),
	);

	return {
		items,
		total: items.length,
		hasMore: false,
	};
}

export const builtinProvider: StickerProvider = {
	id: BUILTIN_PROVIDER_ID,
	async search({ query }): Promise<StickerSearchResult> {
		return filterResults({ query });
	},
	async browse(): Promise<StickerSearchResult> {
		return filterResults({ query: "" });
	},
	resolveUrl({ stickerId }): string {
		const { providerValue } = parseStickerId({ stickerId });
		const item = BUNDLED_STICKERS.find(
			(candidate) => candidate.id === `${BUILTIN_PROVIDER_ID}:${providerValue}`,
		);
		if (!item) {
			throw new Error(`Built-in sticker not found: ${stickerId}`);
		}
		return item.url;
	},
};
