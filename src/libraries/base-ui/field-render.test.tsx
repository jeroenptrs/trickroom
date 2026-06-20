import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	FieldControl,
	FieldDescription,
	FieldError,
	FieldItem,
	FieldLabel,
	FieldRoot,
} from "./field";

describe("Base UI Field rendering", () => {
	it("renders Field parts through a real Base UI root", () => {
		const markup = renderToStaticMarkup(
			<FieldRoot className="field-root" invalid touched>
				<FieldLabel className="field-label">Email</FieldLabel>
				<FieldControl
					className="field-control"
					type="email"
					placeholder="name@example.com"
				/>
				<FieldDescription className="field-description">
					Used for receipts
				</FieldDescription>
				<FieldError className="field-error" match>
					Enter an email address
				</FieldError>
			</FieldRoot>,
		);

		expect(markup).toContain('class="field-root"');
		expect(markup).toContain('class="field-label"');
		expect(markup).toContain('class="field-control"');
		expect(markup).toContain('type="email"');
		expect(markup).toContain("name@example.com");
		expect(markup).toContain('class="field-description"');
		expect(markup).toContain('class="field-error"');
		expect(markup).toContain("Enter an email address");
		expect(markup).toContain("data-invalid");
		expect(markup).toContain("data-touched");
	});

	it("renders standalone Field parts without requiring root context", () => {
		const markup = renderToStaticMarkup(
			<>
				<FieldLabel className="field-label">Label</FieldLabel>
				<FieldDescription className="field-description">
					Description
				</FieldDescription>
				<FieldItem className="field-item" disabled>
					Item
				</FieldItem>
				<FieldError className="field-error" match="valueMissing">
					Error
				</FieldError>
			</>,
		);

		expect(markup).toContain('class="field-label"');
		expect(markup).toContain('class="field-description"');
		expect(markup).toContain('class="field-item"');
		expect(markup).toContain("data-disabled");
		expect(markup).toContain('class="field-error"');
	});
});
