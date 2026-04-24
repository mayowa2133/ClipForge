import { describe, expect, test } from "bun:test";
import { getProductionCapabilitySnapshot } from "@/lib/clipforge/production/capabilities";

describe("ClipForge production capabilities", () => {
	test("covers the production roadmap surface", () => {
		const ids = getProductionCapabilitySnapshot().map((capability) => capability.id);
		expect(ids).toContain("cloud-projects");
		expect(ids).toContain("managed-transcription");
		expect(ids).toContain("server-export");
		expect(ids).toContain("collaboration");
		expect(ids).toContain("publishing");
		expect(ids).toContain("rights-ledger");
		expect(ids).toContain("release-gates");
	});

	test("returns a defensive snapshot", () => {
		const first = getProductionCapabilitySnapshot();
		first[0]!.label = "mutated";
		expect(getProductionCapabilitySnapshot()[0]!.label).not.toBe("mutated");
	});
});
