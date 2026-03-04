import { describe, expect, test } from "bun:test";
import { CLIPFORGE_DEMO_MANIFEST } from "@/lib/clipforge";

describe("ClipForge demo manifest", () => {
	test("exposes four demo assets and sample prompts", () => {
		expect(CLIPFORGE_DEMO_MANIFEST.version).toBe(1);
		expect(CLIPFORGE_DEMO_MANIFEST.assets).toHaveLength(4);
		expect(
			CLIPFORGE_DEMO_MANIFEST.assets.filter((asset) => asset.usedFor === "primary"),
		).toHaveLength(3);
		expect(
			CLIPFORGE_DEMO_MANIFEST.assets.filter((asset) => asset.usedFor === "broll"),
		).toHaveLength(1);
		expect(CLIPFORGE_DEMO_MANIFEST.samplePrompts).toHaveLength(3);
		for (const asset of CLIPFORGE_DEMO_MANIFEST.assets) {
			expect(asset.metadata.transcriptionStatus).toBe("ready");
			expect(asset.fileName.endsWith(".mp4")).toBe(true);
		}
	});
});
