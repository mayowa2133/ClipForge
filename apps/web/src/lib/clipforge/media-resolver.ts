export interface ClipForgeMediaMatch {
	assetId: string;
	matchedName: string;
}

interface ResolvableMediaAsset {
	id: string;
	name: string;
}

function normalizeName(value: string): string {
	return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function normalizeFilename(value: string): string {
	return value.toLowerCase().trim();
}

function stripExtension(value: string): string {
	return value.replace(/\.[a-z0-9]+$/i, "");
}

function pickSingleMatch(matches: ResolvableMediaAsset[]): ClipForgeMediaMatch | null {
	if (matches.length !== 1) return null;

	return {
		assetId: matches[0].id,
		matchedName: matches[0].name,
	};
}

export function resolveMediaAssetByName({
	query,
	mediaAssets,
}: {
	query: string;
	mediaAssets: ResolvableMediaAsset[];
}): ClipForgeMediaMatch | null {
	const normalizedQuery = normalizeName(query);
	if (normalizedQuery.length === 0) return null;

	const exactMatches = mediaAssets.filter(
		(asset) => normalizeFilename(asset.name) === normalizeFilename(query),
	);
	const exactResult = pickSingleMatch(exactMatches);
	if (exactResult) return exactResult;
	if (exactMatches.length > 1) return null;

	const queryWithoutExtension = normalizeName(stripExtension(query));
	const withoutExtensionMatches = mediaAssets.filter(
		(asset) => normalizeName(stripExtension(asset.name)) === queryWithoutExtension,
	);
	const withoutExtensionResult = pickSingleMatch(withoutExtensionMatches);
	if (withoutExtensionResult) return withoutExtensionResult;
	if (withoutExtensionMatches.length > 1) return null;

	const displayNameMatches = mediaAssets.filter(
		(asset) => normalizeName(asset.name) === normalizedQuery,
	);
	return pickSingleMatch(displayNameMatches);
}
