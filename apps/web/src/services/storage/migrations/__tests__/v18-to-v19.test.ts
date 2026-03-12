import { describe, expect, test } from "bun:test";
import { transformProjectV18ToV19 } from "../transformers/v18-to-v19";

const v18Project = {
	id: "project-v18-123",
	version: 18,
	metadata: {
		id: "project-v18-123",
		name: "My V18 Project",
		duration: 8,
		createdAt: "2026-03-12T10:00:00.000Z",
		updatedAt: "2026-03-12T12:00:00.000Z",
	},
	settings: {
		fps: 30,
		canvasSize: { width: 1080, height: 1920 },
		background: { type: "color", color: "#000000" },
		audio: {
			masterVolume: 1,
			duckingEnabled: true,
			duckingAmount: 0.5,
			duckingAttackMs: 100,
			duckingReleaseMs: 300,
		},
	},
	scenes: [],
};

describe("V18 to V19 migration", () => {
	test("adds polish-profile and audio-polish defaults", () => {
		const result = transformProjectV18ToV19({ project: v18Project });

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(19);
		expect((result.project.settings as any).polishProfileId).toBeNull();
		expect((result.project.settings as any).audio.audioPolishPresetId).toBe("none");
		expect((result.project.settings as any).audio.softLimiterEnabled).toBe(false);
	});
});
