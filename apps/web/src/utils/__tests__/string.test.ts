import { capitalizeFirstLetter, uppercase } from "@/utils/string";

test("capitalizeFirstLetter works", () => {
	expect(capitalizeFirstLetter({ string: "hello" })).toBe("Hello");
});

test("uppercase works", () => {
	expect(uppercase({ string: "test" })).toBe("TEST");
});
