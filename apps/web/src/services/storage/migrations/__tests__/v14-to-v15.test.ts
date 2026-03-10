import { describe, expect, test } from "bun:test";
import { transformProjectV14ToV15 } from "../transformers/v14-to-v15";
import {
	DEFAULT_PROJECT_BRAND_KIT,
	DEFAULT_PROJECT_OVERLAY_DEFAULTS,
} from "@/constants/project-constants";

const v14Project = {
	id: "project-v14-123",
	version: 14,
	metadata: {
		id: "project-v14-123",
		name: "My V14 Project",
		duration: 8,
		createdAt: "2026-03-09T10:00:00.000Z",
		updatedAt: "2026-03-09T12:00:00.000Z",
	},
	scenes: [],
	settings: {
		fps: 30,
		canvasSize: { width: 1920, height: 1080 },
		background: { type: "color", color: "#000000" },
		audio: {
			masterVolume: 1,
			duckingEnabled: true,
			duckingAmount: 0.45,
			duckingAttackMs: 120,
			duckingReleaseMs: 280,
		},
		brandKit: {
			...DEFAULT_PROJECT_BRAND_KIT,
			primaryColor: "#ABCDEF",
		},
	},
};

describe("V14 to V15 migration", () => {
	test("adds default overlay defaults while preserving brand kit", () => {
		const result = transformProjectV14ToV15({ project: v14Project });
		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(15);
		expect((result.project.settings as any).brandKit.primaryColor).toBe("#ABCDEF");
		expect((result.project.settings as any).overlayDefaults).toEqual(
			DEFAULT_PROJECT_OVERLAY_DEFAULTS,
		);
	});
});
