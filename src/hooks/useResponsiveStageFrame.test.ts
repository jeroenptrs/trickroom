import { describe, expect, it } from "vitest";
import {
	applyResponsiveStageFrameState,
	resetResponsiveStageFrameState,
} from "./useResponsiveStageFrame";

function createIframeDouble() {
	const attributes = new Map<string, string>();
	const documentElement = {
		setAttribute(name: string, value: string) {
			attributes.set(name, value);
		},
		getAttribute(name: string) {
			return attributes.get(name) ?? null;
		},
	};

	return {
		iframe: {
			style: { width: "" },
			contentDocument: { documentElement },
		} as unknown as HTMLIFrameElement,
		documentElement,
	};
}

function createLoadingIframeDouble() {
	return {
		style: { width: "" },
		contentDocument: { documentElement: null },
	} as unknown as HTMLIFrameElement;
}

describe("responsive stage frame state", () => {
	it("sets the actual iframe width and document mode in responsive mode", () => {
		const { iframe, documentElement } = createIframeDouble();

		applyResponsiveStageFrameState(iframe, {
			mode: "responsive",
			responsiveWidth: 768,
		});

		expect(iframe.style.width).toBe("768px");
		expect(documentElement.getAttribute("data-trickroom-stage-mode")).toBe(
			"responsive",
		);
	});

	it("restores canvas width and document mode when canvas mode is applied", () => {
		const { iframe, documentElement } = createIframeDouble();
		iframe.style.width = "640px";
		documentElement.setAttribute("data-trickroom-stage-mode", "responsive");

		applyResponsiveStageFrameState(iframe, {
			mode: "canvas",
			responsiveWidth: 640,
		});

		expect(iframe.style.width).toBe("");
		expect(documentElement.getAttribute("data-trickroom-stage-mode")).toBe(
			"canvas",
		);
	});

	it("resets back to deterministic canvas state during cleanup", () => {
		const { iframe, documentElement } = createIframeDouble();
		iframe.style.width = "1024px";
		documentElement.setAttribute("data-trickroom-stage-mode", "responsive");

		resetResponsiveStageFrameState(iframe);

		expect(iframe.style.width).toBe("");
		expect(documentElement.getAttribute("data-trickroom-stage-mode")).toBe(
			"canvas",
		);
	});

	it("tolerates an iframe document before its documentElement exists", () => {
		const iframe = createLoadingIframeDouble();

		expect(() =>
			applyResponsiveStageFrameState(iframe, {
				mode: "responsive",
				responsiveWidth: 768,
			}),
		).not.toThrow();
		expect(iframe.style.width).toBe("768px");

		expect(() => resetResponsiveStageFrameState(iframe)).not.toThrow();
		expect(iframe.style.width).toBe("");
	});
});
