// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
	isEnterActivatedTarget,
	LAYER_ROW_ATTRIBUTE,
} from "./editor-shortcuts";

function element(html: string) {
	const host = document.createElement("div");
	host.innerHTML = html;
	return host.querySelector("[data-target]") as Element;
}

describe("isEnterActivatedTarget", () => {
	it("leaves Enter to focused buttons, links and menu items", () => {
		expect(isEnterActivatedTarget(element('<button data-target="">'))).toBe(
			true,
		);
		expect(
			isEnterActivatedTarget(element('<a href="#" data-target="">x</a>')),
		).toBe(true);
		expect(
			isEnterActivatedTarget(element('<div role="menuitem" data-target="">')),
		).toBe(true);
	});

	it("hands Enter on a layer row to the layer shortcuts", () => {
		expect(
			isEnterActivatedTarget(
				element(`<button ${LAYER_ROW_ATTRIBUTE}="" data-target="">`),
			),
		).toBe(false);
		expect(
			isEnterActivatedTarget(
				element(
					`<button ${LAYER_ROW_ATTRIBUTE}=""><span data-target="">x</span></button>`,
				),
			),
		).toBe(false);
	});

	it("is false for documents and plain elements", () => {
		expect(isEnterActivatedTarget(document)).toBe(false);
		expect(isEnterActivatedTarget(element('<div data-target="">'))).toBe(false);
	});
});
