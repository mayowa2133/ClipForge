import { dimensionToAspectRatio } from "@/utils/geometry";

test("dimensionToAspectRatio simplifies ratios", () => {
	expect(dimensionToAspectRatio({ width: 1920, height: 1080 })).toBe("16:9");
	expect(dimensionToAspectRatio({ width: 1280, height: 720 })).toBe("16:9");
	expect(dimensionToAspectRatio({ width: 100, height: 100 })).toBe("1:1");
});
