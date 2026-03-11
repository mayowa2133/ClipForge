import type { MediaAsset } from "@/types/assets";
import type { AudioLibraryItem } from "@/types/library";
import type { PublishDestination } from "@/types/export";

export function buildBundledMusicRights({
	item,
}: {
	item: AudioLibraryItem;
}): Pick<
	MediaAsset,
	| "musicSourceType"
	| "rightsProfile"
	| "allowedDestinations"
	| "attributionRequired"
	| "attributionText"
	| "sourceLabel"
	| "sourceUrl"
> {
	return {
		musicSourceType: "bundled",
		rightsProfile: "universal",
		allowedDestinations: ["generic-export", "tiktok", "instagram", "youtube"],
		attributionRequired: false,
		attributionText: item.licenseNotice ?? null,
		sourceLabel: item.source,
		sourceUrl: item.url,
	};
}

export function buildImportedMusicRights(): Pick<
	MediaAsset,
	| "musicSourceType"
	| "rightsProfile"
	| "allowedDestinations"
	| "attributionRequired"
	| "attributionText"
	| "sourceLabel"
	| "sourceUrl"
> {
	return {
		musicSourceType: "user-imported",
		rightsProfile: "unknown",
		allowedDestinations: null,
		attributionRequired: false,
		attributionText: null,
		sourceLabel: "Imported by user",
		sourceUrl: null,
	};
}

export function getMusicRightsLabel({
	asset,
}: {
	asset: Pick<MediaAsset, "musicSourceType" | "rightsProfile">;
}): string {
	if (asset.musicSourceType === "bundled" && asset.rightsProfile === "universal") {
		return "Universal starter library";
	}
	if (asset.rightsProfile === "platform-limited") {
		return "Platform-limited";
	}
	if (asset.rightsProfile === "unknown") {
		return "User-managed rights";
	}
	return "Unknown rights";
}

export function getDestinationCompatibilityLabel({
	asset,
	publishDestination,
}: {
	asset: Pick<MediaAsset, "rightsProfile" | "allowedDestinations">;
	publishDestination: PublishDestination;
}): "compatible" | "warning" {
	if (asset.rightsProfile !== "platform-limited") {
		return "compatible";
	}
	return asset.allowedDestinations?.includes(publishDestination)
		? "compatible"
		: "warning";
}

export function collectMusicRightsWarnings({
	asset,
	publishDestination,
}: {
	asset: Pick<
		MediaAsset,
		| "name"
		| "rightsProfile"
		| "allowedDestinations"
		| "attributionRequired"
		| "attributionText"
	>;
	publishDestination: PublishDestination;
}): Array<{
	code:
		| "music-rights-unknown-warning"
		| "music-platform-limited-warning"
		| "music-attribution-required-warning";
	message: string;
}> {
	const warnings: Array<{
		code:
			| "music-rights-unknown-warning"
			| "music-platform-limited-warning"
			| "music-attribution-required-warning";
		message: string;
	}> = [];

	if (asset.rightsProfile === "unknown") {
		warnings.push({
			code: "music-rights-unknown-warning",
			message: `Music rights for "${asset.name}" are unknown. Confirm you can export this track for ${formatPublishDestination(
				{ publishDestination },
			)}.`,
		});
	}

	if (
		asset.rightsProfile === "platform-limited" &&
		asset.allowedDestinations &&
		!asset.allowedDestinations.includes(publishDestination)
	) {
		warnings.push({
			code: "music-platform-limited-warning",
			message: `"${asset.name}" is marked for ${asset.allowedDestinations
				.map((destination) => formatPublishDestination({ publishDestination: destination }))
				.join(", ")} only and may not be safe for ${formatPublishDestination({
				publishDestination,
			})}.`,
		});
	}

	if (asset.attributionRequired) {
		warnings.push({
			code: "music-attribution-required-warning",
			message: asset.attributionText
				? `"${asset.name}" requires attribution: ${asset.attributionText}`
				: `"${asset.name}" requires attribution before publication.`,
		});
	}

	return warnings;
}

export function formatPublishDestination({
	publishDestination,
}: {
	publishDestination: PublishDestination;
}): string {
	switch (publishDestination) {
		case "generic-export":
			return "generic export";
		case "tiktok":
			return "TikTok";
		case "instagram":
			return "Instagram";
		case "youtube":
			return "YouTube";
	}
}
