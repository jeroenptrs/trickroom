import type { LintDesignIndex } from "../../designs";
import type { LintLocation } from "../types";

/**
 * The class strings the design class rules (`design.unknown-class-token`,
 * `design.non-canonical-class`) check, each with where to report it:
 *
 * - every class string of the component definitions in the index, once per
 *   published version, located on the component;
 * - every node of the linked designs with classes of its own: a layer's
 *   className, an instance node's className override, or, when its
 *   instance's version cannot be resolved, its stored className (see
 *   `LintDesignClassSource`). An instance does not repeat the classes it
 *   inherits from its component.
 */

export type LintClassTarget = {
	className: string;
	location: Extract<LintLocation, { kind: "design" | "component" }>;
	/** Component slug, for the classes of a component definition. */
	component?: string;
	/** Element id, for the classes of a design node. */
	element?: string;
};

export const collectLintClassTargets = (
	designs: LintDesignIndex,
): LintClassTarget[] => {
	const targets: LintClassTarget[] = [];
	for (const definition of designs.components) {
		for (const entry of definition.classes) {
			targets.push({
				className: entry.className,
				component: definition.slug,
				location: {
					kind: "component",
					componentId: definition.componentId,
					version: definition.version,
					path: entry.path,
					...(entry.axis === null ? {} : { axis: entry.axis }),
					...(entry.value === null ? {} : { value: entry.value }),
					...(entry.compound === null ? {} : { compound: entry.compound }),
				},
			});
		}
	}
	for (const design of designs.designs) {
		for (const board of design.boards) {
			for (const node of board.nodes) {
				if (node.checkedClassName === null) continue;
				targets.push({
					className: node.checkedClassName,
					element: node.element,
					location: {
						kind: "design",
						design: design.id,
						board: board.id,
						element: node.element,
						path: `${node.path}.props.className`,
					},
				});
			}
		}
	}
	return targets;
};

/** Where a class rule has something to check, for its "no CSS" note. */
export const hasLintClassScope = (designs: LintDesignIndex) =>
	designs.designs.length > 0 || designs.components.length > 0;
