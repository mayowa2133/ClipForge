import { describe, expect, test } from "bun:test";
import { transformProjectV15ToV16 } from "../transformers/v15-to-v16";

const v15Project = {
	id: "project-v15-123",
	version: 15,
	metadata: {
		id: "project-v15-123",
		name: "My V15 Project",
		duration: 12,
		createdAt: "2026-03-10T10:00:00.000Z",
		updatedAt: "2026-03-10T12:00:00.000Z",
	},
	scenes: [],
	settings: {
		fps: 30,
		canvasSize: { width: 1920, height: 1080 },
		background: { type: "color", color: "#000000" },
	},
};

describe("V15 to V16 migration", () => {
	test("bumps the project version to 16", () => {
		const result = transformProjectV15ToV16({ project: v15Project });
		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(16);
	});
});
