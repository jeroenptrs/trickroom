import { type ReactNode, useMemo } from "react";
import {
	buildPropertyModel,
	type ModelOptions,
	type SpacingProperty,
} from "../../../utils/tailwind-classname";
import { type OverrideRowSlot, OverrideRows } from "./OverrideRows";
import {
	applySpacingChange,
	applySpacingClear,
	formatSpacingInputValue,
	parseSpacingInputValue,
} from "./spacingPropertiesController";

type SpacingOverrideRowsProps = {
	label: string;
	className: string;
	options: ModelOptions;
	property: SpacingProperty;
	/** See {@link OverrideRows}: single-line layout for self-labelled controls. */
	inline?: boolean;
	/** See {@link OverrideRows}: offer as a ghost chip while unset. */
	likely?: boolean;
	/** See {@link OverrideRows}: extra classes on the row root. */
	rowClassName?: string;
	onChange: (next: string) => void;
	/** Renders the control for one slot. `slot.apply(input)` takes a raw
	 * spacing input (e.g. `4`, `auto`, `[13px]`); `slot.apply(null)` clears. */
	renderControl: (slot: OverrideRowSlot) => ReactNode;
};

/**
 * Property-local override rows for a spacing-domain property, built on the
 * domain-agnostic {@link OverrideRows}. Spacing is a separate classifier
 * domain from the StyleProperty-typed sections, so it plugs its own
 * read/parse/apply into the shared override plumbing (#403).
 */
export function SpacingOverrideRows({
	label,
	className,
	options,
	property,
	inline,
	likely,
	rowClassName,
	onChange,
	renderControl,
}: SpacingOverrideRowsProps) {
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
			readValue={(entry) => (entry ? formatSpacingInputValue(entry) : null)}
			onApply={(variants, payload) => {
				if (payload === null) {
					onChange(applySpacingClear(className, options, property, variants));
					return;
				}
				const parsed = parseSpacingInputValue(payload, property);
				onChange(
					parsed
						? applySpacingChange(className, options, {
								property,
								value: parsed.value,
								negative: parsed.negative,
								variants,
							})
						: applySpacingClear(className, options, property, variants),
				);
			}}
			onClearAll={(chains) =>
				onChange(
					chains.reduce(
						(acc, variants) =>
							applySpacingClear(acc, options, property, variants),
						className,
					),
				)
			}
			renderControl={renderControl}
		/>
	);
}
