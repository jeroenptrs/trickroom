import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Base UI Button rendering", () => {
	it("renders as a native button with Base UI props", () => {
		const markup = renderToStaticMarkup(
			<Button className="button" type="button" disabled focusableWhenDisabled>
				Submit
			</Button>,
		);

		expect(markup).toContain('class="button"');
		expect(markup).toContain('type="button"');
		expect(markup).toContain("Submit");
		expect(markup).toContain("disabled");
		expect(markup).toContain("data-disabled");
	});
});
