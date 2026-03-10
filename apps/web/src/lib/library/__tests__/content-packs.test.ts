import { describe, expect, test } from "bun:test";
import {
	BUNDLED_FONT_FAMILIES,
	BUNDLED_MUSIC,
	CREATIVE_LIBRARY_PACKS,
	getBundledAttributionLines,
	getBundledMusicByMood,
} from "../content-packs";

describe("content packs", () => {
	test("bundled packs expose deterministic starter content", () => {
		expect(CREATIVE_LIBRARY_PACKS.map((pack) => pack.id)).toEqual([
			"starter-fonts",
			"starter-music",
			"starter-sfx",
			"starter-stickers",
			"starter-presets",
		]);
		expect(BUNDLED_FONT_FAMILIES).toContain("DM Sans");
		expect(BUNDLED_FONT_FAMILIES).toContain("Playfair Display");
	});

	test("bundled music filters by mood deterministically", () => {
		expect(getBundledMusicByMood({ mood: "clean" }).map((item) => item.id)).toEqual([
			"clean-cruise",
			"vlog-daylight",
		]);
		expect(getBundledMusicByMood({ mood: null }).length).toBe(BUNDLED_MUSIC.length);
	});

	test("attribution lines cover every bundled item", () => {
		const totalItems = CREATIVE_LIBRARY_PACKS.reduce(
			(total, pack) => total + pack.items.length,
			0,
		);
		const lines = getBundledAttributionLines();
		expect(lines).toHaveLength(totalItems);
		expect(lines[0]).toContain("Starter Fonts");
		expect(lines.some((line) => line.includes("Starter Music"))).toBe(true);
	});
});
