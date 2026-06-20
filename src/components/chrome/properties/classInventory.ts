/**
 * Categorizes a className string for the Style tab's class inventory (#419),
 * so users can see which classes are structured-editable ("managed"), which
 * are raw arbitrary-property classes, which are unrecognized, and where two
 * classes fight over the same property slot (last one wins).
 *
 * Pure + syntactic — built on the same parser/classifier the property model
 * uses, so it never disagrees with what the structured controls edit.
 */

import {
	classifyParsedClass,
	type KnownUtilityIntent,
	type ModelOptions,
	parseClassName,
} from "../../../utils/tailwind-classname";

export type ClassCategory = "managed" | "arbitrary" | "unknown";

export type InventoryItem = {
	/** Original class token, byte-for-byte. */
	raw: string;
	category: ClassCategory;
	/** Namespaced property key for managed classes (e.g. `layout.display`). */
	property?: string;
	/** Variant key for managed classes (`""` = base). */
	variantKey?: string;
	/** Mode chain (e.g. `["dark"]`) for managed classes. */
	modes?: string[];
	/** True when a later class overrides this one in the same slot. */
	shadowed?: boolean;
};

export type ClassConflict = {
	/** Human label for the contested slot, e.g. `md:hover · layout.display`. */
	slot: string;
	/** Competing classes in original order; the last one wins. */
	raws: string[];
};

export type ClassInventory = {
	items: InventoryItem[];
	managed: InventoryItem[];
	arbitrary: InventoryItem[];
	unknown: InventoryItem[];
	conflicts: ClassConflict[];
};

function intentProperty(intent: KnownUtilityIntent): string {
	switch (intent.kind) {
		case "color":
			return `color.${intent.property}`;
		case "spacing":
			return `spacing.${intent.property}`;
		case "style":
			return intent.property;
	}
}

export function buildClassInventory(
	className: string,
	options: ModelOptions,
): ClassInventory {
	const parsed = parseClassName(className, options);
	const items: InventoryItem[] = [];
	const slots = new Map<string, { property: string; raws: string[] }>();

	for (const cls of parsed) {
		const intent = classifyParsedClass(cls, options);

		if (intent.kind === "unknown") {
			const category: ClassCategory =
				cls.arbitrary && cls.prefix === "" ? "arbitrary" : "unknown";
			items.push({ raw: cls.raw, category });
			continue;
		}

		const property = intentProperty(intent);
		const variantKey = cls.variants.join(":");
		const slotKey = `${cls.modes.join(":")}|${property}|${variantKey}`;
		const slot = slots.get(slotKey);
		if (slot) {
			slot.raws.push(cls.raw);
		} else {
			slots.set(slotKey, { property, raws: [cls.raw] });
		}
		items.push({
			raw: cls.raw,
			category: "managed",
			property,
			variantKey,
			modes: cls.modes,
		});
	}

	const conflicts: ClassConflict[] = [];
	for (const [slotKey, { property, raws }] of slots) {
		if (raws.length < 2) continue;
		const [modeKey, , variantKey] = slotKey.split("|");
		const prefix = [modeKey, variantKey].filter(Boolean).join(":");
		conflicts.push({
			slot: prefix ? `${prefix} · ${property}` : property,
			raws,
		});
		const winner = raws[raws.length - 1];
		for (const item of items) {
			if (
				item.category === "managed" &&
				item.property === property &&
				item.variantKey === variantKey &&
				(item.modes ?? []).join(":") === modeKey &&
				item.raw !== winner
			) {
				item.shadowed = true;
			}
		}
	}

	return {
		items,
		managed: items.filter((item) => item.category === "managed"),
		arbitrary: items.filter((item) => item.category === "arbitrary"),
		unknown: items.filter((item) => item.category === "unknown"),
		conflicts,
	};
}
