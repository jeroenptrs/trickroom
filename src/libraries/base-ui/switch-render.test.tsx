import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SwitchRoot, SwitchThumb } from "./switch";

describe("Base UI Switch rendering", () => {
	it("renders Switch parts through a real Base UI root", () => {
		const markup = renderToStaticMarkup(
			<SwitchRoot className="switch-root" defaultChecked name="notifications">
				<SwitchThumb className="switch-thumb" />
			</SwitchRoot>,
		);

		expect(markup).toContain('class="switch-root"');
		expect(markup).toContain('class="switch-thumb"');
		expect(markup).toContain('name="notifications"');
		expect(markup).toContain("data-checked");
	});

	it("renders standalone Switch thumb without requiring root context", () => {
		const markup = renderToStaticMarkup(
			<SwitchThumb className="switch-thumb" />,
		);

		expect(markup).toContain('class="switch-thumb"');
	});
});
