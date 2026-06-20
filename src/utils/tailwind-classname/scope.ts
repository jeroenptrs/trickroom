import type { KnownUtilityIntent } from "./classify";
import type { ParsedClass } from "./parse";

export type ModifierChain = {
	/**
	 * Tailwind modifiers before the utility body in source order, including
	 * modes such as `dark` and variants such as `hover`, `md`, or
	 * `data-[state=open]`.
	 */
	modifiers: string[];
	key: string;
	scoped: boolean;
};

export type UtilityConflictScope = {
	utilityGroup: string;
	modifierChain: ModifierChain;
	key: string;
};

export function getModifierChain(parsed: ParsedClass): ModifierChain {
	const modifiers = parsed.modifiers.length
		? parsed.modifiers
		: [...parsed.modes, ...parsed.variants];
	const key = modifiers.join(":");
	return {
		modifiers,
		key,
		scoped: modifiers.length > 0,
	};
}

export function sameModifierChain(
	a: Pick<ModifierChain, "key">,
	b: Pick<ModifierChain, "key">,
): boolean {
	return a.key === b.key;
}

export function getUtilityConflictGroup(intent: KnownUtilityIntent): string {
	return `${intent.kind}:${intent.property}`;
}

export function getUtilityConflictScope(
	parsed: ParsedClass,
	intent: KnownUtilityIntent,
): UtilityConflictScope {
	const utilityGroup = getUtilityConflictGroup(intent);
	const modifierChain = getModifierChain(parsed);
	return {
		utilityGroup,
		modifierChain,
		key: `${modifierChain.key}|${utilityGroup}`,
	};
}

export function utilityScopesMayConflict(
	a: Pick<UtilityConflictScope, "utilityGroup" | "modifierChain">,
	b: Pick<UtilityConflictScope, "utilityGroup" | "modifierChain">,
): boolean {
	return (
		a.utilityGroup === b.utilityGroup &&
		sameModifierChain(a.modifierChain, b.modifierChain)
	);
}
