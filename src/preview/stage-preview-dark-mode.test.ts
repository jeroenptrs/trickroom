import { describe, expect, it } from "vitest";
import {
	getStagePreviewContainerClassName,
	STAGE_PREVIEW_CONTAINER_CLASS,
} from "./stage-preview-dark-mode";

describe("stage preview dark mode", () => {
	it("returns only the marker class when preview dark mode is off", () => {
		expect(getStagePreviewContainerClassName(false)).toBe(
			STAGE_PREVIEW_CONTAINER_CLASS,
		);
	});

	it("adds the dark class when preview dark mode is on", () => {
		expect(getStagePreviewContainerClassName(true)).toBe(
			`${STAGE_PREVIEW_CONTAINER_CLASS} dark`,
		);
	});
});
