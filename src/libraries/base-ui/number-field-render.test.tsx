import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	NumberFieldDecrement,
	NumberFieldGroup,
	NumberFieldIncrement,
	NumberFieldInput,
	NumberFieldRoot,
} from "./number-field";

describe("Base UI Number Field rendering", () => {
	it("renders Number Field parts through a real Base UI root", () => {
		const markup = renderToStaticMarkup(
			<NumberFieldRoot className="number-field-root" defaultValue={5}>
				<NumberFieldGroup className="number-field-group">
					<NumberFieldDecrement
						className="number-field-decrement"
						type="button"
					>
						−
					</NumberFieldDecrement>
					<NumberFieldInput className="number-field-input" />
					<NumberFieldIncrement
						className="number-field-increment"
						type="button"
					>
						+
					</NumberFieldIncrement>
				</NumberFieldGroup>
			</NumberFieldRoot>,
		);

		expect(markup).toContain('class="number-field-root"');
		expect(markup).toContain('class="number-field-group"');
		expect(markup).toContain('class="number-field-decrement"');
		expect(markup).toContain('class="number-field-input"');
		expect(markup).toContain('class="number-field-increment"');
		expect(markup).toContain('value="5"');
	});

	it("renders standalone Number Field parts without requiring root context", () => {
		const markup = renderToStaticMarkup(
			<NumberFieldGroup className="number-field-group">
				<NumberFieldInput className="number-field-input" />
			</NumberFieldGroup>,
		);

		expect(markup).toContain('class="number-field-group"');
		expect(markup).toContain('class="number-field-input"');
		expect(markup).toContain("<input");
	});
});
