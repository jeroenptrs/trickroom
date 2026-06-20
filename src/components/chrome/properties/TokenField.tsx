import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
	arbitraryTokenCandidate,
	filterTokenOptions,
	findTokenOption,
	isArbitraryTokenValue,
	stepToken,
	type TokenFieldOption,
} from "./tokenFieldController";

type TokenFieldProps = {
	label: string;
	value: string;
	placeholder?: string;
	options: readonly TokenFieldOption[];
	/** Mini box-model cell (right-rail P4): no label span, fixed width,
	 * centered text, resolved value only in the dropdown. `label` still names
	 * the field for assistive tech. */
	compact?: boolean;
	onCommit: (next: string) => void;
};

/**
 * Token-first value field (right-rail P2): an Autocomplete over the
 * property's token scale with a resolved-value column and an explicit
 * out-of-system `[…]` candidate ranked last, so the in-system path is the
 * path of least resistance. While the list is closed, ↑↓ step along the
 * numeric scale and commit immediately — like dragging in Figma, except it
 * can only land on tokens. Commit semantics otherwise match `ValueField`:
 * edits are staged locally and committed on blur, Enter, or item selection,
 * so the className is not rewritten on every keystroke.
 */
export function TokenField({
	label,
	value,
	placeholder,
	options,
	compact = false,
	onCommit,
}: TokenFieldProps) {
	const [draft, setDraft] = useState(value);
	const [open, setOpen] = useState(false);
	const isFocused = useRef(false);

	// Only resync from the prop while idle, so an external className change
	// (e.g. undo, or another control) does not wipe an in-progress edit.
	useEffect(() => {
		if (!isFocused.current) {
			setDraft(value);
		}
	}, [value]);

	const items = useMemo(() => {
		const filtered = filterTokenOptions(options, draft);
		const candidate = arbitraryTokenCandidate(draft);
		return candidate ? [...filtered, candidate] : filtered;
	}, [options, draft]);

	const hasScaleItems = items.some((item) => !item.arbitrary);

	function commit(next: string) {
		if (next !== value) {
			onCommit(next);
		}
	}

	const current = findTokenOption(options, draft);
	const isArbitrary = !current && isArbitraryTokenValue(draft);

	return (
		<div
			className={
				compact
					? "flex items-center text-[11px]"
					: "flex min-w-0 flex-1 items-center text-[11px]"
			}
		>
			<AutocompleteRoot
				items={items}
				value={draft}
				onValueChange={(next, details) => {
					// Base UI clears the input on Escape while the list is
					// closed; revert to the committed value instead.
					if (details.reason === "escape-key") {
						setDraft(value);
						return;
					}
					setDraft(next);
					if (details.reason === "item-press") {
						commit(next);
					}
				}}
				open={open}
				onOpenChange={(nextOpen, details) => {
					// Arrow keys step the scale (handled below) instead of
					// opening the list; typing and clicking still open it.
					if (nextOpen && details.reason === "list-navigation") return;
					setOpen(nextOpen);
				}}
				openOnInputClick
				filter={null}
				itemToStringValue={(option: TokenFieldOption) => option.value}
			>
				<div
					className={
						compact
							? "flex h-6 w-12 shrink-0 items-center bg-white px-1 inset-shadow-[0_0_0_1px] inset-shadow-transparent focus-within:inset-shadow-cyan-200"
							: "flex h-6 min-w-0 flex-1 items-center gap-1.5 bg-slate-200/60 px-1.5 inset-shadow-[0_0_0_1px] inset-shadow-transparent focus-within:inset-shadow-cyan-200"
					}
				>
					{/* Label lives inside the field (board 02: "W full", "Gap 2 · 8px"),
					    so paired half-width fields stay readable. */}
					{compact ? null : (
						<span className="shrink-0 text-slate-400">{label}</span>
					)}
					<AutocompleteInput
						aria-label={label}
						placeholder={placeholder}
						className={
							compact
								? // No room for the out-of-system tag; the amber text carries it.
									`h-full min-w-0 flex-1 bg-transparent p-0 text-center text-xs inset-shadow-none focus-visible:inset-shadow-none ${isArbitrary ? "text-amber-700" : ""}`
								: "h-full min-w-0 flex-1 bg-transparent p-0 text-xs inset-shadow-none focus-visible:inset-shadow-none"
						}
						onFocus={() => {
							isFocused.current = true;
						}}
						onBlur={() => {
							isFocused.current = false;
							commit(draft);
						}}
						onKeyDown={(event) => {
							if (
								!open &&
								(event.key === "ArrowUp" || event.key === "ArrowDown")
							) {
								const next = stepToken(
									options,
									draft,
									event.key === "ArrowUp" ? 1 : -1,
								);
								if (next !== null) {
									event.preventDefault();
									setDraft(next);
									commit(next);
								}
								return;
							}
							if (event.key === "Enter" && !open) {
								event.currentTarget.blur();
							}
						}}
					/>
					{compact ? null : current?.resolved ? (
						<span className="shrink-0 text-[10px] text-slate-400">
							{current.resolved}
						</span>
					) : isArbitrary ? (
						<span className="shrink-0 text-[10px] text-amber-600">
							out of system
						</span>
					) : null}
					{compact ? null : (
						// Dropdown affordance only; clicking the input opens the list.
						<ChevronDown
							aria-hidden="true"
							className="pointer-events-none size-3 shrink-0 text-slate-300"
						/>
					)}
				</div>
				<AutocompletePortal>
					<AutocompletePositioner>
						<AutocompletePopup>
							<AutocompleteEmpty>No matching tokens</AutocompleteEmpty>
							<AutocompleteList>
								{(option: TokenFieldOption) => (
									<AutocompleteItem
										key={option.value}
										value={option}
										className={
											option.arbitrary && hasScaleItems
												? "justify-between gap-3 border-t border-slate-100 px-2 py-1"
												: "justify-between gap-3 px-2 py-1"
										}
									>
										<span className="truncate">{option.value}</span>
										{option.arbitrary ? (
											<span className="shrink-0 font-sans text-[10px] text-amber-600">
												out of system
											</span>
										) : option.resolved ? (
											<span className="shrink-0 text-slate-400">
												{option.resolved}
											</span>
										) : null}
									</AutocompleteItem>
								)}
							</AutocompleteList>
						</AutocompletePopup>
					</AutocompletePositioner>
				</AutocompletePortal>
			</AutocompleteRoot>
		</div>
	);
}
