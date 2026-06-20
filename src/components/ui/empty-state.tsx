import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { tv } from "tailwind-variants";
import { Text } from "./text";

const emptyState = tv({
	slots: {
		root: "flex flex-col items-center text-center",
		tile: "flex shrink-0 items-center justify-center bg-slate-100 inset-shadow-[0_0_0_1px] inset-shadow-slate-200",
		icon: "size-5 text-slate-400",
		title: "",
		description: "text-balance",
	},
	variants: {
		size: {
			sm: {
				root: "gap-3 px-4 py-10",
				tile: "size-10",
				title: "text-sm",
				description: "max-w-[16rem] text-xs",
			},
			md: {
				root: "h-full justify-center gap-5 p-8",
				tile: "size-12",
				description: "max-w-sm text-sm",
			},
		},
	},
	defaultVariants: {
		size: "md",
	},
});

/**
 * Centered icon tile + title + description for empty/welcome panes.
 * `size="sm"` fits sidebar lists; `size="md"` fills a detail pane.
 * Extra rows (kbd hints, paths) render below as children.
 */
function EmptyState({
	icon: Icon,
	title,
	description,
	size,
	className,
	children,
}: {
	icon: LucideIcon;
	title: string;
	description: string;
	size?: "sm" | "md";
	className?: string;
	children?: ReactNode;
}) {
	const styles = emptyState({ size });

	return (
		<div className={styles.root({ className })}>
			<div className={styles.tile()}>
				<Icon className={styles.icon()} aria-hidden="true" />
			</div>
			<div className="flex flex-col gap-1.5">
				<Text variant="title" className={styles.title()}>
					{title}
				</Text>
				<Text tone="faint" className={styles.description()}>
					{description}
				</Text>
			</div>
			{children}
		</div>
	);
}

export { EmptyState };
