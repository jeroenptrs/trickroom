import type { LintDesignIndex, LintNodeRender } from "../../designs";
import type { LintComponentLocation, LintLocation } from "../types";

/**
 * The class strings the design class rules (`design.unknown-class-token`,
 * `design.non-canonical-class`) check, each with where to report it:
 *
 * - every class string of the component definitions in the index, once per
 *   published version, located on the component (`componentLocation`, with
 *   `location: null`);
 * - every node of the linked designs with classes of its own: a layer's
 *   className, an instance node's className override, or, when its
 *   instance's version cannot be resolved, its stored className (see
 *   `LintDesignClassSource`). An instance does not repeat the classes it
 *   inherits from its component.
 */

export type LintClassTarget = {
	className: string;
	/** Where the finding is reported: a design node, or null for a component. */
	location: Extract<LintLocation, { kind: "design" }> | null;
	/** Where in a component definition, for its classes. */
	componentLocation?: LintComponentLocation;
	/** Component slug, for the classes of a component definition. */
	component?: string;
	/** Element id, for the classes of a design node. */
	element?: string;
	/** What renders next to these classes (see `LintClassTargetContext`). */
	context: LintClassTargetContext;
};

/**
 * The classes that may render next to a target's, for the cascade check of
 * `design.non-canonical-class`: a design node's render (`LintNodeRender`),
 * or, for a component definition, every class the component declares on
 * that template path (template, every variant value, every compound), as
 * if all could apply at once, with the registry base classes.
 */
export type LintClassTargetContext =
	| { kind: "node"; render: LintNodeRender }
	| {
			kind: "definition";
			/** The component's classes on the path, merged when the design's classes merge. */
			component: string;
			baseClassName: string | undefined;
	  };

/** The finding fields that locate a target. */
export const targetLocationFields = (target: LintClassTarget) => ({
	location: target.location,
	...(target.componentLocation
		? { componentLocation: target.componentLocation }
		: {}),
	...(target.component ? { component: target.component } : {}),
});

export const collectLintClassTargets = (
	designs: LintDesignIndex,
): LintClassTarget[] => {
	const targets: LintClassTarget[] = [];
	for (const definition of designs.components) {
		const byPath = new Map<string, string[]>();
		for (const entry of definition.classes) {
			byPath.set(entry.path, [
				...(byPath.get(entry.path) ?? []),
				entry.className,
			]);
		}
		for (const entry of definition.classes) {
			targets.push({
				context: {
					kind: "definition",
					component: (byPath.get(entry.path) ?? []).join(" "),
					baseClassName: definition.baseClassNames[entry.path],
				},
				className: entry.className,
				component: definition.slug,
				location: null,
				componentLocation: {
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
					context: { kind: "node", render: node.render },
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
