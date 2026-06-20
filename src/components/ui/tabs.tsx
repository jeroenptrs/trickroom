import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

const tabs = tv({
	slots: {
		root: "flex flex-col gap-1",
		list: "flex",
		tab: "border-none bg-transparent rounded-none inset-shadow-[0_0_0_1px] inset-shadow-transparent px-2 py-1 text-xs font-medium text-slate-950 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
		panel: "focus-visible:outline-none",
	},
	variants: {
		variant: {
			line: {
				list: "border-b border-slate-200",
				tab: "not-disabled:focus-within:inset-shadow-cyan-200 data-active:bg-cyan-50 data-active:inset-shadow-transparent data-active:hover:bg-cyan-50 data-active:text-cyan-500 not-disabled:hover:bg-slate-200 not-disabled:active:bg-cyan-50 not-disabled:active:text-cyan-500",
			},
			block: {
				list: "gap-px border-b-0",
				tab: "not-disabled:focus-within:inset-shadow-cyan-500 data-active:bg-cyan-100 data-active:text-cyan-900 data-active:[&_svg]:text-cyan-900 data-active:hover:bg-cyan-100 not-disabled:hover:bg-slate-100 not-disabled:active:bg-cyan-100 not-disabled:active:text-cyan-900 not-disabled:active:[&_svg]:text-cyan-900",
			},
		},
	},
	defaultVariants: {
		variant: "line",
	},
});

type TabsVariant = "line" | "block";

function Tabs({
	className,
	...props
}: ComponentProps<typeof TabsPrimitive.Root> & { className?: string }) {
	return (
		<TabsPrimitive.Root
			data-slot="tabs-root"
			className={tabs().root({ className })}
			{...props}
		/>
	);
}

function TabsList({
	className,
	variant = "line",
	...props
}: ComponentProps<typeof TabsPrimitive.List> & {
	className?: string;
	variant?: TabsVariant;
}) {
	const { list } = tabs({ variant });

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
	variant = "line",
	...props
}: ComponentProps<typeof TabsPrimitive.Tab> & {
	className?: string;
	variant?: TabsVariant;
}) {
	const { tab } = tabs({ variant });

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
			className={tabs().panel({ className })}
			{...props}
		/>
	);
}

export { Tabs, TabsList, TabsPanel, TabsTab };
