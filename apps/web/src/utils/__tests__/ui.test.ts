import { cn } from "@/utils/ui";

test("cn merges and dedupes Tailwind classes", () => {
	const result = cn("bg-red-500", "bg-blue-500", "p-2", "p-4");
	// twMerge should keep the last occurrence of conflicting utilities
	expect(result).toContain("bg-blue-500");
	expect(result).toContain("p-4");
	// No duplicate class
	expect(result.split(" ").filter((c) => c === "bg-blue-500").length).toBe(1);
});
