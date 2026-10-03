import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const frameBody = {} as HTMLElement;
	const explicitContainer = {} as HTMLElement;
	const boardElement = {} as HTMLElement;
	const boardHost = { parentElement: boardElement } as HTMLElement;
	return {
		explicitContainer,
		boardElement,
		boardHost,
		tooltipPositionerProps: [] as Array<Record<string, unknown>>,
		dialogPopupProps: [] as Array<Record<string, unknown>>,
		frameDocument: { body: frameBody } as Document,
		menuPortalProps: [] as Array<{ container?: unknown }>,
		dialogRootProps: [] as Array<Record<string, unknown>>,
		dialogPortalProps: [] as Array<{ container?: unknown }>,
		alertDialogRootProps: [] as Array<Record<string, unknown>>,
		alertDialogPortalProps: [] as Array<{ container?: unknown }>,
		tooltipPortalProps: [] as Array<{ container?: unknown }>,
	};
});

vi.mock("react-frame-component", () => ({
	useFrame: () => ({ document: mocks.frameDocument }),
}));

vi.mock("@base-ui/react/tooltip", () => {
	const Root = ({ children }: { children?: ReactNode }) => (
		<div>{children}</div>
	);
	return {
		Tooltip: {
			Provider: Root,
			Root,
			Trigger: Root,
			Portal: ({ children, ...props }: { children?: ReactNode }) => {
				mocks.tooltipPortalProps.push(props);
				return <div>{children}</div>;
			},
			Positioner: ({
				children,
				...props
			}: { children?: ReactNode } & Record<string, unknown>) => {
				mocks.tooltipPositionerProps.push(props);
				return <div>{children}</div>;
			},
			Popup: Root,
			Arrow: Root,
		},
	};
});

vi.mock("@base-ui/react/menu", () => {
	const Root = ({ children }: { children?: ReactNode }) => (
		<div>{children}</div>
	);
	return {
		Menu: {
			Root,
			Trigger: Root,
			Portal: ({ children, ...props }: { children?: ReactNode }) => {
				mocks.menuPortalProps.push(props);
				return <div>{children}</div>;
			},
			Positioner: Root,
			Popup: Root,
			Item: Root,
			Separator: Root,
		},
	};
});

vi.mock("@base-ui/react/dialog", () => {
	const Part =
		(part: string) =>
		({ children }: { children?: ReactNode }) => (
			<div data-mock-dialog-part={part}>{children}</div>
		);
	return {
		Dialog: {
			Root: ({
				children,
				...props
			}: { children?: ReactNode } & Record<string, unknown>) => {
				mocks.dialogRootProps.push(props);
				return <div>{children}</div>;
			},
			Trigger: Part("trigger"),
			Portal: ({ children, ...props }: { children?: ReactNode }) => {
				mocks.dialogPortalProps.push(props);
				return <div>{children}</div>;
			},
			Backdrop: Part("backdrop"),
			Viewport: Part("viewport"),
			Popup: ({
				children,
				...props
			}: { children?: ReactNode } & Record<string, unknown>) => {
				mocks.dialogPopupProps.push(props);
				return <div data-mock-dialog-part="popup">{children}</div>;
			},
			Title: Part("title"),
			Description: Part("description"),
			Close: Part("close"),
		},
	};
});

vi.mock("@base-ui/react/alert-dialog", () => {
	const Part =
		(part: string) =>
		({ children }: { children?: ReactNode }) => (
			<div data-mock-alert-dialog-part={part}>{children}</div>
		);
	return {
		AlertDialog: {
			Root: ({
				children,
				...props
			}: { children?: ReactNode } & Record<string, unknown>) => {
				mocks.alertDialogRootProps.push(props);
				return <div>{children}</div>;
			},
			Trigger: Part("trigger"),
			Portal: ({ children, ...props }: { children?: ReactNode }) => {
				mocks.alertDialogPortalProps.push(props);
				return <div>{children}</div>;
			},
			Backdrop: Part("backdrop"),
			Viewport: Part("viewport"),
			Popup: Part("popup"),
			Title: Part("title"),
			Description: Part("description"),
			Close: Part("close"),
		},
	};
});

import {
	type StageBoardPortal,
	StageBoardPortalContext,
} from "../stage-portal";
import {
	AlertDialogBackdrop,
	AlertDialogClose,
	AlertDialogDescription,
	AlertDialogPopup,
	AlertDialogPortal,
	AlertDialogRoot,
	AlertDialogTitle,
	AlertDialogViewport,
} from "./alert-dialog";
import {
	DialogBackdrop,
	DialogClose,
	DialogDescription,
	DialogPopup,
	DialogPortal,
	DialogRoot,
	DialogTitle,
	DialogViewport,
} from "./dialog";
import { MenuPortal, MenuRoot } from "./menu";
import { TooltipPortal, TooltipPositioner, TooltipRoot } from "./tooltip";

