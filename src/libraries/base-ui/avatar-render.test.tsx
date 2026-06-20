import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { assetIdProp } from "../../utils/resource-props";
import { DesignSystemRenderContext } from "../trickroom/render-context";
import { AvatarFallback, AvatarImage, AvatarRoot } from "./avatar";

describe("Base UI Avatar rendering", () => {
	it("renders Avatar parts inside the recipe root with real Base UI context", () => {
		const markup = renderToStaticMarkup(
			<AvatarRoot className="avatar-root">
				<AvatarFallback className="avatar-fallback">AP</AvatarFallback>
			</AvatarRoot>,
		);

		expect(markup).toContain('class="avatar-root"');
		expect(markup).toContain('class="avatar-fallback"');
		expect(markup).toContain("AP");
	});

	it("renders standalone avatar image without requiring a Base UI root", () => {
		const markup = renderToStaticMarkup(
			<DesignSystemRenderContext.Provider value="Core System">
				<AvatarImage
					className="avatar-image"
					alt="Profile"
					{...{ [assetIdProp]: " ast_hero " }}
				/>
			</DesignSystemRenderContext.Provider>,
		);

		expect(markup).toContain('class="avatar-image"');
		expect(markup).toContain('alt="Profile"');
		expect(markup).toContain(
			'src="/api/trickroom/systems/Core%20System/assets/ast_hero/file"',
		);
		expect(markup).not.toContain(assetIdProp);
	});

	it("renders standalone avatar fallback without requiring a Base UI root", () => {
		const markup = renderToStaticMarkup(
			<AvatarFallback className="avatar-fallback">AP</AvatarFallback>,
		);

		expect(markup).toContain('class="avatar-fallback"');
		expect(markup).toContain("AP");
	});

	it("keeps blank avatar image asset ids renderable", () => {
		const markup = renderToStaticMarkup(
			<DesignSystemRenderContext.Provider value="Core">
				<AvatarImage
					className="avatar-image"
					alt=""
					{...{ [assetIdProp]: "   " }}
				/>
			</DesignSystemRenderContext.Provider>,
		);

		expect(markup).toContain('class="avatar-image"');
		expect(markup).not.toContain("src=");
	});
});
