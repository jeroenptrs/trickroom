import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	AlertDialogBackdrop,
	AlertDialogClose,
	AlertDialogDescription,
	AlertDialogPopup,
	AlertDialogPortal,
	AlertDialogRoot,
	AlertDialogTitle,
	AlertDialogTrigger,
	AlertDialogViewport,
} from "./alert-dialog";

describe("Base UI Alert Dialog rendering", () => {
	it("renders the trigger through a real Base UI alert dialog root", () => {
		const markup = renderToStaticMarkup(
			<AlertDialogRoot defaultOpen>
				<AlertDialogTrigger className="alert-dialog-trigger" type="button">
					Open
				</AlertDialogTrigger>
				<AlertDialogPortal>
					<AlertDialogBackdrop className="alert-dialog-backdrop" />
					<AlertDialogViewport className="alert-dialog-viewport">
						<AlertDialogPopup className="alert-dialog-popup">
							<AlertDialogTitle className="alert-dialog-title">
								Title
							</AlertDialogTitle>
							<AlertDialogDescription className="alert-dialog-description">
								Description
							</AlertDialogDescription>
							<AlertDialogClose className="alert-dialog-close" type="button">
								Close
							</AlertDialogClose>
						</AlertDialogPopup>
					</AlertDialogViewport>
				</AlertDialogPortal>
			</AlertDialogRoot>,
		);

		expect(markup).toContain('class="alert-dialog-trigger"');
		expect(markup).toContain('aria-haspopup="dialog"');
		expect(markup).toContain("Open");
	});

	it("renders standalone Alert Dialog parts without requiring Base UI context", () => {
		const markup = renderToStaticMarkup(
			<>
				<AlertDialogTrigger className="alert-dialog-trigger" type="button">
					Open
				</AlertDialogTrigger>
				<AlertDialogPortal>
					<AlertDialogBackdrop className="alert-dialog-backdrop" />
					<AlertDialogViewport className="alert-dialog-viewport">
						<AlertDialogPopup className="alert-dialog-popup">
							<AlertDialogTitle className="alert-dialog-title">
								Title
							</AlertDialogTitle>
							<AlertDialogDescription className="alert-dialog-description">
								Description
							</AlertDialogDescription>
							<AlertDialogClose className="alert-dialog-close" type="button">
								Close
							</AlertDialogClose>
						</AlertDialogPopup>
					</AlertDialogViewport>
				</AlertDialogPortal>
			</>,
		);

		expect(markup).toContain('data-trickroom-alert-dialog-portal=""');
		expect(markup).toContain(
			'<button class="alert-dialog-trigger" type="button">',
		);
		expect(markup).toContain('class="alert-dialog-backdrop"');
		expect(markup).toContain('class="alert-dialog-viewport"');
		expect(markup).toContain('class="alert-dialog-popup"');
		expect(markup).toContain('<h2 class="alert-dialog-title">Title</h2>');
		expect(markup).toContain(
			'<p class="alert-dialog-description">Description</p>',
		);
		expect(markup).toContain('class="alert-dialog-close"');
	});

	it("keeps viewport and popup in fallback mode without an alert dialog portal", () => {
		const markup = renderToStaticMarkup(
			<AlertDialogRoot defaultOpen>
				<AlertDialogViewport className="alert-dialog-viewport">
					<AlertDialogPopup className="alert-dialog-popup" initialFocus={false}>
						<AlertDialogTitle className="alert-dialog-title">
							Title
						</AlertDialogTitle>
					</AlertDialogPopup>
				</AlertDialogViewport>
			</AlertDialogRoot>,
		);

		expect(markup).toContain('class="alert-dialog-viewport"');
		expect(markup).toContain('class="alert-dialog-popup"');
		expect(markup).not.toContain("initialFocus");
		expect(markup).toContain('class="alert-dialog-title"');
	});
});
