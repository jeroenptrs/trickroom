import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	ContextMenuItem,
	ContextMenuPopup,
	ContextMenuPortal,
	ContextMenuPositioner,
	ContextMenuRoot,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "./context-menu";

describe("Base UI Context Menu rendering", () => {
	it("renders the trigger through a real Base UI context menu root", () => {
		const markup = renderToStaticMarkup(
			<ContextMenuRoot>
				<ContextMenuTrigger className="context-menu-trigger">
					Right click here
				</ContextMenuTrigger>
			</ContextMenuRoot>,
		);

		expect(markup).toContain('class="context-menu-trigger"');
		expect(markup).toContain("Right click here");
	});

	it("renders standalone Context Menu parts without requiring root context", () => {
		const markup = renderToStaticMarkup(
			<>
				<ContextMenuTrigger className="context-menu-trigger">
					Right click here
				</ContextMenuTrigger>
				<ContextMenuPortal>
					<ContextMenuPositioner className="context-menu-positioner">
						<ContextMenuPopup className="context-menu-popup">
							<ContextMenuItem className="context-menu-item">
								Item
							</ContextMenuItem>
							<ContextMenuSeparator className="context-menu-separator" />
						</ContextMenuPopup>
					</ContextMenuPositioner>
				</ContextMenuPortal>
			</>,
		);

		expect(markup).toContain('class="context-menu-trigger"');
		expect(markup).toContain('data-trickroom-context-menu-portal=""');
		expect(markup).toContain('class="context-menu-positioner"');
		expect(markup).toContain('class="context-menu-popup"');
		expect(markup).toContain('class="context-menu-item"');
		expect(markup).toContain('class="context-menu-separator"');
		expect(markup).toContain('data-orientation="horizontal"');
	});
});
