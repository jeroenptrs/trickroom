import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSvgRoot } from "./parse-svg";

type FakeAttribute = {
	name: string;
	value: string;
};

class FakeDOMParser {
	parseFromString(svgText: string) {
		const trimmed = svgText.trim().replace(/^<\?xml[^>]*>\s*/u, "");
		const pairedMatch = /^<([a-zA-Z][\w:-]*)([^>]*)>([\s\S]*)<\/\1>\s*$/u.exec(
			trimmed,
		);
		const selfClosingMatch = /^<([a-zA-Z][\w:-]*)([^>]*)\/>\s*$/u.exec(trimmed);
		const match = pairedMatch ?? selfClosingMatch;
		const rawAttributes = match?.[2] ?? "";
		const attributes: FakeAttribute[] = [];
		const attributePattern = /([^\s=]+)="([^"]*)"/gu;

		for (const attrMatch of rawAttributes.matchAll(attributePattern)) {
			attributes.push({ name: attrMatch[1], value: attrMatch[2] });
		}

		return {
			documentElement: {
				localName: match?.[1] ?? "parsererror",
				attributes,
				innerHTML: pairedMatch?.[3] ?? "",
			},
			getElementsByTagName: (tagName: string) =>
				trimmed.includes(`<${tagName}`) ? [{}] : [],
		};
	}
}

describe("parseSvgRoot", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("copies root SVG attributes, remaps class, strips Trickroom attrs, and keeps inner markup", () => {
		vi.stubGlobal("DOMParser", FakeDOMParser);

		const parsed = parseSvgRoot(
			'<svg viewBox="0 0 24 24" class="from-svg" preserveAspectRatio="xMidYMid meet" data-trickroom-icon-id="stale" data-trickroom-extra="stale"><path d="M4 12h16"/></svg>',
		);

		expect(parsed).toEqual({
			attrs: {
				viewBox: "0 0 24 24",
				className: "from-svg",
				preserveAspectRatio: "xMidYMid meet",
			},
			innerHTML: '<path d="M4 12h16"/>',
		});
	});

	it("accepts an XML declaration and self-closing SVG root", () => {
		vi.stubGlobal("DOMParser", FakeDOMParser);

		const parsed = parseSvgRoot(
			'<?xml version="1.0" encoding="UTF-8"?><svg viewBox="0 0 16 16"/>',
		);

		expect(parsed).toEqual({
			attrs: { viewBox: "0 0 16 16" },
			innerHTML: "",
		});
	});

	it("returns null for empty input, non-svg roots, parser errors, and missing DOMParser", () => {
		vi.stubGlobal("DOMParser", FakeDOMParser);

		expect(parseSvgRoot("")).toBeNull();
		expect(parseSvgRoot("<div></div>")).toBeNull();
		expect(parseSvgRoot("<parsererror>bad</parsererror>")).toBeNull();

		vi.unstubAllGlobals();

		expect(parseSvgRoot('<svg viewBox="0 0 12 12"></svg>')).toBeNull();
	});
});
