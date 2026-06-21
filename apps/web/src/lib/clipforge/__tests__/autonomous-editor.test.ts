import { describe, expect, test } from "bun:test";
import { detectUniversalFlubCuts } from "@/lib/clipforge/autonomous-editor";

function words(text: string, startMs = 0) {
	return text.split(/\s+/).map((text, index) => ({
		text,
		start_ms: startMs + index * 120,
		end_ms: startMs + index * 120 + 100,
	}));
}

describe("autonomous editor decisions", () => {
	test("cuts a short flub between an incomplete take and its restart", () => {
		const before = words("Most people think success comes from", 0);
		const flub = words("crap.", 900);
		const restart = words(
			"Most people think success comes from talent or knowledge.",
			1300,
		);

		expect(
			detectUniversalFlubCuts({ words: [...before, ...flub, ...restart] }),
		).toEqual([{ start_ms: 0, end_ms: 1000 }]);
	});

	test("cuts a profane false take when the next sentence restarts it", () => {
		const falseTake = words("You are about to fuck.", 0);
		const restart = words("You are about to prove every person wrong.", 900);

		expect(
			detectUniversalFlubCuts({ words: [...falseTake, ...restart] }),
		).toEqual([{ start_ms: 0, end_ms: 580 }]);
	});

	test("keeps intentional profanity that is not a flub or restart", () => {
		expect(
			detectUniversalFlubCuts({
				words: words(
					"Sometimes you have to stop giving a fuck about opinions.",
				),
			}),
		).toEqual([]);
	});
});
