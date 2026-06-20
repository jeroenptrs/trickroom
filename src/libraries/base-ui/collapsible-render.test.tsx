import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	CollapsiblePanel,
	CollapsibleRoot,
	CollapsibleTrigger,
} from "./collapsible";

describe("Base UI Collapsible rendering", () => {
	it("renders Collapsible parts through a real Base UI root", () => {
		const markup = renderToStaticMarkup(
			<CollapsibleRoot className="collapsible-root" defaultOpen>
				<CollapsibleTrigger className="collapsible-trigger" type="button">
					Recovery keys
				</CollapsibleTrigger>
				<CollapsiblePanel className="collapsible-panel">Panel</CollapsiblePanel>
			</CollapsibleRoot>,
		);

		expect(markup).toContain('class="collapsible-root"');
		expect(markup).toContain('class="collapsible-trigger"');
		expect(markup).toContain('class="collapsible-panel"');
		expect(markup).toContain("Recovery keys");
		expect(markup).toContain("Panel");
		expect(markup).toContain("data-open");
	});

	it("renders standalone Collapsible parts without requiring Base UI context", () => {
		const markup = renderToStaticMarkup(
			<>
				<CollapsibleTrigger className="collapsible-trigger" type="button">
					Standalone
				</CollapsibleTrigger>
				<CollapsiblePanel className="collapsible-panel" keepMounted>
					Content
				</CollapsiblePanel>
			</>,
		);

		expect(markup).toContain('class="collapsible-trigger"');
		expect(markup).toContain('type="button"');
		expect(markup).toContain('class="collapsible-panel"');
		expect(markup).toContain("Standalone");
		expect(markup).toContain("Content");
	});
});
