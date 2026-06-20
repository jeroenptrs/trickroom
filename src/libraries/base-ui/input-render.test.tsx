import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Input } from "./input";

describe("Base UI Input rendering", () => {
	it("renders a native input with visual design props", () => {
		const markup = renderToStaticMarkup(
			<Input
				className="input"
				type="email"
				placeholder="name@example.com"
				defaultValue="hello@example.com"
				disabled
			/>,
		);

		expect(markup).toContain('class="input"');
		expect(markup).toContain('type="email"');
		expect(markup).toContain('placeholder="name@example.com"');
		expect(markup).toContain('value="hello@example.com"');
		expect(markup).toContain("disabled");
		expect(markup).toContain("data-disabled");
	});
});
