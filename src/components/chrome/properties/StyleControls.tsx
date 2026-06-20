import { useEffect, useRef, useState } from "react";
import { Input } from "../../ui/input";

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
