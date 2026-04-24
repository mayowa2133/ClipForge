import {
	getPlatformSpecialKey,
	getPlatformAlternateKey,
	isAppleDevice,
} from "@/utils/platform";

describe("platform utils", () => {
	const originalPlatform = Object.getOwnPropertyDescriptor(
		global.navigator,
		"platform",
	);
	afterAll(() => {
		// restore original
		if (originalPlatform) {
			Object.defineProperty(global.navigator, "platform", originalPlatform);
		}
	});

	function mockPlatform(value: string) {
		Object.defineProperty(global.navigator, "platform", {
			value,
			configurable: true,
		});
	}

	test("detects Apple devices", () => {
		mockPlatform("iPhone");
		expect(isAppleDevice()).toBe(true);
		expect(getPlatformSpecialKey()).toBe("⌘");
		expect(getPlatformAlternateKey()).toBe("⌥");
	});

	test("detects non‑Apple devices", () => {
		mockPlatform("Win32");
		expect(isAppleDevice()).toBe(false);
		expect(getPlatformSpecialKey()).toBe("Ctrl");
		expect(getPlatformAlternateKey()).toBe("Alt");
	});
});
