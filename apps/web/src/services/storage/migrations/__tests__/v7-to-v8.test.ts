import { describe, expect, test } from "bun:test";
import { transformProjectV7ToV8 } from "../transformers/v7-to-v8";
import { v7Project } from "./fixtures";

describe("V7 to V8 Migration", () => {
	test("adds default clipforge data", () => {
		const result = transformProjectV7ToV8({ project: v7Project });

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(8);
		expect(result.project.clipforge).toBeDefined();

		const clipforge = result.project.clipforge as Record<string, unknown>;
		expect(clipforge.schemaVersion).toBe(2);
		expect(clipforge.activeCaptionStyleId).toBe("clean-bottom");
		expect(clipforge.opsAudit).toEqual([]);
	});

	test("skips projects that are already v8", () => {
		const result = transformProjectV7ToV8({
			project: {
				...v7Project,
				version: 8,
				clipforge: { schemaVersion: 2 },
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("already v8");
	});

	test("skips projects with no id", () => {
		const result = transformProjectV7ToV8({
			project: {
				version: 7,
				scenes: [],
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("no project id");
	});
});
