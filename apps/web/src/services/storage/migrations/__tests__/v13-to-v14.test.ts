import { describe, expect, test } from "bun:test";
import { transformProjectV13ToV14 } from "../transformers/v13-to-v14";
import { DEFAULT_PROJECT_BRAND_KIT } from "@/constants/project-constants";

const v13Project = {
	id: "project-v13-123",
	version: 13,
	metadata: {
		id: "project-v13-123",
		name: "My V13 Project",
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
	},
};

describe("V13 to V14 migration", () => {
	test("adds a default brand kit", () => {
		const result = transformProjectV13ToV14({ project: v13Project });
		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(14);
		expect((result.project.settings as any).brandKit).toEqual(DEFAULT_PROJECT_BRAND_KIT);
	});
});
