import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

// Collapsible section shell: header row (chevron + label + summary slot) over
// a padded panel. The summary slot only shows while collapsed — meant for
// Chip rollups of the section's set values. Ancestor-state styling uses
// [[data-panel-open]_&] descendant selectors because Tailwind v4 doesn't
// support group-data-* for arbitrary data attributes (see command.tsx).
const disclosure = tv({
	slots: {
		root: "flex flex-col",
		trigger:
			"flex w-full items-center gap-1 px-3 py-2 text-left text-[11px] font-semibold text-slate-700 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500",
		chevron:
			"size-3 shrink-0 text-slate-400 transition-transform [[data-panel-open]_&]:rotate-90",
		summary:
			"ml-auto flex min-w-0 items-center gap-1 overflow-hidden [[data-panel-open]_&]:hidden",
		panel: "flex flex-col gap-2 px-3 pb-3",
	},
});

const { root, trigger, chevron, summary, panel } = disclosure();

function Disclosure({
	className,
	...props
}: CollapsiblePrimitive.Root.Props & { className?: string }) {
	return (
		<CollapsiblePrimitive.Root
			data-slot="disclosure"
			className={root({ className })}
			{...props}
		/>
	);
}

function DisclosureTrigger({
	className,
	children,
	...props
}: CollapsiblePrimitive.Trigger.Props & { className?: string }) {
	return (
		<CollapsiblePrimitive.Trigger
			data-slot="disclosure-trigger"
			className={trigger({ className })}
			{...props}
		>
			<ChevronRight className={chevron()} aria-hidden="true" />
			{children}
		</CollapsiblePrimitive.Trigger>
	);
}

/** Collapsed-only rollup slot, placed inside the trigger after the label. */
function DisclosureSummary({ className, ...props }: ComponentProps<"span">) {
	return (
		<span
			data-slot="disclosure-summary"
			className={summary({ className })}
			{...props}
		/>
	);
}

function DisclosurePanel({
	className,
	...props
}: CollapsiblePrimitive.Panel.Props & { className?: string }) {
	return (
		<CollapsiblePrimitive.Panel
			data-slot="disclosure-panel"
			className={panel({ className })}
			{...props}
		/>
	);
}

export { Disclosure, DisclosurePanel, DisclosureSummary, DisclosureTrigger };
