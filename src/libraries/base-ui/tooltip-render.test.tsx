import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	TooltipArrow,
	TooltipPopup,
	TooltipPortal,
	TooltipPositioner,
	TooltipProvider,
	TooltipRoot,
	TooltipTrigger,
} from "./tooltip";

describe("Base UI Tooltip rendering", () => {
	it("renders Tooltip parts through a real Base UI root", () => {
		const markup = renderToStaticMarkup(
			<TooltipProvider delay={100}>
				<TooltipRoot defaultOpen>
					<TooltipTrigger className="tooltip-trigger" type="button">
						Help
					</TooltipTrigger>
					<TooltipPortal>
						<TooltipPositioner className="tooltip-positioner" sideOffset={8}>
							<TooltipPopup className="tooltip-popup">
								<TooltipArrow className="tooltip-arrow" />
								Tooltip
							</TooltipPopup>
						</TooltipPositioner>
					</TooltipPortal>
				</TooltipRoot>
			</TooltipProvider>,
		);

		expect(markup).toContain('class="tooltip-trigger"');
		expect(markup).toContain("Help");
	});

	it("renders standalone Tooltip parts without requiring Base UI context", () => {
		const markup = renderToStaticMarkup(
			<>
				<TooltipTrigger className="tooltip-trigger" type="button" delay={100}>
					Standalone
				</TooltipTrigger>
				<TooltipPortal>
					<TooltipPositioner className="tooltip-positioner" side="bottom">
						<TooltipPopup className="tooltip-popup">
							<TooltipArrow className="tooltip-arrow" />
							Content
						</TooltipPopup>
					</TooltipPositioner>
				</TooltipPortal>
			</>,
		);

		expect(markup).toContain('class="tooltip-trigger"');
		expect(markup).toContain('type="button"');
		expect(markup).toContain('data-trickroom-tooltip-portal=""');
		expect(markup).toContain('class="tooltip-positioner"');
		expect(markup).toContain('class="tooltip-popup"');
		expect(markup).toContain('class="tooltip-arrow"');
		expect(markup).toContain("Standalone");
		expect(markup).toContain("Content");
	});
});
