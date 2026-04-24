import { formatDate } from "@/utils/date";

test("formatDate returns expected US format", () => {
	const date = new Date("2023-01-02T00:00:00Z");
	// In en-US locale it should be Jan 2, 2023
	const formatted = formatDate({ date });
	expect(formatted).toBe("Jan 2, 2023");
});
