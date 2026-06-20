import type { ParsedClass } from "./parse";

/** Default mode bucket key (`""`). */
export const DEFAULT_MODE = "";

export type SlotTarget = {
	/** Defaults to `""` (default mode bucket). */
	mode?: string;
	/** Defaults to `[]` (default variant slot). */
	variants?: string[];
};

/** Mode and variant keys used as the slot identity in `PropertyModel`. */
export type SlotKeys = {
	modeKey: string;
	variantKey: string;
};

export function slotKeysFromParsed(parsed: ParsedClass): SlotKeys {
	return {
		modeKey: parsed.modes.join(":"),
		variantKey: parsed.variants.join(":"),
	};
}

export function resolveSlotTarget(target: SlotTarget = {}): SlotKeys {
	return {
		modeKey: target.mode ?? DEFAULT_MODE,
		variantKey: (target.variants ?? []).join(":"),
	};
}

/**
 * Prefix a utility body with mode and variant chains (`dark:md:hover:…`).
 * Modes precede variants, matching Tailwind's modifier order.
 */
export function formatWithVariantChain(body: string, target: SlotTarget = {}): string {
	const variantChain = [
		...(target.mode && target.mode.length > 0 ? [target.mode] : []),
		...(target.variants ?? []),
	];
	return variantChain.length > 0 ? `${variantChain.join(":")}:${body}` : body;
}

/** Replace one raw class in place, or append when the slot is empty. */
export function replaceOrAppendRaw(
	originalRaws: readonly string[],
	existingIndex: number | undefined,
	newRaw: string,
): string[] {
	const next = originalRaws.map((raw) => raw);
	if (existingIndex !== undefined) {
		next[existingIndex] = newRaw;
		return next;
	}
	next.push(newRaw);
	return next;
}

/** Remove one raw class by its index in the original list. */
export function removeRawAtIndex(
	originalRaws: readonly string[],
	index: number,
): string[] {
	return originalRaws.filter((_, i) => i !== index).map((p) => p);
}