function inBoard(
	children: ReactNode,
	board: Partial<StageBoardPortal> = {},
): ReactNode {
	return (
		<StageBoardPortalContext.Provider
			value={{
				container: mocks.boardHost,
				canvas: true,
				requestContainer: () => () => undefined,
				...board,
			}}
		>
			{children}
		</StageBoardPortalContext.Provider>
	);
}

describe("Base UI portal containers", () => {
	it("defaults tooltip portals to the frame document body", () => {
		renderToStaticMarkup(
			<TooltipRoot>
				<TooltipPortal>
					<div>Tooltip</div>
				</TooltipPortal>
			</TooltipRoot>,
		);

		expect(mocks.tooltipPortalProps.at(-1)?.container).toBe(
			mocks.frameDocument.body,
		);
	});

	it("defaults menu portals to the frame document body", () => {
		renderToStaticMarkup(
			<MenuRoot>
				<MenuPortal>
					<div>Menu</div>
				</MenuPortal>
			</MenuRoot>,
		);

		expect(mocks.menuPortalProps.at(-1)?.container).toBe(
			mocks.frameDocument.body,
		);
	});

	it("preserves explicit portal containers", () => {
		renderToStaticMarkup(
			<TooltipRoot>
				<TooltipPortal container={mocks.explicitContainer}>
					<div>Tooltip</div>
				</TooltipPortal>
			</TooltipRoot>,
		);

		expect(mocks.tooltipPortalProps.at(-1)?.container).toBe(
			mocks.explicitContainer,
		);
	});

	it("defaults dialog portals to the frame document body", () => {
		renderToStaticMarkup(
			<DialogRoot defaultOpen>
				<DialogPortal>
					<div>Dialog</div>
				</DialogPortal>
			</DialogRoot>,
		);

		expect(mocks.dialogPortalProps.at(-1)?.container).toBe(
			mocks.frameDocument.body,
		);
	});

	it("preserves explicit dialog portal containers", () => {
		renderToStaticMarkup(
			<DialogRoot defaultOpen>
				<DialogPortal container={mocks.explicitContainer}>
					<div>Dialog</div>
				</DialogPortal>
			</DialogRoot>,
		);

		expect(mocks.dialogPortalProps.at(-1)?.container).toBe(
			mocks.explicitContainer,
		);
	});

	it("opens dialogs through Base UI with defaultOpen and renders every part", () => {
		const markup = renderToStaticMarkup(
			<DialogRoot defaultOpen modal>
				<DialogPortal>
					<DialogBackdrop />
					<DialogViewport>
						<DialogPopup>
							<DialogTitle>Title</DialogTitle>
							<DialogDescription>Description</DialogDescription>
							<DialogClose>Close</DialogClose>
						</DialogPopup>
					</DialogViewport>
				</DialogPortal>
			</DialogRoot>,
		);

		expect(mocks.dialogRootProps.at(-1)).toMatchObject({
			defaultOpen: true,
			modal: true,
		});
		for (const part of [
			"backdrop",
			"viewport",
			"popup",
			"title",
			"description",
			"close",
		]) {
			expect(markup).toContain(`data-mock-dialog-part="${part}"`);
		}
	});

	it("defaults alert dialog portals to the frame document body", () => {
		renderToStaticMarkup(
			<AlertDialogRoot defaultOpen>
				<AlertDialogPortal>
					<div>Alert dialog</div>
				</AlertDialogPortal>
			</AlertDialogRoot>,
		);

		expect(mocks.alertDialogPortalProps.at(-1)?.container).toBe(
			mocks.frameDocument.body,
		);
	});

	it("preserves explicit alert dialog portal containers", () => {
		renderToStaticMarkup(
			<AlertDialogRoot defaultOpen>
				<AlertDialogPortal container={mocks.explicitContainer}>
					<div>Alert dialog</div>
				</AlertDialogPortal>
			</AlertDialogRoot>,
		);

		expect(mocks.alertDialogPortalProps.at(-1)?.container).toBe(
			mocks.explicitContainer,
		);
	});

	it("opens alert dialogs through Base UI with defaultOpen and renders every part", () => {
		const markup = renderToStaticMarkup(
			<AlertDialogRoot defaultOpen>
				<AlertDialogPortal>
					<AlertDialogBackdrop />
					<AlertDialogViewport>
						<AlertDialogPopup>
							<AlertDialogTitle>Title</AlertDialogTitle>
							<AlertDialogDescription>Description</AlertDialogDescription>
							<AlertDialogClose>Close</AlertDialogClose>
						</AlertDialogPopup>
					</AlertDialogViewport>
				</AlertDialogPortal>
			</AlertDialogRoot>,
		);

		expect(mocks.alertDialogRootProps.at(-1)).toMatchObject({
			defaultOpen: true,
		});
		for (const part of [
			"backdrop",
			"viewport",
			"popup",
			"title",
			"description",
			"close",
		]) {
			expect(markup).toContain(`data-mock-alert-dialog-part="${part}"`);
		}
	});

	describe("inside a stage board", () => {
		it("portals overlays into the board's host", () => {
			renderToStaticMarkup(
				inBoard(
					<DialogRoot defaultOpen>
						<DialogPortal>
							<div>Dialog</div>
						</DialogPortal>
					</DialogRoot>,
				),
			);

			expect(mocks.dialogPortalProps.at(-1)?.container).toBe(mocks.boardHost);
		});

		it("waits for the board's host instead of falling back to the body", () => {
			renderToStaticMarkup(
				inBoard(
					<MenuRoot>
						<MenuPortal>
							<div>Menu</div>
						</MenuPortal>
					</MenuRoot>,
					{ container: null },
				),
			);

			expect(mocks.menuPortalProps.at(-1)?.container).toBeNull();
		});

		it("still lets an explicit container win", () => {
			renderToStaticMarkup(
				inBoard(
					<AlertDialogRoot defaultOpen>
						<AlertDialogPortal container={mocks.explicitContainer}>
							<div>Alert dialog</div>
						</AlertDialogPortal>
					</AlertDialogRoot>,
				),
			);

			expect(mocks.alertDialogPortalProps.at(-1)?.container).toBe(
				mocks.explicitContainer,
			);
		});

		it("renders canvas dialogs non-modal, undismissable and without initial focus", () => {
			renderToStaticMarkup(
				inBoard(
					<DialogRoot defaultOpen modal disablePointerDismissal={false}>
						<DialogPortal>
							<DialogPopup>Popup</DialogPopup>
						</DialogPortal>
					</DialogRoot>,
				),
			);

			expect(mocks.dialogRootProps.at(-1)).toMatchObject({
				defaultOpen: true,
				modal: false,
				disablePointerDismissal: true,
			});
			expect(mocks.dialogPopupProps.at(-1)).toMatchObject({
				initialFocus: false,
			});
		});

		it("renders canvas alert dialogs through a non-modal dialog root", () => {
			const alertRootCalls = mocks.alertDialogRootProps.length;
			renderToStaticMarkup(
				inBoard(
					<AlertDialogRoot defaultOpen>
						<AlertDialogPortal>
							<AlertDialogPopup>Popup</AlertDialogPopup>
						</AlertDialogPortal>
					</AlertDialogRoot>,
				),
			);

			expect(mocks.alertDialogRootProps).toHaveLength(alertRootCalls);
			expect(mocks.dialogRootProps.at(-1)).toMatchObject({
				defaultOpen: true,
				modal: false,
				disablePointerDismissal: true,
			});
		});

		it("keeps authored modal behaviour outside the canvas", () => {
			renderToStaticMarkup(
				inBoard(
					<DialogRoot defaultOpen modal>
						<DialogPortal>
							<DialogPopup>Popup</DialogPopup>
						</DialogPortal>
					</DialogRoot>,
					{ canvas: false },
				),
			);

			expect(mocks.dialogRootProps.at(-1)).toMatchObject({ modal: true });
			expect(mocks.dialogRootProps.at(-1)).not.toHaveProperty(
				"disablePointerDismissal",
			);
			expect(mocks.dialogPopupProps.at(-1)).not.toHaveProperty("initialFocus");
		});

		it("places canvas popups as authored and keeps responsive popups in the board", () => {
			const renderPositioner = (
				canvas: boolean,
				props: Record<string, unknown> = {},
			) =>
				renderToStaticMarkup(
					inBoard(
						<TooltipRoot>
							<TooltipPortal>
								<TooltipPositioner {...props}>Tip</TooltipPositioner>
							</TooltipPortal>
						</TooltipRoot>,
						{ canvas },
					),
				);

			renderPositioner(true);
			expect(mocks.tooltipPositionerProps.at(-1)).toMatchObject({
				collisionAvoidance: { side: "none", align: "none" },
			});

			renderPositioner(false);
			expect(mocks.tooltipPositionerProps.at(-1)).toMatchObject({
				collisionBoundary: mocks.boardElement,
			});

			const authoredAvoidance = { side: "flip", align: "shift" };
			renderPositioner(true, { collisionAvoidance: authoredAvoidance });
			expect(mocks.tooltipPositionerProps.at(-1)?.collisionAvoidance).toBe(
				authoredAvoidance,
			);
		});
	});
});
