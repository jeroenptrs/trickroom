import { Check, Copy } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { writeClipboardText } from "../../utils/clipboard";
import { Button } from "./button";

/**
 * A copy-to-clipboard button with self-managed "copied" feedback (selected
 * state + check icon for 1.5s). Icon-only by default; pass `labels` for a
 * visible label pair. `subject` feeds the aria-label ("Copy design ID").
 */
function CopyButton({
	value,
	subject = "to clipboard",
	labels,
	variant = "block",
	iconClassName = "size-3.5",
	className,
	...props
}: Omit<ComponentProps<typeof Button>, "variant" | "onClick" | "children"> & {
	value: string;
	subject?: string;
	labels?: { idle: string; copied: string };
	variant?: ComponentProps<typeof Button>["variant"];
	iconClassName?: string;
}) {
	const [copied, setCopied] = useState(false);
	const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (resetTimeoutRef.current) {
				clearTimeout(resetTimeoutRef.current);
			}
		};
	}, []);

	const handleCopy = () => {
		void writeClipboardText(value)
			.then(() => {
				setCopied(true);
				if (resetTimeoutRef.current) {
					clearTimeout(resetTimeoutRef.current);
				}
				resetTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
			})
			.catch(() => {
				setCopied(false);
			});
	};

	const Icon = copied ? Check : Copy;

	return (
		<Button
			type="button"
			variant={variant}
			isSelected={copied}
			className={["flex shrink-0 items-center gap-1.5", className]
				.filter(Boolean)
				.join(" ")}
			aria-label={copied ? `Copied ${subject}` : `Copy ${subject}`}
			onClick={handleCopy}
			{...props}
		>
			<Icon className={`shrink-0 ${iconClassName}`} aria-hidden="true" />
			{labels ? (copied ? labels.copied : labels.idle) : null}
		</Button>
	);
}

export { CopyButton };
