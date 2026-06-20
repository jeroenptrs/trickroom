import { describe, expect, it } from "vitest";
import { isEditableShortcutTarget } from "./editor-shortcuts";

class ForeignElement {
	ownerDocument = {
		defaultView: {
			Element: ForeignElement,
		},
	};

	constructor(
		readonly tagName = "DIV",
		private readonly role: string | null = null,
		private readonly hasShortcutDisabledAncestor = false,
		private readonly hasContentEditableAncestor = false,
	) {}

	closest(selector: string) {
		if (selector === "[data-shortcuts-disabled]") {
			return this.hasShortcutDisabledAncestor ? this : null;
		}

		if (selector === '[contenteditable="true"]') {
			return this.hasContentEditableAncestor ? this : null;
		}

		return null;
	}

	getAttribute(name: string) {
		return name === "role" ? this.role : null;
	}
}

describe("isEditableShortcutTarget", () => {
	it("recognizes editable elements from another window realm", () => {
		expect(
			isEditableShortcutTarget(
				new ForeignElement("INPUT") as unknown as EventTarget,
			),
		).toBe(true);
		expect(
			isEditableShortcutTarget(
				new ForeignElement("DIV", "textbox") as unknown as EventTarget,
			),
		).toBe(true);
		expect(
			isEditableShortcutTarget(
				new ForeignElement("DIV", null, false, true) as unknown as EventTarget,
			),
		).toBe(true);
	});

	it("ignores non-editable targets from another window realm", () => {
		expect(
			isEditableShortcutTarget(new ForeignElement() as unknown as EventTarget),
		).toBe(false);
	});
});
