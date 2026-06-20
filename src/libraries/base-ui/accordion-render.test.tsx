import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	AccordionHeader,
	AccordionItem,
	AccordionPanel,
	AccordionRoot,
	AccordionTrigger,
} from "./accordion";

describe("Base UI Accordion rendering", () => {
	it("renders nested Accordion parts with real Base UI context", () => {
		const markup = renderToStaticMarkup(
			<AccordionRoot className="accordion-root">
				<AccordionItem className="accordion-item" value="details">
					<AccordionHeader className="accordion-header">
						<AccordionTrigger className="accordion-trigger" type="button">
							Details
						</AccordionTrigger>
					</AccordionHeader>
					<AccordionPanel className="accordion-panel" keepMounted>
						Panel
					</AccordionPanel>
				</AccordionItem>
			</AccordionRoot>,
		);

		expect(markup).toContain('class="accordion-root"');
		expect(markup).toContain('class="accordion-item"');
		expect(markup).toContain('class="accordion-header"');
		expect(markup).toContain('class="accordion-trigger"');
		expect(markup).toContain('class="accordion-panel"');
		expect(markup).toContain("Details");
		expect(markup).toContain("Panel");
	});

	it("renders standalone Accordion item recipe parts without requiring a root", () => {
		const markup = renderToStaticMarkup(
			<AccordionItem className="accordion-item">
				<AccordionHeader className="accordion-header">
					<AccordionTrigger className="accordion-trigger" type="button">
						Standalone
					</AccordionTrigger>
				</AccordionHeader>
				<AccordionPanel className="accordion-panel">Content</AccordionPanel>
			</AccordionItem>,
		);

		expect(markup).toContain('class="accordion-item"');
		expect(markup).toContain('class="accordion-header"');
		expect(markup).toContain('class="accordion-trigger"');
		expect(markup).toContain('type="button"');
		expect(markup).toContain('class="accordion-panel"');
		expect(markup).toContain("Standalone");
		expect(markup).toContain("Content");
	});
});
