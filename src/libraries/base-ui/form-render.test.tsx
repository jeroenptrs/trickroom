import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { FieldControl, FieldLabel, FieldRoot } from "./field";
import { Form } from "./form";

describe("Base UI Form rendering", () => {
	it("renders semantic form structure with fields and actions", () => {
		const markup = renderToStaticMarkup(
			<Form className="form">
				<FieldRoot className="field-root">
					<FieldLabel>Homepage</FieldLabel>
					<FieldControl type="url" placeholder="https://example.com" />
				</FieldRoot>
				<Button type="submit">Submit</Button>
			</Form>,
		);

		expect(markup).toContain("<form");
		expect(markup).toContain('class="form"');
		expect(markup).toContain('class="field-root"');
		expect(markup).toContain("Homepage");
		expect(markup).toContain('type="url"');
		expect(markup).toContain("Submit");
	});
});
