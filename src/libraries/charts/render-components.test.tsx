import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { pickBoxProps } from "./chart-box";
import registry from "./registry";
import { chartsRenderComponents } from "./render-components";
import { validateChartProp } from "./spec";

describe("chart render components", () => {
	it("render a loading box first, so capture waits for the lazy chunk", () => {
		const { chart: Chart } = chartsRenderComponents;
		const html = renderToStaticMarkup(
			<Chart className="h-40 w-full" data="{}" data-trickroom-node-id="plot" />,
		);
		expect(html).toContain('data-trickroom-chart="loading"');
		expect(html).toContain('class="h-40 w-full"');
		expect(html).toContain('data-trickroom-node-id="plot"');
	});

	it("keep chart data off the DOM", () => {
		expect(
			pickBoxProps({
				className: "x",
				data: "{}",
				"data-trickroom-node-id": "n",
			}),
		).toEqual({ className: "x", "data-trickroom-node-id": "n" });
	});
});

describe("the charts registry", () => {
	it("has valid default data, so a new element renders", () => {
		for (const [name, definition] of Object.entries(registry.components)) {
			const format = name === "map" ? "map" : "chart";
			expect(
				validateChartProp(format, "data", definition.defaultProps.data),
			).toBeNull();
		}
	});

	it("keeps size out of the base classes, where it would beat authored classes", () => {
		for (const definition of Object.values(registry.components)) {
			expect(definition.baseClassName).not.toMatch(/(^|\s)(h|w|aspect)-/u);
			expect(definition.defaultProps.className).toContain("w-full");
		}
	});
});
