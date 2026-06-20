import {
	updateElementClassName,
	updateElementText,
	useSelectedElement,
} from "../../stores/design-store";
import { InputField, TextareaField } from "../ui/input";
import { Separator } from "../ui/separator";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../ui/tabs";
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
		<div className="flex flex-col gap-1">
			<Tabs defaultValue="properties">
				<TabsList>
					<TabsTab value="properties">Properties</TabsTab>
					<TabsTab value="classnames">Classnames</TabsTab>
				</TabsList>
				<TabsPanel value="properties">
					{selectedElement.role === "text" ? (
						<>
							<div className="pb-1 px-1">
								<InputField
									type="text"
									label="Content"
									value={selectedElement.text}
									onChange={(event) =>
										updateElementText(
											selectedElement.id,
											event.currentTarget.value,
										)
									}
								/>
							</div>
							<Separator />
						</>
					) : null}
					<ColorProperties
						className={className}
						onChange={(next) =>
							updateElementClassName(selectedElement.id, next)
						}
					/>
				</TabsPanel>
				<TabsPanel value="classnames" className="px-1 pb-1">
					{/* TODO: this should become somewhat of a combobox situation, but with tailwind intellisense */}
					<TextareaField
						label="Tailwind classnames"
						value={className}
						onChange={(event) =>
							updateElementClassName(
								selectedElement.id,
								event.currentTarget.value,
							)
						}
					/>
				</TabsPanel>
			</Tabs>
		</div>
	);
}
