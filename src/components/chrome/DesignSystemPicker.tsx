import {
	setDesignSystemId,
	useDesignSystemId,
} from "../../stores/design-store";
import { useProjectSystems } from "../contexts";
import { Select } from "../ui/select";
import { Text } from "../ui/text";

export function DesignSystemPicker() {
	const systems = useProjectSystems();
	const systemId = useDesignSystemId();

	if (systems.length === 0) {
		return (
			<div className="px-1 flex flex-col gap-1">
				<Text variant="label">System</Text>
				<Text variant="meta">No systems in this project</Text>
			</div>
		);
	}

	return (
		<div className="px-1 flex flex-col gap-1">
			<Text
				variant="label"
				// biome-ignore lint/a11y/noLabelWithoutControl: htmlFor points at the Select below.
				render={<label htmlFor="design-system-picker" />}
			>
				System
			</Text>
			<Select
				id="design-system-picker"
				className="cursor-pointer"
				value={systemId ?? ""}
				onChange={(e) => setDesignSystemId(e.currentTarget.value || null)}
			>
				<option value="">No system</option>
				{systems.map((system) => (
					<option key={system.systemId} value={system.systemId}>
						{system.systemName}
					</option>
				))}
			</Select>
		</div>
	);
}
