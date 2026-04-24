import {
	hexToHsv,
	hsvToHex,
	parseHexAlpha,
	appendAlpha,
	formatColorValue,
	extractColorFromText,
} from "@/utils/color";

test("hexToHsv converts known color", () => {
	// pure red #ff0000 => hsv (0,1,1)
	const [h, s, v] = hexToHsv({ hex: "ff0000" });
	expect(h).toBeCloseTo(0);
	expect(s).toBeCloseTo(1);
	expect(v).toBeCloseTo(1);
});

test("hsvToHex round‑trips", () => {
	const hex = hsvToHex({ h: 120, s: 1, v: 0.5 }); // should be #008000 approx
	expect(hex.toLowerCase()).toBe("008000");
});

test("parseHexAlpha extracts alpha", () => {
	const { rgb, alpha } = parseHexAlpha({ hex: "ff000080" });
	expect(rgb).toBe("ff0000");
	expect(alpha).toBeCloseTo(0.5);
});

test("appendAlpha adds alpha when needed", () => {
	expect(appendAlpha({ rgbHex: "112233", alpha: 0.5 })).toMatch(
		/^112233[0-9a-f]{2}$/i,
	);
	expect(appendAlpha({ rgbHex: "112233", alpha: 1 })).toBe("112233");
});

test("formatColorValue outputs correct formats", () => {
	const hex = "ff0000";
	expect(formatColorValue({ hex, format: "hex" })).toBe("ff0000");
	expect(formatColorValue({ hex, format: "rgb" })).toBe("255, 0, 0");
	expect(formatColorValue({ hex, format: "hsl" })).toMatch(/0, 100%, 50%/);
	expect(formatColorValue({ hex, format: "hsv" })).toMatch(/0, 100%, 100%/);
});

test("extractColorFromText finds color in CSS string", () => {
	expect(
		extractColorFromText({ text: "background: #00ff00 !important;" }),
	).toBe("00ff00");
});
