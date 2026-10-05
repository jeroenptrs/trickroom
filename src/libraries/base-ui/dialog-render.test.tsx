import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	DialogBackdrop,
	DialogClose,
	DialogDescription,
	DialogPopup,
	DialogPortal,
	DialogRoot,
	DialogTitle,
	DialogTrigger,
	DialogViewport,
} from "./dialog";

describe("Base UI Dialog rendering", () => {
	it("renders the trigger through a real Base UI dialog root", () => {
		const markup = renderToStaticMarkup(
			<DialogRoot defaultOpen modal>
				<DialogTrigger className="dialog-trigger" type="button">
					Open
				</DialogTrigger>
				<DialogPortal>
					<DialogBackdrop className="dialog-backdrop" />
					<DialogViewport className="dialog-viewport">
						<DialogPopup className="dialog-popup">
							<DialogTitle className="dialog-title">Title</DialogTitle>
							<DialogDescription className="dialog-description">
								Description
							</DialogDescription>
							<DialogClose className="dialog-close" type="button">
								Close
							</DialogClose>
						</DialogPopup>
					</DialogViewport>
				</DialogPortal>
			</DialogRoot>,
		);

		expect(markup).toContain('class="dialog-trigger"');
		expect(markup).toContain('aria-haspopup="dialog"');
		expect(markup).toContain("Open");
	});

	it("renders standalone Dialog parts without requiring Base UI context", () => {
		const markup = renderToStaticMarkup(
			<>
				<DialogTrigger className="dialog-trigger" type="button">
					Open
				</DialogTrigger>
				<DialogPortal>
					<DialogBackdrop className="dialog-backdrop" />
					<DialogViewport className="dialog-viewport">
						<DialogPopup className="dialog-popup">
							<DialogTitle className="dialog-title">Title</DialogTitle>
							<DialogDescription className="dialog-description">
								Description
							</DialogDescription>
							<DialogClose className="dialog-close" type="button">
								Close
							</DialogClose>
						</DialogPopup>
					</DialogViewport>
				</DialogPortal>
			</>,
		);

		expect(markup).toContain('data-trickroom-dialog-portal=""');
		expect(markup).toContain('<button class="dialog-trigger" type="button">');
		expect(markup).toContain('class="dialog-backdrop"');
		expect(markup).toContain('class="dialog-viewport"');
		expect(markup).toContain('class="dialog-popup"');
		expect(markup).toContain('<h2 class="dialog-title">Title</h2>');
		expect(markup).toContain('<p class="dialog-description">Description</p>');
		expect(markup).toContain('class="dialog-close"');
	});

	it("keeps viewport and popup in fallback mode without a dialog portal", () => {
		const markup = renderToStaticMarkup(
			<DialogRoot defaultOpen>
				<DialogViewport className="dialog-viewport">
					<DialogPopup className="dialog-popup" initialFocus={false}>
						<DialogTitle className="dialog-title">Title</DialogTitle>
					</DialogPopup>
				</DialogViewport>
			</DialogRoot>,
		);

		expect(markup).toContain('class="dialog-viewport"');
		expect(markup).toContain('class="dialog-popup"');
		expect(markup).not.toContain("initialFocus");
		expect(markup).toContain('class="dialog-title"');
	});
});
