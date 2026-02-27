import { describe, expect, test } from "bun:test";
import { generateCaptionChunks, getCaptionTemplate } from "@/lib/clipforge";

describe("generateCaptionChunks", () => {
	test("creates readable chunks that respect line width and max lines", () => {
		const chunks = generateCaptionChunks({
			segments: [
				{
					text: "this is a very long sentence that should be split into readable lines for captions",
					start: 0,
					end: 8,
				},
			],
			options: {
				maxCharsPerLine: 14,
				maxLines: 2,
				minDisplaySeconds: 0.6,
				maxWordsPerChunk: 8,
			},
		});

		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			const lines = chunk.text.split("\n");
			expect(lines.length).toBeLessThanOrEqual(2);
			for (const line of lines) {
				expect(line.length).toBeLessThanOrEqual(14);
			}
			expect(chunk.duration).toBeGreaterThanOrEqual(0.6);
		}
	});

	test("returns both caption templates", () => {
		const clean = getCaptionTemplate({ styleId: "clean-bottom" });
		const bold = getCaptionTemplate({ styleId: "bold-center" });

		expect(clean.style_id).toBe("clean-bottom");
		expect(clean.position).toBe("bottom");
		expect(bold.style_id).toBe("bold-center");
		expect(bold.position).toBe("center");
		expect(bold.outline).toBe(true);
	});
});
