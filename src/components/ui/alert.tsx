import { Info, type LucideIcon, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

type AlertTone = "danger" | "warning" | "info";

const alert = tv({
	slots: {
		root: "flex text-[11px]",
		icon: "shrink-0",
	},
	variants: {
		variant: {
			// Boxed danger panel — stamped 1px border + wash, for form/submit errors.
			panel:
				"items-start gap-2 rounded-none px-2.5 py-2 leading-relaxed inset-shadow-[0_0_0_1px]",
			// No box — icon + text, for inline / field-level validation.
			inline: "items-center gap-1.5",
		},
		tone: {
			danger: { root: "text-red-900", icon: "text-red-700" },
			warning: { root: "text-amber-900", icon: "text-amber-700" },
			info: { root: "text-cyan-900", icon: "text-cyan-700" },
		},
	},
	compoundVariants: [
		{
			variant: "panel",
			tone: "danger",
			class: { root: "bg-red-50 inset-shadow-red-300" },
		},
		{
			variant: "panel",
			tone: "warning",
			class: { root: "bg-amber-50 inset-shadow-amber-300" },
		},
		{
			variant: "panel",
			tone: "info",
			class: { root: "bg-cyan-50 inset-shadow-cyan-300" },
		},
	],
	defaultVariants: {
		variant: "panel",
		tone: "danger",
	},
});

const toneIcon: Record<AlertTone, LucideIcon> = {
	danger: TriangleAlert,
	warning: TriangleAlert,
	info: Info,
};

function Alert({
	variant,
	tone = "danger",
	icon,
	className,
	children,
}: {
	variant?: "panel" | "inline";
	tone?: AlertTone;
	/** Override the per-tone icon, or pass null to hide it. */
	icon?: LucideIcon | null;
	className?: string;
	children: ReactNode;
}) {
	const styles = alert({ variant, tone });
	const Icon = icon === null ? null : (icon ?? toneIcon[tone]);
	return (
		<div role="alert" className={styles.root({ className })}>
			{Icon ? <Icon className={styles.icon()} aria-hidden="true" /> : null}
			<span>{children}</span>
		</div>
	);
}

export { Alert };
