import { Toolbar } from "@base-ui/react/toolbar";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { renderFallback } from "./render-fallback";

type ToolbarRootProps = ComponentPropsWithoutRef<typeof Toolbar.Root>;
type ToolbarGroupProps = ComponentPropsWithoutRef<typeof Toolbar.Group>;
type ToolbarButtonProps = ComponentPropsWithoutRef<typeof Toolbar.Button>;
type ToolbarLinkProps = ComponentPropsWithoutRef<typeof Toolbar.Link>;
type ToolbarInputProps = ComponentPropsWithoutRef<typeof Toolbar.Input>;
type ToolbarSeparatorProps = ComponentPropsWithoutRef<typeof Toolbar.Separator>;

const ToolbarRootRenderContext = createContext(false);

export const ToolbarRoot = forwardRef<HTMLDivElement, ToolbarRootProps>(
	function ToolbarRoot(props, ref) {
		return (
			<ToolbarRootRenderContext.Provider value={true}>
				<Toolbar.Root {...props} ref={ref} />
			</ToolbarRootRenderContext.Provider>
		);
	},
);

export const ToolbarGroup = forwardRef<HTMLDivElement, ToolbarGroupProps>(
	function ToolbarGroup(props, ref) {
		const isInsideToolbarRoot = useContext(ToolbarRootRenderContext);

		if (isInsideToolbarRoot) {
			return <Toolbar.Group {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref, ["disabled"]);
	},
);

export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
	function ToolbarButton(props, ref) {
		const isInsideToolbarRoot = useContext(ToolbarRootRenderContext);

		if (isInsideToolbarRoot) {
			return <Toolbar.Button {...props} ref={ref} />;
		}

		return renderFallback("button", props, ref, [
			"focusableWhenDisabled",
			"nativeButton",
		]);
	},
);

export const ToolbarLink = forwardRef<HTMLAnchorElement, ToolbarLinkProps>(
	function ToolbarLink(props, ref) {
		const isInsideToolbarRoot = useContext(ToolbarRootRenderContext);

		if (isInsideToolbarRoot) {
			return <Toolbar.Link {...props} ref={ref} />;
		}

		return renderFallback("a", props, ref);
	},
);

export const ToolbarInput = forwardRef<HTMLInputElement, ToolbarInputProps>(
	function ToolbarInput(props, ref) {
		const isInsideToolbarRoot = useContext(ToolbarRootRenderContext);

		if (isInsideToolbarRoot) {
			return <Toolbar.Input {...props} ref={ref} />;
		}

		return renderFallback("input", props, ref, ["focusableWhenDisabled"]);
	},
);

export const ToolbarSeparator = forwardRef<
	HTMLDivElement,
	ToolbarSeparatorProps
>(function ToolbarSeparator(props, ref) {
	const isInsideToolbarRoot = useContext(ToolbarRootRenderContext);

	if (isInsideToolbarRoot) {
		return <Toolbar.Separator {...props} ref={ref} />;
	}

	const { render: _render, orientation = "vertical", ...divProps } = props;

	return (
		<div
			{...(divProps as ComponentPropsWithoutRef<"div">)}
			ref={ref}
			data-orientation={orientation}
		/>
	);
});
