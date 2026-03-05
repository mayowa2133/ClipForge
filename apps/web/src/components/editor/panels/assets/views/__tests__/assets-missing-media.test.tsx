import { describe, expect, test } from "bun:test";
import { buildRelinkAccept } from "@/components/editor/panels/assets/views/assets";

describe("assets missing-media relink helpers", () => {
	test("builds accept string for single-type replacements", () => {
		expect(
			buildRelinkAccept({
				allowedReplacementTypes: ["video"],
			}),
		).toBe("video/*");
		expect(
			buildRelinkAccept({
				allowedReplacementTypes: ["image"],
			}),
		).toBe("image/*");
	});

	test("audio replacement allows audio and video sources", () => {
		expect(
			buildRelinkAccept({
				allowedReplacementTypes: ["audio"],
			}),
		).toBe("audio/*,video/*");
	});

	test("returns wildcard when no replacement types are available", () => {
		expect(
			buildRelinkAccept({
				allowedReplacementTypes: [],
			}),
		).toBe("*");
	});
});
