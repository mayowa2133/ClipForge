import { isTypableDOMElement } from "@/utils/browser";

test("isTypableDOMElement detects editable elements", () => {
	const input = {
		tagName: "INPUT",
		isContentEditable: false,
		disabled: false,
	} as HTMLElement & HTMLInputElement;
	expect(isTypableDOMElement({ element: input })).toBe(true);
	input.disabled = true;
	expect(isTypableDOMElement({ element: input })).toBe(false);

	const textarea = {
		tagName: "TEXTAREA",
		isContentEditable: false,
		disabled: false,
	} as HTMLElement & HTMLTextAreaElement;
	expect(isTypableDOMElement({ element: textarea })).toBe(true);
	textarea.disabled = true;
	expect(isTypableDOMElement({ element: textarea })).toBe(false);

	const div = {
		tagName: "DIV",
		isContentEditable: true,
	} as HTMLElement;
	expect(isTypableDOMElement({ element: div })).toBe(true);
});
