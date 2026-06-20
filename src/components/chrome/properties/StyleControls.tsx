import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";

export type SegmentedOption<T extends string> = {
	value: T;
	label: ReactNode;
	/** Tooltip / accessible text when `label` is an icon. */
	title?: string;
};

type SegmentedProps<T extends string> = {
	options: readonly SegmentedOption<T>[];
	/** Currently active value, or null when the property is unset. */
	value: T | null;
	/** Called with the next value, or null when the active option is toggled off. */
	onChange: (next: T | null) => void;
	ariaLabel: string;
};

/**
 * Segmented toggle group rendered with the block-variant Button. The selected
 * cell uses the block `isSelected` styling (cyan-100 / cyan-900) — the same
 * affordance the right-rail exploration mocked by hand. Re-clicking the active
 * option clears the property.
 */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
	ariaLabel,
}: SegmentedProps<T>) {
	return (
		<div className="flex gap-px" role="group" aria-label={ariaLabel}>
			{options.map((option) => {
				const isSelected = value === option.value;
				return (
					<Button
						key={option.value}
						type="button"
						variant="block"
						isSelected={isSelected}
						title={option.title}
						className="flex-1 justify-center px-2 py-1 text-[11px]"
						onClick={() => onChange(isSelected ? null : option.value)}
					>
						{option.label}
					</Button>
				);
			})}
		</div>
	);
}

type ValueFieldProps = {
	label: string;
	value: string;
	placeholder?: string;
	onCommit: (next: string) => void;
};

/**
 * Labeled inline text field for scale / arbitrary / custom-property values.
 * Edits are staged locally and committed on blur or Enter, so the className
 * is not rewritten (and reparsed) on every keystroke.
 */
export function ValueField({
	label,
	value,
	placeholder,
	onCommit,
}: ValueFieldProps) {
	const [draft, setDraft] = useState(value);
	const isFocused = useRef(false);

	// Only resync from the prop while idle, so an external className change
	// (e.g. undo, or another control) does not wipe an in-progress edit.
	useEffect(() => {
		if (!isFocused.current) {
			setDraft(value);
		}
	}, [value]);

	function commit() {
		if (draft !== value) {
			onCommit(draft);
		}
	}

	return (
		<label className="flex min-w-0 items-center gap-2 text-[11px]">
			<span className="w-16 shrink-0 text-slate-400">{label}</span>
			<Input
				type="text"
				variant="block"
				className="h-6 min-w-0 flex-1"
				aria-label={label}
				value={draft}
				placeholder={placeholder}
				onChange={(event) => setDraft(event.currentTarget.value)}
				onFocus={() => {
					isFocused.current = true;
				}}
				onBlur={() => {
					isFocused.current = false;
					commit();
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.currentTarget.blur();
					}
				}}
			/>
		</label>
	);
}
