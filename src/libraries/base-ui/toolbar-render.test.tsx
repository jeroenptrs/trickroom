import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	ToolbarButton,
	ToolbarInput,
	ToolbarLink,
	ToolbarRoot,
	ToolbarSeparator,
} from "./toolbar";

describe("Base UI Toolbar rendering", () => {
	it("renders Toolbar parts through a real Base UI root", () => {
		const markup = renderToStaticMarkup(
			<ToolbarRoot className="toolbar-root">
				<ToolbarButton className="toolbar-button" type="button">
					Cut
				</ToolbarButton>
				<ToolbarSeparator className="toolbar-separator" />
				<ToolbarLink className="toolbar-link" href="#">
					Help
				</ToolbarLink>
				<ToolbarInput className="toolbar-input" placeholder="Search" />
			</ToolbarRoot>,
		);

		expect(markup).toContain('class="toolbar-root"');
		expect(markup).toContain('role="toolbar"');
		expect(markup).toContain('class="toolbar-button"');
		expect(markup).toContain('class="toolbar-separator"');
		expect(markup).toContain('class="toolbar-link"');
		expect(markup).toContain('class="toolbar-input"');
	});

	it("renders standalone Toolbar parts without requiring root context", () => {
		const markup = renderToStaticMarkup(
			<>
				<ToolbarButton className="toolbar-button" type="button">
					Cut
				</ToolbarButton>
				<ToolbarSeparator className="toolbar-separator" />
			</>,
		);

		expect(markup).toContain('class="toolbar-button"');
		expect(markup).toContain('class="toolbar-separator"');
		expect(markup).toContain('data-orientation="vertical"');
	});
});
