import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FieldsetLegend, FieldsetRoot } from "./fieldset";

describe("Base UI Fieldset rendering", () => {
	it("renders a fieldset with a legend", () => {
		const markup = renderToStaticMarkup(
			<FieldsetRoot className="fieldset-root" disabled>
				<FieldsetLegend className="fieldset-legend">
					Billing details
				</FieldsetLegend>
			</FieldsetRoot>,
		);

		expect(markup).toContain("<fieldset");
		expect(markup).toContain('class="fieldset-root"');
		expect(markup).toContain("disabled");
		expect(markup).toContain('class="fieldset-legend"');
		expect(markup).toContain("Billing details");
	});
});
