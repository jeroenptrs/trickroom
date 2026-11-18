import { Field as FieldPrimitive } from "@base-ui/react/field";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Composable field wrapper mirroring the Trickroom `field` system component:
 * Field.Root › Field.Label + {control} + Field.Description + Field.Error. The
 * control is passed as children (e.g. `FieldControl`, `Input`, or any Base UI
 * control), matching the design-side `control` slot.
 *
 * Pass `error` after the field blurs (validate on blur, not per keystroke).
 * The field is then marked invalid, the control gets `aria-invalid`, and the
 * message is linked to the control for screen readers.
 */
function Field({
	label,
	description,
	error,
	className,
	children,
}: {
	label: string;
	description?: string;
	error?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	const hasError = error !== null && error !== undefined && error !== "";
	return (
		<FieldPrimitive.Root
			data-slot="field-root"
			invalid={hasError}
			className={["flex flex-col gap-1 text-xs", className]
				.filter(Boolean)
				.join(" ")}
		>
			<FieldPrimitive.Label data-slot="field-label" className="font-semibold">
				{label}
			</FieldPrimitive.Label>
			{children}
			{description ? (
				<FieldPrimitive.Description className="pt-0.5 text-slate-500">
					{description}
				</FieldPrimitive.Description>
			) : null}
			{hasError ? (
				<FieldPrimitive.Error
					match
					data-slot="field-error"
					className="flex items-center gap-1.5 pt-0.5 text-xs text-red-900"
				>
					<TriangleAlert
						className="size-3 shrink-0 text-red-700"
						aria-hidden="true"
					/>
					<span>{error}</span>
				</FieldPrimitive.Error>
			) : null}
		</FieldPrimitive.Root>
	);
}

export { Field, FieldPrimitive };
