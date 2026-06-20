import {
	updateElementClassName,
	updateElementText,
	useSelectedElement,
} from "../../stores/design-store";
import { InputField } from "../ui/input";
import { Separator } from "../ui/separator";
import { DesignSystemPicker } from "./DesignSystemPicker";
import { ColorProperties } from "./properties/ColorProperties";

export function Properties() {
	const selectedElement = useSelectedElement();

	if (!selectedElement) {
		return (
			<div className="flex flex-col gap-1 pt-1">
				<DesignSystemPicker />
			</div>
		);
	}

	const className = selectedElement.props.className ?? "";

	return (
		<div className="flex flex-col gap-1 pt-1">
			{selectedElement.role === "text" ? (
				<>
					<div className="pb-1 px-1">
						<InputField
							type="text"
							label="Content"
							value={selectedElement.text}
							onChange={(event) =>
								updateElementText(selectedElement.id, event.currentTarget.value)
							}
						/>
					</div>
					<Separator />
				</>
			) : null}
			<ColorProperties
				className={className}
				onChange={(next) => updateElementClassName(selectedElement.id, next)}
			/>
			<Separator />
			<div className="pb-1 px-1">
				{/* TODO: this should become somewhat of a combobox situation, but with tailwind intellisense */}
				<InputField
					type="text"
					label="Tailwind classnames"
					value={className}
					onChange={(event) =>
						updateElementClassName(
							selectedElement.id,
							event.currentTarget.value,
						)
					}
				/>
			</div>
		</div>
	);
}
