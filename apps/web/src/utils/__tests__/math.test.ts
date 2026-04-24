import { clamp, evaluateMathExpression } from "@/utils/math";

test("clamp respects bounds", () => {
	expect(clamp({ value: 5, min: 0, max: 10 })).toBe(5);
	expect(clamp({ value: -5, min: 0, max: 10 })).toBe(0);
	expect(clamp({ value: 15, min: 0, max: 10 })).toBe(10);
});

test("evaluateMathExpression evaluates safe expressions", () => {
	expect(evaluateMathExpression({ input: "2 + 3 * 4" })).toBe(14);
	expect(evaluateMathExpression({ input: "(1+2)*(3+4)" })).toBe(21);
});

test("evaluateMathExpression rejects unsafe input", () => {
	expect(evaluateMathExpression({ input: "alert(1)" })).toBeNull();
	expect(evaluateMathExpression({ input: "2 + unknown" })).toBeNull();
});
