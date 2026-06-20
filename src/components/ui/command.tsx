import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import {
	type ComponentProps,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { tv } from "tailwind-variants";

const commandStyles = tv({
	slots: {
		root: [
			"flex flex-col bg-white text-slate-950",
			"data-[keyboard-selection=true]:[&_[cmdk-item][aria-selected=true]]:bg-cyan-50",
			"data-[keyboard-selection=true]:[&_[cmdk-item][aria-selected=true]_svg]:text-cyan-700",
			"data-[keyboard-selection=true]:[&_[cmdk-item][aria-selected=true]_[data-item-name]]:font-medium",
			"data-[keyboard-selection=true]:[&_[cmdk-item][aria-selected=true]_[data-item-name]]:text-cyan-900",
			"data-[keyboard-selection=true]:[&_[cmdk-item][aria-selected=true]_[data-item-secondary]]:text-cyan-700",
			"data-[keyboard-selection=true]:[&_[cmdk-item][aria-selected=true]_[data-item-arrow]]:opacity-100",
		].join(" "),
		searchRow:
			"flex items-center gap-3 px-5 py-3.5 inset-shadow-[0_0_0_1px] inset-shadow-slate-200",
		searchInput:
			"flex-1 min-w-0 bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-400",
		escBadge:
			"shrink-0 font-mono text-[10px] uppercase tracking-wider text-slate-400 bg-slate-100 px-1.5 py-0.5",
		list: "max-h-[60vh] overflow-y-auto",
		empty: "py-6 text-center text-sm text-slate-500",
		group: "flex flex-col",
		groupLabel:
			"block bg-slate-50 px-5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500",
		// Mirrors button.tsx block variant:
		//   hover/selected → bg-cyan-50 + child colors
		//   active → bg-cyan-100
		// Child selectors via data-item-* attributes avoid group-data-* which Tailwind v4 doesn't
		// support for arbitrary data attributes (unlike group-focus-within which does work).
		item: [
			"flex items-center gap-3 px-5 py-2.5 cursor-pointer select-none outline-none font-medium",
			"hover:bg-cyan-50 hover:[&_svg]:text-cyan-700",
			"hover:[&_[data-item-name]]:font-medium hover:[&_[data-item-name]]:text-cyan-900",
			"hover:[&_[data-item-secondary]]:text-cyan-700 hover:[&_[data-item-arrow]]:opacity-100",
			"active:bg-cyan-100",
			"active:[&_svg]:text-cyan-900 active:[&_[data-item-name]]:text-cyan-900",
			"[&[aria-disabled=true]]:pointer-events-none [&[aria-disabled=true]]:opacity-60",
		].join(" "),
		separator: "h-px bg-slate-200",
		footer:
			"flex items-center justify-between gap-2 px-5 py-2 border-t border-slate-200 bg-slate-50",
		footerLeft: "flex items-center gap-3 font-mono text-[10px] text-slate-500",
		footerHint: "flex items-center gap-1",
		footerRight:
			"flex items-center gap-1.5 font-mono text-[10px] text-slate-500",
		keyBadge:
			"bg-white inset-shadow-[0_0_0_1px] inset-shadow-slate-300 px-1 font-mono text-[10px] text-slate-500",
	},
	variants: {
		// compact: in-rail menus (e.g. add-property) rather than the full palette
		size: {
			default: {},
			compact: {
				searchRow: "gap-2 px-3 py-2",
				searchInput: "text-xs",
				list: "max-h-64",
				empty: "py-4 text-xs",
				groupLabel: "px-3",
				item: "gap-2 px-3 py-1.5 text-xs",
				footer: "px-3 py-1.5",
			},
		},
	},
	defaultVariants: {
		size: "default",
	},
});

type CommandSize = "default" | "compact";

const CommandSizeContext = createContext<CommandSize>("default");

// Parts live in separate components, so the root's size reaches them via
// context instead of threading a prop through every call site.
function useCommandSlots() {
	return commandStyles({ size: useContext(CommandSizeContext) });
}

function CommandRoot({
	size = "default",
	className,
	...props
}: ComponentProps<typeof CommandPrimitive> & { size?: CommandSize }) {
	const slots = commandStyles({ size });
	return (
		<CommandSizeContext.Provider value={size}>
			<CommandPrimitive className={slots.root({ className })} {...props} />
		</CommandSizeContext.Provider>
	);
}

const CommandInput = forwardRef<
	HTMLInputElement,
	ComponentProps<typeof CommandPrimitive.Input>
>(function CommandInput({ className, ...props }, ref) {
	const slots = useCommandSlots();
	return (
		<div className={slots.searchRow()}>
			<Search className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
			<CommandPrimitive.Input
				ref={ref}
				className={slots.searchInput({ className })}
				{...props}
			/>
			<span className={slots.escBadge()}>ESC</span>
		</div>
	);
});

function CommandList({
	className,
	...props
}: ComponentProps<typeof CommandPrimitive.List>) {
	const slots = useCommandSlots();
	return (
		<CommandPrimitive.List className={slots.list({ className })} {...props} />
	);
}

function CommandEmpty({
	className,
	...props
}: ComponentProps<typeof CommandPrimitive.Empty>) {
	const slots = useCommandSlots();
	return (
		<CommandPrimitive.Empty className={slots.empty({ className })} {...props} />
	);
}

function CommandGroup({
	className,
	...props
}: ComponentProps<typeof CommandPrimitive.Group>) {
	const slots = useCommandSlots();
	return (
		<CommandPrimitive.Group className={slots.group({ className })} {...props} />
	);
}

function CommandGroupLabel({ className, ...props }: ComponentProps<"div">) {
	const slots = useCommandSlots();
	return <div className={slots.groupLabel({ className })} {...props} />;
}

function CommandItem({
	className,
	...props
}: ComponentProps<typeof CommandPrimitive.Item>) {
	const slots = useCommandSlots();
	return (
		<CommandPrimitive.Item className={slots.item({ className })} {...props} />
	);
}

function CommandSeparator({
	className,
	...props
}: ComponentProps<typeof CommandPrimitive.Separator>) {
	const slots = useCommandSlots();
	return (
		<CommandPrimitive.Separator
			className={slots.separator({ className })}
			{...props}
		/>
	);
}

function CommandKeyBadge({ className, ...props }: ComponentProps<"span">) {
	const slots = useCommandSlots();
	return <span className={slots.keyBadge({ className })} {...props} />;
}

function CommandFooter({ className, ...props }: ComponentProps<"div">) {
	const slots = useCommandSlots();
	return <div className={slots.footer({ className })} {...props} />;
}

function CommandFooterLeft({ className, ...props }: ComponentProps<"div">) {
	const slots = useCommandSlots();
	return <div className={slots.footerLeft({ className })} {...props} />;
}

function CommandFooterHint({ className, ...props }: ComponentProps<"div">) {
	const slots = useCommandSlots();
	return <div className={slots.footerHint({ className })} {...props} />;
}

function CommandFooterRight({ className, ...props }: ComponentProps<"div">) {
	const slots = useCommandSlots();
	return <div className={slots.footerRight({ className })} {...props} />;
}

export {
	CommandEmpty,
	CommandFooter,
	CommandFooterHint,
	CommandFooterLeft,
	CommandFooterRight,
	CommandGroup,
	CommandGroupLabel,
	CommandInput,
	CommandItem,
	CommandKeyBadge,
	CommandList,
	CommandRoot,
	CommandSeparator,
};
