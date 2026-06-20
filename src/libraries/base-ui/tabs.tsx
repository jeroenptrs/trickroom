import { Tabs } from "@base-ui/react/tabs";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { renderFallback } from "./render-fallback";

type TabsRootProps = ComponentPropsWithoutRef<typeof Tabs.Root>;
type TabsListProps = ComponentPropsWithoutRef<typeof Tabs.List>;
type TabsTabProps = ComponentPropsWithoutRef<typeof Tabs.Tab>;
type TabsIndicatorProps = ComponentPropsWithoutRef<typeof Tabs.Indicator>;
type TabsPanelProps = ComponentPropsWithoutRef<typeof Tabs.Panel>;

const TabsRootRenderContext = createContext(false);
const TabsListRenderContext = createContext(false);

export const TabsRoot = forwardRef<HTMLDivElement, TabsRootProps>(
	function TabsRoot(props, ref) {
		return (
			<TabsRootRenderContext.Provider value={true}>
				<Tabs.Root {...props} ref={ref} />
			</TabsRootRenderContext.Provider>
		);
	},
);

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
	function TabsList(props, ref) {
		const isInsideTabsRoot = useContext(TabsRootRenderContext);

		if (isInsideTabsRoot) {
			return (
				<TabsListRenderContext.Provider value={true}>
					<Tabs.List {...props} ref={ref} />
				</TabsListRenderContext.Provider>
			);
		}

		return (
			<TabsListRenderContext.Provider value={true}>
				{renderFallback("div", props, ref)}
			</TabsListRenderContext.Provider>
		);
	},
);

export const TabsTab = forwardRef<HTMLButtonElement, TabsTabProps>(
	function TabsTab(props, ref) {
		const isInsideTabsRoot = useContext(TabsRootRenderContext);
		const isInsideTabsList = useContext(TabsListRenderContext);

		if (isInsideTabsRoot && isInsideTabsList) {
			return <Tabs.Tab {...props} ref={ref} />;
		}

		return renderFallback("button", props, ref);
	},
);

export const TabsIndicator = forwardRef<HTMLDivElement, TabsIndicatorProps>(
	function TabsIndicator(props, ref) {
		const isInsideTabsRoot = useContext(TabsRootRenderContext);
		const isInsideTabsList = useContext(TabsListRenderContext);

		if (isInsideTabsRoot && isInsideTabsList) {
			return <Tabs.Indicator {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const TabsPanel = forwardRef<HTMLDivElement, TabsPanelProps>(
	function TabsPanel(props, ref) {
		const isInsideTabsRoot = useContext(TabsRootRenderContext);

		if (isInsideTabsRoot) {
			return <Tabs.Panel {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref, ["keepMounted"]);
	},
);
