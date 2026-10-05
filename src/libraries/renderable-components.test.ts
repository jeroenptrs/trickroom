import { describe, expect, it } from "vitest";
import { baseUiRenderComponents } from "./base-ui/render-components";
import {
	hasStageRenderer,
	RENDERABLE_COMPONENT_IDS,
} from "./renderable-components";
import { trickroomRenderComponents } from "./trickroom/render-components";

describe("renderable component ids", () => {
	it("match the stage render maps exactly", () => {
		expect([...RENDERABLE_COMPONENT_IDS["base-ui"]].sort()).toEqual(
			Object.keys(baseUiRenderComponents).sort(),
		);
		expect([...RENDERABLE_COMPONENT_IDS.trickroom].sort()).toEqual(
			Object.keys(trickroomRenderComponents).sort(),
		);
	});

	it("answers per library and rejects unknown libraries", () => {
		expect(hasStageRenderer("base-ui", "dialog.popup")).toBe(true);
		expect(hasStageRenderer("trickroom", "container")).toBe(true);
		expect(hasStageRenderer("base-ui", "container")).toBe(false);
		expect(hasStageRenderer("unknown", "container")).toBe(false);
		expect(hasStageRenderer("base-ui", "hasOwnProperty")).toBe(false);
	});
});
