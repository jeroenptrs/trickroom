import type { LintRuleKind } from "./types";

export type LintRuleRegistry = {
	kinds: readonly LintRuleKind[];
	ids: ReadonlySet<string>;
	get: (id: string) => LintRuleKind | null;
};

const RULE_ID_PATTERN = /^(code|design)\.[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** A registry over the given kinds; ids must be unique and well-formed. */
export const createLintRuleRegistry = (
	kinds: readonly LintRuleKind[],
): LintRuleRegistry => {
	const byId = new Map<string, LintRuleKind>();
	for (const kind of kinds) {
		if (!RULE_ID_PATTERN.test(kind.id)) {
			throw new Error(
				`Lint rule kind id "${kind.id}" must look like "code.kebab-name" or "design.kebab-name".`,
			);
		}
		if (!kind.id.startsWith(`${kind.side}.`)) {
			throw new Error(
				`Lint rule kind "${kind.id}" is on side "${kind.side}"; the id prefix must match.`,
			);
		}
		if (byId.has(kind.id)) {
			throw new Error(`Lint rule kind "${kind.id}" is registered twice.`);
		}
		byId.set(kind.id, kind);
	}
	return {
		kinds,
		ids: new Set(byId.keys()),
		get: (id) => byId.get(id) ?? null,
	};
};
