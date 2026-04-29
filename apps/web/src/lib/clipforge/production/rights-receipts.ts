import type { MediaAsset } from "@/types/assets";
import type { PublishDestination } from "@/types/export";
import type { RightsSourceKind } from "@/types/production";

interface RightsReceiptDraft {
	assetId: string;
	sourceKind: RightsSourceKind;
	licenseLabel: string;
	receipt: Record<string, unknown>;
}

export function buildExportRightsReceiptDrafts({
	mediaAssets,
	destination,
	exportContext,
}: {
	mediaAssets: MediaAsset[];
	destination: PublishDestination;
	exportContext: Record<string, unknown>;
}): RightsReceiptDraft[] {
	const drafts: RightsReceiptDraft[] = [];

	for (const asset of mediaAssets) {
		if (asset.musicSourceType === "bundled" && asset.rightsProfile === "universal") {
			drafts.push({
				assetId: asset.id,
				sourceKind: "bundled",
				licenseLabel:
					asset.attributionText ??
					asset.sourceLabel ??
					"ClipForge bundled starter library",
				receipt: {
					assetName: asset.name,
					sourceLabel: asset.sourceLabel ?? null,
					sourceUrl: asset.sourceUrl ?? null,
					rightsProfile: asset.rightsProfile,
					destination,
					generatedAt: new Date().toISOString(),
					exportContext,
				},
			});
			continue;
		}

		if (asset.musicSourceType === "royalty-free-external") {
			drafts.push({
				assetId: asset.id,
				sourceKind: "licensed",
				licenseLabel: asset.attributionText ?? "External royalty-free license",
				receipt: {
					assetName: asset.name,
					sourceLabel: asset.sourceLabel ?? null,
					sourceUrl: asset.sourceUrl ?? null,
					attributionRequired: asset.attributionRequired ?? false,
					destination,
					generatedAt: new Date().toISOString(),
					exportContext,
				},
			});
		}
	}

	return drafts;
}

export interface RecordExportReceiptsResult {
	attempted: number;
	created: number;
	skippedUnauthenticated: boolean;
	errors: string[];
}

export type FetchLike = (
	input: string,
	init?: { method?: string; credentials?: RequestCredentials; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

export async function recordExportRightsReceipts({
	projectId,
	mediaAssets,
	destination,
	exportContext,
	fetchImpl,
}: {
	projectId: string | null;
	mediaAssets: MediaAsset[];
	destination: PublishDestination;
	exportContext: Record<string, unknown>;
	fetchImpl?: FetchLike;
}): Promise<RecordExportReceiptsResult> {
	const callFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
	const drafts = buildExportRightsReceiptDrafts({
		mediaAssets,
		destination,
		exportContext,
	});

	const result: RecordExportReceiptsResult = {
		attempted: drafts.length,
		created: 0,
		skippedUnauthenticated: false,
		errors: [],
	};

	if (drafts.length === 0) return result;

	for (const draft of drafts) {
		try {
			const response = await callFetch("/api/clipforge/rights/receipts", {
				method: "POST",
				credentials: "include",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					projectId,
					assetId: draft.assetId,
					sourceKind: draft.sourceKind,
					licenseLabel: draft.licenseLabel,
					destination,
					receipt: draft.receipt,
				}),
			});

			if (response.status === 401) {
				result.skippedUnauthenticated = true;
				return result;
			}

			if (!response.ok) {
				let message = `Receipt POST failed with status ${response.status}`;
				try {
					const body = (await response.json()) as { error?: string };
					if (body && typeof body.error === "string") message = body.error;
				} catch {}
				result.errors.push(`${draft.assetId}: ${message}`);
				continue;
			}

			result.created += 1;
		} catch (error) {
			result.errors.push(
				`${draft.assetId}: ${error instanceof Error ? error.message : "request failed"}`,
			);
		}
	}

	return result;
}
