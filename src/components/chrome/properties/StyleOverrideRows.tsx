import { type ReactNode, useMemo } from "react";
import {
	buildPropertyModel,
	type ModelOptions,
	type StyleProperty,
} from "../../../utils/tailwind-classname";
import { type OverrideRowSlot, OverrideRows } from "./OverrideRows";
import {
	applyStyleUtility,
	clearStyleProperty,
	styleValueText,
} from "./styleSectionController";

/** Re-exported for callers that name the slot type explicitly. */
export type OverrideSlotApi = OverrideRowSlot;

type StyleOverrideRowsProps = {
	label: string;
	className: string;
	options: ModelOptions;
	property: StyleProperty;
	onChange: (next: string) => void;
	/** Renders the control for one slot. `slot.apply(utility)` writes a class
	 * body (e.g. `flex-row`); `slot.apply(null)` clears the slot. */
	renderControl: (slot: OverrideRowSlot) => ReactNode;
};

/**
 * Property-local override rows for a style-domain property, built on the
 * domain-agnostic {@link OverrideRows}. `renderControl`'s `slot.apply` takes a
 * Tailwind utility body (without mode/variant prefixes). See #403.
 */
export function StyleOverrideRows({
	label,
	className,
	options,
	property,
	onChange,
	renderControl,
}: StyleOverrideRowsProps) {
	const model = useMemo(
		() => buildPropertyModel(className, options),
		[className, options],
	);

	return (
		<OverrideRows
			label={label}
			model={model}
			property={property}
			readValue={(entry) =>
				entry && entry.intent.kind === "style"
					? styleValueText(entry.intent)
					: null
			}
			onApply={(variants, payload) =>
				onChange(
					payload === null
						? clearStyleProperty(className, options, property, variants)
						: applyStyleUtility(className, options, property, payload, {
								variants,
							}),
				)
			}
			renderControl={renderControl}
		/>
	);
}
