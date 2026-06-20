import { useCallback, useMemo } from "react";
import { useResolvedColorTokens } from "../../../hooks/useResolvedColorTokens";
import { useDesignSystemName } from "../../../stores/design-store";
import {
	buildPropertyModel,
	type ColorProperty,
	type ColorValue,
} from "../../../utils/tailwind-classname";
import { ColorPropertyControl } from "./ColorPropertyControl";
import {
	applyColorChange,
	applyColorClear,
} from "./colorPropertiesController";

type ColorPropertiesProps = {
	className: string;
	onChange: (next: string) => void;
};

const PROPERTIES: { property: ColorProperty; label: string }[] = [
	{ property: "background", label: "Background" },
	{ property: "text", label: "Text" },
	{ property: "border", label: "Border" },
];

export function ColorProperties({ className, onChange }: ColorPropertiesProps) {
	const systemName = useDesignSystemName();
	const resolved = useResolvedColorTokens(systemName);

	const options = useMemo(
		() => ({ colorTokens: resolved.names }),
		[resolved.names],
	);

	const model = useMemo(
		() => buildPropertyModel(className, options),
		[className, options],
	);

	const handleSet = useCallback(
		(property: ColorProperty, variants: string[], value: ColorValue) => {
			onChange(
				applyColorChange(className, options, { property, variants, value }),
			);
		},
		[className, onChange, options],
	);

	const handleClear = useCallback(
		(property: ColorProperty, variants: string[]) => {
			onChange(applyColorClear(className, options, { property, variants }));
		},
		[className, onChange, options],
	);

	return (
		<div className="flex flex-col gap-2 pb-1">
			{PROPERTIES.map(({ property, label }) => (
				<ColorPropertyControl
					key={property}
					label={label}
					property={property}
					model={model}
					resolved={resolved}
					onSet={(variants, value) => handleSet(property, variants, value)}
					onClear={(variants) => handleClear(property, variants)}
				/>
			))}
		</div>
	);
}
