import { generateUUID } from "@/utils/id";

test("generateUUID returns a valid UUID v4 string", () => {
	const uuid = generateUUID();
	// basic UUID v4 regex
	const uuidV4Regex =
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	expect(uuid).toMatch(uuidV4Regex);
	expect(uuid.length).toBe(36);
});
