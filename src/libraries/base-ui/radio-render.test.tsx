import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RadioGroup, RadioIndicator, RadioRoot } from "./radio";

describe("Base UI Radio rendering", () => {
	it("renders Radio parts through a real Radio Group", () => {
		const markup = renderToStaticMarkup(
			<RadioGroup className="radio-group" defaultValue="ssd" name="storage">
				<RadioRoot className="radio-root" value="ssd">
					<RadioIndicator className="radio-indicator" keepMounted />
				</RadioRoot>
			</RadioGroup>,
		);

		expect(markup).toContain('class="radio-group"');
		expect(markup).toContain('class="radio-root"');
		expect(markup).toContain('class="radio-indicator"');
		expect(markup).toContain('value="ssd"');
		expect(markup).toContain("data-checked");
	});

	it("renders standalone Radio parts without requiring Radio Group context", () => {
		const markup = renderToStaticMarkup(
			<RadioRoot className="radio-root" value="standalone">
				<RadioIndicator className="radio-indicator" keepMounted />
			</RadioRoot>,
		);

		expect(markup).toContain('class="radio-root"');
		expect(markup).toContain('value="standalone"');
		expect(markup).toContain('class="radio-indicator"');
	});
});
