import { useMemo, useState } from "react";
import {
	KNOWN_FUNCTIONAL_ROOTS,
	KNOWN_STATIC_CLASS_NAMES,
} from "../../../utils/tailwind-classname/style";
import {
	AutocompleteEmpty,
	AutocompleteInput,
	AutocompleteItem,
	AutocompleteList,
	AutocompletePopup,
	AutocompletePortal,
	AutocompletePositioner,
	AutocompleteRoot,
} from "../../ui/autocomplete";
import {
	type ClassComboboxOption,
	filterComboboxOptions,
} from "./classComboboxController";

/**
 * Add-one-class combobox for the Classes tab (right-rail P5). Filters over
 * all known static Tailwind classes and functional prefix roots; understands
 * scope prefixes so "hover:ring" completes to "hover:ring-2" etc.
 *
 * Call onAppend with the selected/entered class; the parent is responsible
 * for appending it to the element's className string.
 */
export function ClassCombobox({
	onAppend,
}: {
	onAppend: (cls: string) => void;
}) {
	const [draft, setDraft] = useState("");
	const [open, setOpen] = useState(false);

	const items = useMemo(
		() =>
			draft.length > 0
				? filterComboboxOptions(
						draft,
						KNOWN_STATIC_CLASS_NAMES,
						KNOWN_FUNCTIONAL_ROOTS,
					)
				: [],
		[draft],
	);

	function commit(value: string) {
		const cls = value.trim();
		if (cls) {
			onAppend(cls);
		}
		setDraft("");
		setOpen(false);
	}

	return (
		<AutocompleteRoot
			items={items}
			value={draft}
			onValueChange={(next, details) => {
				if (details.reason === "escape-key") {
					setDraft("");
					return;
				}
				setDraft(next);
				if (details.reason === "item-press") {
					// Functional root ends with "-": let the user keep typing.
					if (!next.endsWith("-")) {
						commit(next);
					}
				}
			}}
			open={open}
			onOpenChange={(nextOpen, details) => {
				if (nextOpen && details.reason === "list-navigation") return;
				setOpen(nextOpen);
			}}
			openOnInputClick
			filter={null}
			itemToStringValue={(option: ClassComboboxOption) => option.value}
		>
			<div className="flex h-7 items-center gap-1 bg-white px-2 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-within:inset-shadow-cyan-500">
				<AutocompleteInput
					aria-label="Add Tailwind class"
					placeholder="Add class…"
					className="h-full min-w-0 flex-1 bg-transparent p-0 font-mono text-xs inset-shadow-none placeholder:font-sans placeholder:text-slate-400 focus-visible:inset-shadow-none"
					onKeyDown={(event) => {
						if (event.key === "Enter" && !open) {
							event.preventDefault();
							commit(draft);
						}
					}}
					onBlur={() => {
						// Don't commit on blur — user may have clicked into another field.
						// Just leave the draft; next open will re-show suggestions.
					}}
				/>
			</div>
			<AutocompletePortal>
				<AutocompletePositioner>
					<AutocompletePopup className="font-mono">
						<AutocompleteEmpty>No matching classes</AutocompleteEmpty>
						<AutocompleteList>
							{(option: ClassComboboxOption) => (
								<AutocompleteItem
									key={option.value}
									value={option}
									className="px-2 py-1"
								>
									{option.value}
								</AutocompleteItem>
							)}
						</AutocompleteList>
					</AutocompletePopup>
				</AutocompletePositioner>
			</AutocompletePortal>
		</AutocompleteRoot>
	);
}
