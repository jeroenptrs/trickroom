import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { tv } from "tailwind-variants";

interface TextProps extends useRender.ComponentProps<"span"> {
	variant?:
		| "title"
		| "subtitle"
		| "label"
		| "eyebrow"
		| "section-header"
		| "section-divider";
	/**
	 * Typographic color ramp (WCAG-aware). Applied after `variant`, so it
	 * overrides any color baked into the variant. Leave unset to keep the
	 * variant's default color.
	 * - foreground: primary text (slate-950, ~19:1)
	 * - muted: labels/paths/helpers/secondary (slate-600, ~7.4:1)
	 * - faint: section headers/meta/quietest readable (slate-500, ~4.9:1)
	 * - accent: kickers/links (cyan-700)
	 * - danger: errors (red-900)
	 * - inverse: text on dark surfaces (slate-50)
	 * - inverse-muted: muted text on dark surfaces only (slate-400)
	 */
	tone?:
		| "foreground"
		| "muted"
		| "faint"
		| "accent"
		| "danger"
		| "inverse"
		| "inverse-muted";
}

const text = tv({
	variants: {
		variant: {
			title: "text-xl text-slate-900 font-medium",
			subtitle: "text-sm font-bold",
			label: "text-xs font-semibold",
			text: "text-sm font-normal",
			eyebrow: "font-mono text-[10px] lowercase tracking-normal text-cyan-700",
			"section-header":
				"font-mono text-[11px] lowercase tracking-normal text-slate-500",
			// @deprecated prefer section-header
			"section-divider":
				"bg-slate-50 px-5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500",
		},
		tone: {
			foreground: "text-slate-950",
			muted: "text-slate-600",
			faint: "text-slate-500",
			accent: "text-cyan-700",
			danger: "text-red-900",
			inverse: "text-slate-50",
			"inverse-muted": "text-slate-400",
		},
	},
	defaultVariants: {
		variant: "text",
	},
});

function Text({ className, variant, tone, ...props }: TextProps) {
	const { render, ...otherProps } = props;

	const element = useRender({
		defaultTagName: "span",
		render,
		props: mergeProps<"span">(
			{ className: text({ className, variant, tone }) },
			otherProps,
		),
	});

	return element;
}

export { Text, type TextProps };
