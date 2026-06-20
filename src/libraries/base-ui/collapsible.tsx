import { Collapsible } from "@base-ui/react/collapsible";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	type Ref,
	useContext,
} from "react";

type CollapsibleRootProps = ComponentPropsWithoutRef<typeof Collapsible.Root>;
type CollapsibleTriggerProps = ComponentPropsWithoutRef<
	typeof Collapsible.Trigger
>;
type CollapsiblePanelProps = ComponentPropsWithoutRef<typeof Collapsible.Panel>;

const CollapsibleRootRenderContext = createContext(false);

export const CollapsibleRoot = forwardRef<
	HTMLDivElement,
	CollapsibleRootProps
>(function CollapsibleRoot(props, ref) {
	return (
		<CollapsibleRootRenderContext.Provider value={true}>
			<Collapsible.Root {...props} ref={ref} />
		</CollapsibleRootRenderContext.Provider>
	);
});

export const CollapsibleTrigger = forwardRef<
	HTMLElement,
	CollapsibleTriggerProps
>(function CollapsibleTrigger(props, ref) {
	const isInsideCollapsibleRoot = useContext(CollapsibleRootRenderContext);

	if (isInsideCollapsibleRoot) {
		return <Collapsible.Trigger {...props} ref={ref} />;
	}

	const { nativeButton: _nativeButton, render: _render, ...buttonProps } = props;

	return (
		<button
			{...(buttonProps as ComponentPropsWithoutRef<"button">)}
			ref={ref as Ref<HTMLButtonElement>}
		/>
	);
});

export const CollapsiblePanel = forwardRef<
	HTMLDivElement,
	CollapsiblePanelProps
>(function CollapsiblePanel(props, ref) {
	const isInsideCollapsibleRoot = useContext(CollapsibleRootRenderContext);

	if (isInsideCollapsibleRoot) {
		return <Collapsible.Panel {...props} ref={ref} />;
	}

	const {
		hiddenUntilFound: _hiddenUntilFound,
		keepMounted: _keepMounted,
		render: _render,
		...divProps
	} = props;

	return <div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />;
});
