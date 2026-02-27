import { describe, expect, test } from "bun:test";
import { TAB_KEYS, tabs } from "@/stores/assets-panel-store";

describe("assets panel tab registry", () => {
	test("does not expose chat tab", () => {
		expect(TAB_KEYS.includes("chat" as (typeof TAB_KEYS)[number])).toBe(false);
		expect("chat" in tabs).toBe(false);
	});
});
