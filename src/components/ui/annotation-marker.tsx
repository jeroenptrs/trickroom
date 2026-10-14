import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";
import type { AnnotationMarkerLook } from "../../utils/annotation-presentation";

// Annotation state as a small square, for the Layers rail, the inspector's
// thread headers and its status chips. The stage pins draw the same looks
// with inline styles (`stage-annotation-pins.ts`), since the stage document
// does not load the app's stylesheet. Square, slate and cyan:
// open is filled cyan, addressed hollow cyan, needs input slate with a cyan
// border, detached dashed slate, a draft dashed cyan, closed slate at 40%,
// resolved by an agent (not yet accepted) a hollow check.

const annotationMarker = tv({
	base: "inline-flex shrink-0 items-center justify-center rounded-none font-mono leading-none font-semibold",
	variants: {
		look: {
			filled: "bg-cyan-400 text-slate-950",
			hollow: "border-2 border-cyan-400 bg-slate-50 text-cyan-700",
			question: "border-2 border-cyan-400 bg-slate-950 text-cyan-300",
			detached:
				"border-2 border-dashed border-slate-400 bg-slate-50 text-slate-600",
			draft: "border-2 border-dashed border-cyan-400 bg-slate-50 text-cyan-700",
			muted: "bg-slate-950/40 text-slate-50",
			// Resolved by an agent, waiting for the designer to accept: a hollow check.
			check: "border-2 border-cyan-400 bg-slate-50 text-cyan-700",
		},
		size: {
			// A bare square (no count), as in a thread header.
			dot: "size-2.5 border-1",
			count: "h-4 min-w-4 px-0.5 text-xs",
		},
	},
	compoundVariants: [
		{ size: "dot", look: "filled", class: "border-0" },
		{ size: "dot", look: "muted", class: "border-0" },
	],
	defaultVariants: { look: "filled", size: "count" },
});

function AnnotationMarker({
	look,
	size,
	count,
	className,
	...props
}: Omit<ComponentProps<"span">, "children"> & {
	look?: AnnotationMarkerLook;
	size?: "dot" | "count";
	/** Shown inside the square when more than one. */
	count?: number;
}) {
	return (
		<span
			data-slot="annotation-marker"
			data-look={look}
			className={annotationMarker({ look, size, className })}
			{...props}
		>
			{look === "check" ? (
				<Check aria-hidden="true" className="size-3" strokeWidth={3} />
			) : count !== undefined && count > 1 ? (
				count
			) : null}
		</span>
	);
}

const annotationStatusChip = tv({
	base: "inline-flex shrink-0 items-center gap-1.5 font-mono text-xs uppercase tracking-wider",
	variants: {
		tone: {
			active: "text-slate-700",
			closed: "text-slate-500",
		},
	},
	defaultVariants: { tone: "active" },
});

/** A state's square and its name, e.g. in a thread header. */
function AnnotationStatusChip({
	look,
	label,
	closed,
	className,
	...props
}: Omit<ComponentProps<"span">, "children"> & {
	look: AnnotationMarkerLook;
	label: string;
	closed?: boolean;
}) {
	return (
		<span
			data-slot="annotation-status-chip"
			className={annotationStatusChip({
				tone: closed ? "closed" : "active",
				className,
			})}
			{...props}
		>
			<AnnotationMarker
				look={look}
				size={look === "check" ? "count" : "dot"}
				aria-hidden="true"
			/>
			{label}
		</span>
	);
}

export { AnnotationMarker, AnnotationStatusChip };
