import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

const tabs = tv({
	slots: {
		root: "flex flex-col gap-1",
		list: "flex border-b border-gray-200",
		tab: "border-none bg-transparent px-2 py-1 text-xs font-medium text-gray-900/60 rounded-none focus-visible:outline-none data-active:bg-gray-200/60 data-active:font-semibold data-active:text-black not-disabled:hover:bg-gray-200/60 not-disabled:active:text-blue-500 disabled:pointer-events-none disabled:opacity-50",
		panel: "focus-visible:outline-none",
	},
});

const { root, list, tab, panel } = tabs();

function Tabs({
	className,
	...props
}: ComponentProps<typeof TabsPrimitive.Root> & { className?: string }) {
	return (
		<TabsPrimitive.Root
			data-slot="tabs-root"
			className={root({ className })}
			{...props}
		/>
	);
}

function TabsList({
	className,
	...props
}: ComponentProps<typeof TabsPrimitive.List> & { className?: string }) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			className={list({ className })}
			{...props}
		/>
	);
}

function TabsTab({
	className,
	...props
}: ComponentProps<typeof TabsPrimitive.Tab> & { className?: string }) {
	return (
		<TabsPrimitive.Tab
			data-slot="tabs-tab"
			className={tab({ className })}
			{...props}
		/>
	);
}

function TabsPanel({
	className,
	...props
}: ComponentProps<typeof TabsPrimitive.Panel> & { className?: string }) {
	return (
		<TabsPrimitive.Panel
			data-slot="tabs-panel"
			className={panel({ className })}
			{...props}
		/>
	);
}

export { Tabs, TabsList, TabsPanel, TabsTab };
