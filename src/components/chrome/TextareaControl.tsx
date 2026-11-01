import { validateChartProp } from "../../libraries/charts/spec";
import type { ControlDefinition, JsonPrimitive } from "../../types";
import { TextareaField } from "../ui/input";
import { Text } from "../ui/text";

/** A multi-line string control. Formatted values show what is wrong as you type. */
export function TextareaControl({
	control,
	value,
	onChange,
}: {
	control: ControlDefinition;
	value: JsonPrimitive | undefined;
	onChange: (value: string) => void;
}) {
	const text = typeof value === "string" ? value : "";
	const problem = control.format
		? validateChartProp(control.format, control.prop, text)
		: null;
	return (
		<div className="flex flex-col gap-1">
			<TextareaField
				label={control.label}
				description={control.description}
				className="font-mono text-xs"
				spellCheck={false}
				aria-invalid={problem !== null}
				value={text}
				onChange={(event) => onChange(event.currentTarget.value)}
			/>
			{problem ? (
				<Text variant="label" className="text-xs text-red-700">
					{problem}
				</Text>
			) : null}
		</div>
	);
}
