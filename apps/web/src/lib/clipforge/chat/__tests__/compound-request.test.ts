import { describe, expect, test } from "bun:test";
import {
	normalizeClause,
	splitCompoundRequest,
} from "@/lib/clipforge/chat";

describe("compound request parsing", () => {
	test("splits clauses in order", () => {
		expect(
			splitCompoundRequest("make it faster and use bold center captions"),
		).toEqual(["make it faster", "use bold center captions"]);
		expect(splitCompoundRequest("swap the first and second clips")).toEqual([
			"swap the first and second clips",
		]);
		expect(
			splitCompoundRequest(
				"trim the first clip by 0.5s at the start, then move the first clip to 5s",
			),
		).toEqual([
			"trim the first clip by 0.5s at the start",
			"move the first clip to 5s",
		]);
	});

	test("normalizes whitespace and limits clause count", () => {
		expect(normalizeClause("  move   the first clip   to 5s  ")).toBe(
			"move the first clip to 5s",
		);
		expect(
			splitCompoundRequest(
				"one and two and three and four and five",
			),
		).toEqual(["one", "two", "three"]);
	});
});
