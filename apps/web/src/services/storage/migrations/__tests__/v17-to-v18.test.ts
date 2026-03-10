import { describe, expect, test } from "bun:test";
import { DEFAULT_PROJECT_LIBRARY_DEFAULTS } from "@/constants/project-constants";
import { transformProjectV17ToV18 } from "../transformers/v17-to-v18";

const v17Project = {
	id: "project-v17-123",
	version: 17,
	metadata: {
		id: "project-v17-123",
		name: "My V17 Project",
		duration: 8,
		createdAt: "2026-03-10T10:00:00.000Z",
		updatedAt: "2026-03-10T12:00:00.000Z",
	},
	settings: {
		fps: 30,
		canvasSize: { width: 1080, height: 1920 },
		background: { type: "color", color: "#000000" },
	},
	scenes: [],
};

describe("V17 to V18 migration", () => {
	test("adds default project library defaults", () => {
		const result = transformProjectV17ToV18({ project: v17Project });

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(18);
		expect((result.project.settings as any).libraryDefaults).toEqual(
			DEFAULT_PROJECT_LIBRARY_DEFAULTS,
		);
	});
});
