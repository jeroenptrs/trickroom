import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const frameBody = {} as HTMLElement;
	const explicitContainer = {} as HTMLElement;
	return {
		explicitContainer,
		frameDocument: { body: frameBody } as Document,
		menuPortalProps: [] as Array<{ container?: unknown }>,
		tooltipPortalProps: [] as Array<{ container?: unknown }>,
	};
});

vi.mock("react-frame-component", () => ({
	useFrame: () => ({ document: mocks.frameDocument }),
}));

vi.mock("@base-ui/react/tooltip", async () => {
	const React = await import("react");
	const Root = ({ children }: { children?: React.ReactNode }) => (
		<div>{children}</div>
	);
	return {
		Tooltip: {
			Provider: Root,
			Root,
			Trigger: Root,
			Portal: ({ children, ...props }: { children?: React.ReactNode }) => {
				mocks.tooltipPortalProps.push(props);
				return <div>{children}</div>;
			},
			Positioner: Root,
			Popup: Root,
			Arrow: Root,
		},
	};
});

vi.mock("@base-ui/react/menu", async () => {
	const React = await import("react");
	const Root = ({ children }: { children?: React.ReactNode }) => (
		<div>{children}</div>
	);
	return {
		Menu: {
			Root,
			Trigger: Root,
			Portal: ({ children, ...props }: { children?: React.ReactNode }) => {
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

import { MenuPortal, MenuRoot } from "./menu";
import { TooltipPortal, TooltipRoot } from "./tooltip";

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
});
