import type { LintComponentLocation } from "./rules/types";

/**
 * Text for a finding located on a component definition (its
 * `componentLocation`), shared by the CLI, the dashboard and the design
 * inspector. Pure, so the browser can use it.
 */

export type { LintComponentLocation } from "./rules/types";

/**
 * The template, slot default, variant value or compound variant the
 * classes belong to.
 */
export const describeComponentClassSource = (
	location: Pick<LintComponentLocation, "slot" | "axis" | "value" | "compound">,
) =>
	location.slot !== undefined
		? `slot ${location.slot} default`
		: location.compound !== undefined
			? `compound variant ${location.compound + 1}`
			: location.axis !== undefined
				? `variant ${location.axis}=${location.value ?? ""}`
				: "template";

/**
 * `button@1.2.0 › label › variant size=sm` or `tab@3 › label › slot
 * children default`, with the slug when known.
 */
export const describeComponentLocation = (
	location: LintComponentLocation,
	slug?: string,
) =>
	[
		`${slug ?? location.componentId}@${location.version}`,
		location.path,
		describeComponentClassSource(location),
	]
		.filter((part): part is string => Boolean(part))
		.join(" › ");
