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
	type ClassLayer,
	createClassLayers,
} from "../../../utils/class-layers";
import {
	type ClassResolution,
	type ResolvedClassToken,
	resolveClassLayers,
} from "../../../utils/class-resolution";
import {
	classifyParsedClass,
	type KnownUtilityIntent,
	type ModelOptions,
} from "../../../utils/tailwind-classname";

export type ClassCategory = "managed" | "arbitrary" | "unknown";
export type ClassInventorySource = ClassLayer["source"];
export type ClassInventoryStatus = "active" | "shadowed" | "unknown";

export type InventoryItem = {
	/** Original class token, byte-for-byte. */
	raw: string;
	category: ClassCategory;
	source: ClassInventorySource;
	sourceLabel: string;
	layerIndex: number;
	tokenIndex: number;
	status: ClassInventoryStatus;
	readOnly: boolean;
	/** Namespaced property key for managed classes (e.g. `layout.display`). */
	property?: string;
	/** Variant key for managed classes (`""` = base). */
	variantKey?: string;
	/** Mode chain (e.g. `["dark"]`) for managed classes. */
	modes?: string[];
	/** True when a later class overrides this one in the same slot. */
	shadowed?: boolean;
	shadowedBy?: number;
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
	hasLayerMetadata: boolean;
	readOnly: InventoryItem[];
	active: InventoryItem[];
	shadowed: InventoryItem[];
};

export type ClassInventoryInput =
	| string
	| {
			className?: string | null;
			layers?: readonly ClassLayer[];
			resolution?: ClassResolution;
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

function sourceLabel(source: ClassInventorySource): string {
	switch (source) {
		case "registry-base":
			return "Registry base";
		case "system-template":
			return "Template";
		case "system-variant":
			return "Variant";
		case "system-compound-variant":
			return "Compound";
		case "instance-override":
			return "Override";
		case "authored":
			return "Authored";
		case "materialized-snapshot":
			return "Materialized";
	}
}

function isReadOnlySource(source: ClassInventorySource): boolean {
	return (
		source === "registry-base" ||
		source === "system-template" ||
		source === "system-variant" ||
		source === "system-compound-variant" ||
		source === "materialized-snapshot"
	);
}

function getInventoryResolution(
	input: ClassInventoryInput,
	options: ModelOptions,
): { resolution: ClassResolution; hasLayerMetadata: boolean } {
	if (typeof input === "string") {
		const layers = createClassLayers([
			{ source: "authored", className: input },
		]);
		return {
			resolution: resolveClassLayers(layers, options),
			hasLayerMetadata: false,
		};
	}

	if (input.resolution) {
		return {
			resolution: input.resolution,
			hasLayerMetadata: true,
		};
	}

	const layers =
		input.layers ??
		createClassLayers([{ source: "authored", className: input.className }]);
	return {
		resolution: resolveClassLayers(layers, options),
		hasLayerMetadata: Boolean(input.layers),
	};
}

function itemFromToken(
	token: ResolvedClassToken,
	options: ModelOptions,
): InventoryItem {
	const source = token.layer.source;
	const base = {
		raw: token.classToken,
		source,
		sourceLabel: sourceLabel(source),
		layerIndex: token.layer.index,
		tokenIndex: token.layer.tokenIndex,
		status: token.status,
		readOnly: isReadOnlySource(source),
		shadowed: token.status === "shadowed" ? true : undefined,
		shadowedBy: token.shadowedBy,
	};
	const intent =
		token.intent ??
		classifyParsedClass(token.parsed, { colorTokens: options.colorTokens });

	if (intent.kind === "unknown") {
		const category: ClassCategory =
			token.parsed.arbitrary && token.parsed.prefix === ""
				? "arbitrary"
				: "unknown";
		return { ...base, category };
	}

	return {
		...base,
		category: "managed",
		property: intentProperty(intent),
		variantKey: token.parsed.variants.join(":"),
		modes: token.parsed.modes,
	};
}

export function buildClassInventory(
	input: ClassInventoryInput,
	options: ModelOptions,
): ClassInventory {
	const { resolution, hasLayerMetadata } = getInventoryResolution(
		input,
		options,
	);
	const items: InventoryItem[] = [];

	for (const token of resolution.tokens) {
		items.push(itemFromToken(token, options));
	}

	const slots = new Map<string, { property: string; raws: string[] }>();
	for (const item of items) {
		if (item.category !== "managed" || !item.property) continue;
		const modeKey = (item.modes ?? []).join(":");
		const variantKey = item.variantKey ?? "";
		const slotKey = `${modeKey}|${item.property}|${variantKey}`;
		const slot = slots.get(slotKey);
		if (slot) {
			slot.raws.push(item.raw);
		} else {
			slots.set(slotKey, { property: item.property, raws: [item.raw] });
		}
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
	}

	return {
		items,
		managed: items.filter((item) => item.category === "managed"),
		arbitrary: items.filter((item) => item.category === "arbitrary"),
		unknown: items.filter((item) => item.category === "unknown"),
		conflicts,
		hasLayerMetadata,
		readOnly: items.filter((item) => item.readOnly),
		active: items.filter((item) => item.status === "active"),
		shadowed: items.filter((item) => item.status === "shadowed"),
	};
}
