import { describe, expect, it } from "vitest";
import { getTrickroomBuiltinMenuItems } from "./AddLayerCommandMenu";

describe("trickroom builtin menu items", () => {
	it("excludes container/text (offered as fast primitives) but keeps other builtins", () => {
		const { components } = getTrickroomBuiltinMenuItems();
		const componentIds = components.map((item) =>
			item.type === "component" ? item.component : item.recipe,
		);

		expect(componentIds).not.toContain("container");
		expect(componentIds).not.toContain("text");
		expect(componentIds).toEqual(expect.arrayContaining(["asset", "icon"]));
	});
});
