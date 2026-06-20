import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Toggle, ToggleGroup } from "./toggle";

describe("Base UI Toggle rendering", () => {
	it("renders a standalone Toggle", () => {
		const markup = renderToStaticMarkup(
			<Toggle className="toggle" value="bold" defaultPressed>
				Bold
			</Toggle>,
		);

		expect(markup).toContain('class="toggle"');
		expect(markup).toContain("Bold");
		expect(markup).toContain("data-pressed");
	});

	it("renders Toggle children inside a Toggle Group", () => {
		const markup = renderToStaticMarkup(
			<ToggleGroup className="toggle-group" multiple orientation="horizontal">
				<Toggle className="toggle" value="bold">
					Bold
				</Toggle>
				<Toggle className="toggle" value="italic">
					Italic
				</Toggle>
			</ToggleGroup>,
		);

		expect(markup).toContain('class="toggle-group"');
		expect(markup).toContain('data-orientation="horizontal"');
		expect(markup).toContain("Bold");
		expect(markup).toContain("Italic");
	});
});
