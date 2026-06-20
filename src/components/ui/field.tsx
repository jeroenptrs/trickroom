import { Field as FieldPrimitive } from "@base-ui/react/field";
import type { ReactNode } from "react";

/**
 * Composable field wrapper mirroring the Trickroom `field` system component:
 * Field.Root › Field.Label + {control} + Field.Description. The control is
 * passed as children (e.g. `FieldControl`, `Input`, or any Base UI control),
 * matching the design-side `control` slot.
 */
function Field({
	label,
	description,
	className,
	children,
}: {
	label: string;
	description?: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<FieldPrimitive.Root
			data-slot="field-root"
			className={["flex flex-col gap-1 text-xs", className]
				.filter(Boolean)
				.join(" ")}
		>
			<FieldPrimitive.Label data-slot="field-label" className="font-semibold">
				{label}
			</FieldPrimitive.Label>
			{children}
			{description ? (
				<FieldPrimitive.Description className="pt-0.5 text-slate-900/60">
					{description}
				</FieldPrimitive.Description>
			) : null}
		</FieldPrimitive.Root>
	);
}

export { Field, FieldPrimitive };
