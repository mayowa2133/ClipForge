import { describe, expect, test } from "bun:test";
import { migratePanelState } from "@/stores/panel-store";

describe("panel-store migration", () => {
	test("maps v2 properties panel size to v3 rightSidebar", () => {
		const migrated = migratePanelState({
			panels: {
				tools: 20,
				preview: 55,
				properties: 25,
				mainContent: 60,
				timeline: 40,
			},
		});

		expect(migrated.panels.tools).toBe(20);
		expect(migrated.panels.preview).toBe(55);
		expect(migrated.panels.rightSidebar).toBe(25);
		expect(migrated.panels.mainContent).toBe(60);
		expect(migrated.panels.timeline).toBe(40);
		expect(migrated.panels.inspector).toBe(55);
		expect(migrated.panels.chat).toBe(45);
	});

	test("falls back to defaults for missing values", () => {
		const migrated = migratePanelState({
			panels: {
				tools: 22,
			},
		});

		expect(migrated.panels.tools).toBe(22);
		expect(migrated.panels.preview).toBe(50);
		expect(migrated.panels.rightSidebar).toBe(25);
		expect(migrated.panels.mainContent).toBe(50);
		expect(migrated.panels.timeline).toBe(50);
		expect(migrated.panels.inspector).toBe(55);
		expect(migrated.panels.chat).toBe(45);
	});

	test("supports legacy pre-v2 top-level panel keys", () => {
		const migrated = migratePanelState({
			toolsPanel: 18,
			previewPanel: 52,
			propertiesPanel: 30,
			mainContent: 58,
			timeline: 42,
		});

		expect(migrated.panels.tools).toBe(18);
		expect(migrated.panels.preview).toBe(52);
		expect(migrated.panels.rightSidebar).toBe(30);
		expect(migrated.panels.mainContent).toBe(58);
		expect(migrated.panels.timeline).toBe(42);
	});
});
