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
		| "group-label"
		| "meta"
		| "value"
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

// The one mono label style (decision 1 of the UI audit). Copy renders as
// written: no case transforms.
const monoLabel = "font-mono text-[10px] tracking-normal";

const text = tv({
	variants: {
		variant: {
			title: "text-xl text-slate-900 font-medium",
			subtitle: "text-sm font-bold",
			label: "text-xs font-semibold",
			text: "text-sm font-normal",
			// House label style: mono, rendered exactly as written (sentence case).
			eyebrow: `${monoLabel} text-cyan-700`,
			// A section heading on the page background. Headings never dim.
			"section-header": "font-mono text-[11px] tracking-normal text-slate-900",
			// The label over a group of controls or rows (inspectors, menus).
			"group-label": `${monoLabel} font-medium text-slate-500`,
			// Secondary line under a name: body font, one size, the dim tone.
			meta: "text-xs text-slate-500",
			// Paths, ids, and other values: mono in the default ink.
			value: "font-mono text-xs text-slate-950",
			// @deprecated prefer group-label
			"section-divider": `${monoLabel} bg-slate-50 px-5 py-1.5 font-medium text-slate-500`,
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
