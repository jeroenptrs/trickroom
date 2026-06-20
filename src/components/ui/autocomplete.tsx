import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

const autocomplete = tv({
	slots: {
		input:
			"w-full rounded-none border-none bg-white px-2 py-1.5 text-sm text-slate-950 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 placeholder:text-slate-500 focus-visible:inset-shadow-cyan-500 focus-visible:outline-none disabled:opacity-50",
		positioner: "z-50 outline-none",
		popup:
			"max-h-60 min-w-[var(--anchor-width)] max-w-[min(20rem,var(--available-width))] overflow-y-auto border border-slate-200 bg-white py-1 text-slate-950 shadow-lg outline-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
		list: "flex flex-col",
		item: "flex cursor-pointer select-none items-center px-2.5 py-1.5 font-mono text-xs text-slate-700 outline-none data-[highlighted]:bg-cyan-50 data-[highlighted]:text-cyan-900",
		empty: "px-2.5 py-2 text-xs text-slate-500",
	},
});

const slots = autocomplete();

const AutocompleteRoot = AutocompletePrimitive.Root;
const AutocompletePortal = AutocompletePrimitive.Portal;

function AutocompleteInput({
	className,
	...props
}: ComponentProps<typeof AutocompletePrimitive.Input>) {
	return (
		<AutocompletePrimitive.Input
			className={slots.input({ className })}
			{...props}
		/>
	);
}

function AutocompletePositioner({
	className,
	sideOffset = 4,
	...props
}: ComponentProps<typeof AutocompletePrimitive.Positioner>) {
	return (
		<AutocompletePrimitive.Positioner
			className={slots.positioner({ className })}
			sideOffset={sideOffset}
			{...props}
		/>
	);
}

function AutocompletePopup({
	className,
	...props
}: ComponentProps<typeof AutocompletePrimitive.Popup>) {
	return (
		<AutocompletePrimitive.Popup
			className={slots.popup({ className })}
			{...props}
		/>
	);
}

function AutocompleteList({
	className,
	...props
}: ComponentProps<typeof AutocompletePrimitive.List>) {
	return (
		<AutocompletePrimitive.List
			className={slots.list({ className })}
			{...props}
		/>
	);
}

function AutocompleteItem({
	className,
	...props
}: ComponentProps<typeof AutocompletePrimitive.Item>) {
	return (
		<AutocompletePrimitive.Item
			className={slots.item({ className })}
			{...props}
		/>
	);
}

function AutocompleteEmpty({
	className,
	...props
}: ComponentProps<typeof AutocompletePrimitive.Empty>) {
	return (
		<AutocompletePrimitive.Empty
			className={slots.empty({ className })}
			{...props}
		/>
	);
}

export {
	AutocompleteEmpty,
	AutocompleteInput,
	AutocompleteItem,
	AutocompleteList,
	AutocompletePopup,
	AutocompletePortal,
	AutocompletePositioner,
	AutocompleteRoot,
};
