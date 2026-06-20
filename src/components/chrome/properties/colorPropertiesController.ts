/**
 * Pure controller helpers behind `ColorProperties.tsx`. Extracted so
 * the className-in / className-out integration logic can be tested
 * without spinning up React, the design store, or tanstack-query.
 */

import {
	buildPropertyModel,
	type ColorProperty,
	type ColorValue,
	clearColor,
	type ModelOptions,
	serialize,
	setColor,
} from "../../../utils/tailwind-classname";

export function applyColorChange(
	className: string,
	options: ModelOptions,
	mutation: {
		property: ColorProperty;
		variants?: string[];
		value: ColorValue;
	},
): string {
	const model = buildPropertyModel(className, options);
	const next = setColor(
		model,
		{
			property: mutation.property,
			variants: mutation.variants,
			value: mutation.value,
		},
		options,
	);
	return serialize(next);
}

export function applyColorClear(
	className: string,
	options: ModelOptions,
	target: { property: ColorProperty; variants?: string[] },
): string {
	const model = buildPropertyModel(className, options);
	const next = clearColor(model, target.property, options, {
		variants: target.variants,
	});
	return serialize(next);
}

/**
 * Clear every given variant chain of one color property as a single
 * className-in / className-out fold — the row-level × (remove property)
 * gesture. Folding matters: separate onChange calls would each rebuild from a
 * stale className and clobber one another.
 */
export function applyColorClearAll(
	className: string,
	options: ModelOptions,
	property: ColorProperty,
	variantChains: readonly string[][],
): string {
	return variantChains.reduce(
		(acc, variants) => applyColorClear(acc, options, { property, variants }),
		className,
	);
}
