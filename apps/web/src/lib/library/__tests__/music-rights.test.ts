import { describe, expect, test } from "bun:test";
import {
	buildBundledMusicRights,
	buildImportedMusicRights,
	collectMusicRightsWarnings,
	getDestinationCompatibilityLabel,
	getMusicRightsLabel,
} from "@/lib/library/music-rights";
import type { AudioLibraryItem } from "@/types/library";

const bundledTrack: AudioLibraryItem = {
	id: "starter-track",
	label: "Starter Track",
	kind: "music",
	url: "/library/music/starter-track.mp3",
	tags: ["clean", "upbeat"],
	duration: 12,
	usageKind: "music",
	source: "ClipForge Starter Pack",
	license: "CC0",
	licenseNotice: "CC0 1.0",
};

describe("music rights helpers", () => {
	test("bundled tracks resolve to universal rights metadata", () => {
		const rights = buildBundledMusicRights({ item: bundledTrack });

		expect(rights.musicSourceType).toBe("bundled");
		expect(rights.rightsProfile).toBe("universal");
		expect(rights.allowedDestinations).toEqual([
			"generic-export",
			"tiktok",
			"instagram",
			"youtube",
		]);
		expect(rights.attributionText).toBe("CC0 1.0");
	});

	test("imported audio defaults to unknown rights", () => {
		const rights = buildImportedMusicRights();

		expect(rights.musicSourceType).toBe("user-imported");
		expect(rights.rightsProfile).toBe("unknown");
		expect(rights.allowedDestinations).toBeNull();
		expect(getMusicRightsLabel({ asset: rights })).toBe("User-managed rights");
	});

	test("destination compatibility warns for platform-limited music on mismatched targets", () => {
		expect(
			getDestinationCompatibilityLabel({
				asset: {
					rightsProfile: "platform-limited",
					allowedDestinations: ["tiktok"],
				},
				publishDestination: "instagram",
			}),
		).toBe("warning");
	});

	test("collectMusicRightsWarnings emits unknown, destination, and attribution warnings deterministically", () => {
		const warnings = collectMusicRightsWarnings({
			asset: {
				name: "Imported track",
				rightsProfile: "platform-limited",
				allowedDestinations: ["youtube"],
				attributionRequired: true,
				attributionText: "Credit Example Artist",
			},
			publishDestination: "tiktok",
		});

		expect(warnings.map((warning) => warning.code)).toEqual([
			"music-platform-limited-warning",
			"music-attribution-required-warning",
		]);
		expect(warnings[0]?.message).toContain("Imported track");
		expect(warnings[1]?.message).toContain("Credit Example Artist");
	});
});
