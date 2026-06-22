import { describe, expect, test } from "bun:test";
import {
	TAB_KEYS,
	tabs,
	useAssetsPanelStore,
} from "@/stores/assets-panel-store";

describe("assets panel tab registry", () => {
	test("does not expose chat tab", () => {
		expect(TAB_KEYS.includes("chat" as (typeof TAB_KEYS)[number])).toBe(false);
		expect("chat" in tabs).toBe(false);
	});

	test("labels audio tab consistently and removes adjustment tab", () => {
		expect(TAB_KEYS.includes("adjustment" as (typeof TAB_KEYS)[number])).toBe(false);
		expect("adjustment" in tabs).toBe(false);
		expect(tabs.sounds.label).toBe("Audio");
		expect(tabs.text.label).toBe("Text & Graphics");
	});

	test("exposes templates as a first-class authoring workflow", () => {
		expect(TAB_KEYS.includes("templates" as (typeof TAB_KEYS)[number])).toBe(true);
		expect(tabs.templates.label).toBe("Templates");
	});

	test("starts with compact tool labels for desktop editor space", () => {
		expect(useAssetsPanelStore.getInitialState().showTabLabels).toBe(false);
	});
});
