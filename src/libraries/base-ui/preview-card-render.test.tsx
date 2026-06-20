import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	PreviewCardArrow,
	PreviewCardPopup,
	PreviewCardPortal,
	PreviewCardPositioner,
	PreviewCardRoot,
	PreviewCardTrigger,
	PreviewCardViewport,
} from "./preview-card";

describe("Base UI Preview Card rendering", () => {
	it("renders the trigger through a real Base UI preview card root", () => {
		const markup = renderToStaticMarkup(
			<PreviewCardRoot>
				<PreviewCardTrigger className="preview-card-trigger" href="#">
					Hover this link
				</PreviewCardTrigger>
			</PreviewCardRoot>,
		);

		expect(markup).toContain('class="preview-card-trigger"');
		expect(markup).toContain("Hover this link");
		expect(markup).toContain("<a");
	});

	it("renders standalone Preview Card parts without requiring Base UI context", () => {
		const markup = renderToStaticMarkup(
			<>
				<PreviewCardTrigger className="preview-card-trigger" href="#">
					Hover this link
				</PreviewCardTrigger>
				<PreviewCardPortal>
					<PreviewCardPositioner
						className="preview-card-positioner"
						side="bottom"
					>
						<PreviewCardPopup className="preview-card-popup">
							<PreviewCardArrow className="preview-card-arrow" />
							<PreviewCardViewport className="preview-card-viewport">
								Preview content
							</PreviewCardViewport>
						</PreviewCardPopup>
					</PreviewCardPositioner>
				</PreviewCardPortal>
			</>,
		);

		expect(markup).toContain('data-trickroom-preview-card-portal=""');
		expect(markup).toContain('class="preview-card-positioner"');
		expect(markup).toContain('class="preview-card-popup"');
		expect(markup).toContain('class="preview-card-arrow"');
		expect(markup).toContain('class="preview-card-viewport"');
	});

	it("keeps nested parts in fallback mode without a real Base UI positioner", () => {
		const markup = renderToStaticMarkup(
			<PreviewCardRoot>
				<PreviewCardPositioner className="preview-card-positioner">
					<PreviewCardPopup className="preview-card-popup">
						<PreviewCardArrow className="preview-card-arrow" />
					</PreviewCardPopup>
				</PreviewCardPositioner>
			</PreviewCardRoot>,
		);

		expect(markup).toContain('class="preview-card-positioner"');
		expect(markup).toContain('class="preview-card-popup"');
		expect(markup).toContain('class="preview-card-arrow"');
	});
});
