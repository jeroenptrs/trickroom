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
	/** See {@link OverrideRows}: single-line layout for self-labelled controls. */
	inline?: boolean;
	/** See {@link OverrideRows}: offer as a ghost chip while unset. */
	likely?: boolean;
	/** See {@link OverrideRows}: extra classes on the row root. */
	rowClassName?: string;
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
	inline,
	likely,
	rowClassName,
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
			inline={inline}
			likely={likely}
			className={rowClassName}
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
			onClearAll={(chains) =>
				onChange(
					chains.reduce(
						(acc, variants) =>
							clearStyleProperty(acc, options, property, variants),
						className,
					),
				)
			}
			renderControl={renderControl}
		/>
	);
}
