import { useMemo } from "react";
import type {
	ModelOptions,
	SpacingProperty,
} from "../../../utils/tailwind-classname";
import { Text } from "../../ui/text";
import { SpacingOverrideRows } from "./SpacingOverrideRows";
import { isMarginProperty } from "./spacingPropertiesController";
import { ValueField } from "./StyleControls";

type SpacingPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

type SpacingRowDefinition = {
	property: SpacingProperty;
	label: string;
};

type SpacingGroupDefinition = {
	title: string;
	rows: SpacingRowDefinition[];
};

const EMPTY_COLOR_TOKENS = new Set<string>();

const SPACING_GROUPS: SpacingGroupDefinition[] = [
	{
		title: "Padding",
		rows: [
			{ property: "padding", label: "All" },
			{ property: "padding-x", label: "X" },
			{ property: "padding-y", label: "Y" },
			{ property: "padding-top", label: "Top" },
			{ property: "padding-right", label: "Right" },
			{ property: "padding-bottom", label: "Bottom" },
			{ property: "padding-left", label: "Left" },
		],
	},
	{
		title: "Margin",
		rows: [
			{ property: "margin", label: "All" },
			{ property: "margin-x", label: "X" },
			{ property: "margin-y", label: "Y" },
			{ property: "margin-top", label: "Top" },
			{ property: "margin-right", label: "Right" },
			{ property: "margin-bottom", label: "Bottom" },
			{ property: "margin-left", label: "Left" },
		],
	},
	{
		title: "Gap",
		rows: [
			{ property: "gap", label: "All" },
			{ property: "gap-x", label: "X" },
			{ property: "gap-y", label: "Y" },
		],
	},
];

export function SpacingProperties({
	className,
	onChange,
}: SpacingPropertiesProps) {
	const options = useMemo<ModelOptions>(
		() => ({ colorTokens: EMPTY_COLOR_TOKENS }),
		[],
	);

	return (
		<div className="flex flex-col gap-3 pb-1">
			{SPACING_GROUPS.map((group) => (
				<div key={group.title} className="flex flex-col gap-1">
					<Text variant="label" render={<div />} className="px-1">
						{group.title}
					</Text>
					<div className="flex flex-col gap-1">
						{group.rows.map((row) => (
							<SpacingOverrideRows
								key={row.property}
								label={row.label}
								className={className}
								options={options}
								property={row.property}
								onChange={onChange}
								renderControl={(slot) => (
									<ValueField
										label={row.label}
										value={slot.value ?? ""}
										placeholder={
											isMarginProperty(row.property) ? "0, 4, auto" : "0, 4, [13px]"
										}
										onCommit={(value) =>
											slot.apply(value.trim() ? value.trim() : null)
										}
									/>
								)}
							/>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
