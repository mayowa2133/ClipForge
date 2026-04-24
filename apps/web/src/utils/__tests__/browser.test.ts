import { isTypableDOMElement } from "@/utils/browser";

test("isTypableDOMElement detects editable elements", () => {
	const input = document.createElement("input");
	document.body.appendChild(input);
	expect(isTypableDOMElement({ element: input })).toBe(true);
	input.disabled = true;
	expect(isTypableDOMElement({ element: input })).toBe(false);

	const textarea = document.createElement("textarea");
	document.body.appendChild(textarea);
	expect(isTypableDOMElement({ element: textarea })).toBe(true);
	textarea.disabled = true;
	expect(isTypableDOMElement({ element: textarea })).toBe(false);

	const div = document.createElement("div");
	div.contentEditable = "true";
	document.body.appendChild(div);
	expect(isTypableDOMElement({ element: div })).toBe(true);
});
