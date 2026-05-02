import { describe, expect, test } from "bun:test";
import { resolveLibraryUrl } from "@/lib/clipforge/production/worker/ffmpeg-node-adapters";

describe("resolveLibraryUrl", () => {
	test("returns absolute http URLs unchanged", () => {
		expect(
			resolveLibraryUrl({
				sourceUrl: "http://cdn.example.com/track.mp3",
				libraryBaseUrl: "https://app.example.com",
			}),
		).toBe("http://cdn.example.com/track.mp3");
	});

	test("returns absolute https URLs unchanged", () => {
		expect(
			resolveLibraryUrl({
				sourceUrl: "https://cdn.example.com/track.mp3",
				libraryBaseUrl: "https://app.example.com",
			}),
		).toBe("https://cdn.example.com/track.mp3");
	});

	test("prepends libraryBaseUrl for absolute paths", () => {
		expect(
			resolveLibraryUrl({
				sourceUrl: "/library/sfx/typing.wav",
				libraryBaseUrl: "https://app.example.com",
			}),
		).toBe("https://app.example.com/library/sfx/typing.wav");
	});

	test("normalizes trailing slash on libraryBaseUrl", () => {
		expect(
			resolveLibraryUrl({
				sourceUrl: "/library/sfx/typing.wav",
				libraryBaseUrl: "https://app.example.com/",
			}),
		).toBe("https://app.example.com/library/sfx/typing.wav");
	});

	test("prepends a leading slash for relative paths without one", () => {
		expect(
			resolveLibraryUrl({
				sourceUrl: "library/music/upbeat.mp3",
				libraryBaseUrl: "https://app.example.com",
			}),
		).toBe("https://app.example.com/library/music/upbeat.mp3");
	});

	test("throws when libraryBaseUrl is missing for a relative URL", () => {
		expect(() =>
			resolveLibraryUrl({ sourceUrl: "/library/x.mp3" }),
		).toThrow(/libraryBaseUrl/i);
	});

	test("throws on empty sourceUrl", () => {
		expect(() =>
			resolveLibraryUrl({
				sourceUrl: "",
				libraryBaseUrl: "https://app.example.com",
			}),
		).toThrow(/empty/i);
	});
});
