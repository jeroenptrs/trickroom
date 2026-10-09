import type { LintLocation } from "./rules/types";

/**
 * Text for a finding located on a component definition, shared by the CLI,
 * the dashboard and the design inspector. Pure, so the browser can use it.
 */

export type LintComponentLocation = Extract<
	LintLocation,
	{ kind: "component" }
>;

/** The template, variant value or compound variant the classes belong to. */
export const describeComponentClassSource = (
	location: Pick<LintComponentLocation, "axis" | "value" | "compound">,
) =>
	location.compound !== undefined
		? `compound variant ${location.compound + 1}`
		: location.axis !== undefined
			? `variant ${location.axis}=${location.value ?? ""}`
			: "template";

/** `button@1.2.0 › label › variant size=sm`, with the slug when known. */
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
