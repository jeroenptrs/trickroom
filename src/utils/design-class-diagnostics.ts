import {
	type ClassTokenCheckContext,
	type ClassTokenIssue,
	collectClassNameTokenIssues,
} from "./class-token-diagnostics";

/**
 * The design side of the class checks: the per-class checks of
 * `class-token-diagnostics.ts`, located on a design element. The MCP design
 * diagnostics (`getDesignDiagnostics`) and the `design.unknown-class-token`
 * lint rule both walk a design's elements through this, so an agent and the
 * lint report see the same warnings.
 */

export type DesignClassDiagnostic = ClassTokenIssue & {
	/** `<element path>.props.className`. */
	path: string;
	elementId: string;
	className: string;
};

/** Where a className lives: its element and the path of the element. */
export type DesignClassTarget = { path: string; elementId: string };

/**
 * Checks one element's `className` and appends its diagnostics to `issues`.
 * Build it once per system and reuse it for every element.
 */
export type DesignClassChecker = (
	className: string,
	target: DesignClassTarget,
	issues: DesignClassDiagnostic[],
) => void;

export const createDesignClassChecker =
	(context: ClassTokenCheckContext): DesignClassChecker =>
	(className, target, issues) => {
		if (!className.trim()) return;
		for (const issue of collectClassNameTokenIssues(className, context)) {
			issues.push({
				...issue,
				path: target.path,
				elementId: target.elementId,
				className,
			});
		}
	};
