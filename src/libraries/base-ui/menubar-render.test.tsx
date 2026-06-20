import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	MenuPopup,
	MenuPortal,
	MenuPositioner,
	MenuRoot,
	MenuTrigger,
} from "./menu";
import { Menubar } from "./menubar";

describe("Base UI Menubar rendering", () => {
	it("renders menu roots inside a Menubar", () => {
		const markup = renderToStaticMarkup(
			<Menubar className="menubar">
				<MenuRoot>
					<MenuTrigger className="menubar-trigger">File</MenuTrigger>
					<MenuPortal>
						<MenuPositioner>
							<MenuPopup>Items</MenuPopup>
						</MenuPositioner>
					</MenuPortal>
				</MenuRoot>
			</Menubar>,
		);

		expect(markup).toContain('class="menubar"');
		expect(markup).toContain('role="menubar"');
		expect(markup).toContain('class="menubar-trigger"');
		expect(markup).toContain("File");
	});
});
