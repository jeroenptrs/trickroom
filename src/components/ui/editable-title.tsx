import { useEffect, useRef, useState } from "react";
import { tv } from "tailwind-variants";

const editableTitle = tv({
	slots: {
		display:
			"min-w-0 truncate border-none bg-transparent text-left hover:bg-slate-100 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500 disabled:pointer-events-none disabled:opacity-60",
		input:
			"w-full min-w-0 border-none bg-transparent outline-none focus-visible:outline-none",
	},
	variants: {
		size: {
			lg: {
				display: "p-0 text-xl font-medium text-slate-900",
				input: "p-0 text-xl font-medium text-slate-900",
			},
			md: {
				display: "px-2 py-1 text-base font-medium text-slate-950",
				input: "px-2 py-1 text-base font-medium text-slate-950",
			},
		},
	},
	defaultVariants: {
		size: "lg",
	},
});

/**
 * Click-to-rename title: renders as a button, swaps to an inline input on
 * click. Enter or blur confirms (only when changed and non-empty), Escape
 * cancels. Rename side effects stay with the caller via `onRename`.
 */
function EditableTitle({
	value,
	onRename,
	disabled,
	size,
	className,
	"aria-label": ariaLabel,
}: {
	value: string;
	onRename: (nextValue: string) => void;
	disabled?: boolean;
	size?: "lg" | "md";
	className?: string;
	"aria-label": string;
}) {
	const styles = editableTitle({ size });
	const [isEditing, setIsEditing] = useState(false);
	const [draft, setDraft] = useState(value);
	const inputRef = useRef<HTMLInputElement>(null);
	const cancelledRef = useRef(false);

	useEffect(() => {
		if (!isEditing) {
			return;
		}

		inputRef.current?.focus();
		inputRef.current?.select();
	}, [isEditing]);

	const startEditing = () => {
		if (disabled) {
			return;
		}

		cancelledRef.current = false;
		setDraft(value);
		setIsEditing(true);
	};

	const confirm = () => {
		setIsEditing(false);
		const nextValue = draft.trim();
		if (nextValue.length === 0 || nextValue === value) {
			return;
		}
		onRename(nextValue);
	};

	const cancel = () => {
		cancelledRef.current = true;
		setIsEditing(false);
	};

	if (isEditing) {
		return (
			<input
				ref={inputRef}
				className={styles.input({ className })}
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={() => {
					if (!cancelledRef.current) confirm();
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") confirm();
					if (event.key === "Escape") cancel();
				}}
				aria-label={ariaLabel}
			/>
		);
	}

	return (
		<button
			type="button"
			className={styles.display({ className })}
			onClick={startEditing}
			disabled={disabled}
		>
			{value}
		</button>
	);
}

export { EditableTitle };
