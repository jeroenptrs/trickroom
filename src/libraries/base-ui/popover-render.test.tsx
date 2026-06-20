import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	PopoverArrow,
	PopoverClose,
	PopoverDescription,
	PopoverPopup,
	PopoverPortal,
	PopoverPositioner,
	PopoverRoot,
	PopoverTitle,
	PopoverTrigger,
	PopoverViewport,
} from "./popover";

describe("Base UI Popover rendering", () => {
	it("renders the trigger through a real Base UI popover root", () => {
		const markup = renderToStaticMarkup(
			<PopoverRoot>
				<PopoverTrigger className="popover-trigger" type="button">
					Open
				</PopoverTrigger>
			</PopoverRoot>,
		);

		expect(markup).toContain('class="popover-trigger"');
		expect(markup).toContain("Open");
	});

	it("renders standalone Popover parts without requiring Base UI context", () => {
		const markup = renderToStaticMarkup(
			<>
				<PopoverTrigger className="popover-trigger" type="button">
					Open
				</PopoverTrigger>
				<PopoverPortal>
					<PopoverPositioner className="popover-positioner" side="bottom">
						<PopoverPopup className="popover-popup">
							<PopoverArrow className="popover-arrow" />
							<PopoverViewport className="popover-viewport">
								<PopoverTitle className="popover-title">Title</PopoverTitle>
								<PopoverDescription className="popover-description">
									Description
								</PopoverDescription>
								<PopoverClose className="popover-close" type="button">
									Close
								</PopoverClose>
							</PopoverViewport>
						</PopoverPopup>
					</PopoverPositioner>
				</PopoverPortal>
			</>,
		);

		expect(markup).toContain('data-trickroom-popover-portal=""');
		expect(markup).toContain('class="popover-positioner"');
		expect(markup).toContain('class="popover-popup"');
		expect(markup).toContain('class="popover-arrow"');
		expect(markup).toContain('class="popover-viewport"');
		expect(markup).toContain('class="popover-title"');
		expect(markup).toContain('class="popover-description"');
		expect(markup).toContain('class="popover-close"');
	});

	it("keeps nested parts in fallback mode without a real Base UI positioner", () => {
		const markup = renderToStaticMarkup(
			<PopoverRoot>
				<PopoverPositioner className="popover-positioner">
					<PopoverPopup className="popover-popup">
						<PopoverArrow className="popover-arrow" />
						<PopoverViewport className="popover-viewport">
							<PopoverTitle className="popover-title">Title</PopoverTitle>
						</PopoverViewport>
					</PopoverPopup>
				</PopoverPositioner>
			</PopoverRoot>,
		);

		expect(markup).toContain('class="popover-positioner"');
		expect(markup).toContain('class="popover-popup"');
		expect(markup).toContain('class="popover-arrow"');
		expect(markup).toContain('class="popover-viewport"');
		expect(markup).toContain('class="popover-title"');
	});
});
