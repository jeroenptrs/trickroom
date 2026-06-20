import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	MenuItem,
	MenuPopup,
	MenuPortal,
	MenuPositioner,
	MenuRoot,
	MenuSeparator,
	MenuTrigger,
} from "./menu";

describe("Base UI Menu rendering", () => {
	it("renders the trigger through a real Base UI menu root", () => {
		const markup = renderToStaticMarkup(
			<MenuRoot>
				<MenuTrigger className="menu-trigger">Options</MenuTrigger>
			</MenuRoot>,
		);

		expect(markup).toContain('class="menu-trigger"');
		expect(markup).toContain("Options");
	});

	it("renders standalone Menu parts without requiring Base UI context", () => {
		const markup = renderToStaticMarkup(
			<MenuSeparator className="menu-separator" orientation="vertical" />,
		);

		expect(markup).toContain('class="menu-separator"');
		expect(markup).toContain('data-orientation="vertical"');
	});

	it("renders the menu fallback hierarchy without throwing", () => {
		expect(() =>
			renderToStaticMarkup(
				<MenuRoot defaultOpen>
					<MenuPortal>
						<MenuPositioner className="menu-positioner">
							<MenuPopup className="menu-popup">
								<MenuItem className="menu-item">Edit</MenuItem>
								<MenuSeparator className="menu-separator" />
							</MenuPopup>
						</MenuPositioner>
					</MenuPortal>
				</MenuRoot>,
			),
		).not.toThrow();
	});
});
