import {
	setDesignSystemName,
	useDesignSystemName,
} from "../../stores/design-store";
import { useProjectConfig } from "../contexts";
import { Text } from "../ui/text";

export function DesignSystemPicker() {
	const config = useProjectConfig();
	const systemName = useDesignSystemName();
	const systems = config.systems ?? {};
	const systemKeys = Object.keys(systems);

	if (systemKeys.length === 0) {
		return (
			<div className="px-1 flex flex-col gap-1">
				<Text variant="label">Design system</Text>
				<span className="text-gray-400 text-xs">No systems configured</span>
			</div>
		);
	}

	return (
		<div className="px-1 flex flex-col gap-1">
			<Text variant="label" render={<label htmlFor="design-system-picker" />}>
				Design system
			</Text>
			<select
				id="design-system-picker"
				className="bg-gray-200/60 text-black text-xs rounded-none px-1 py-0.5 w-full border-none inset-shadow-[0_0_0_1px] inset-shadow-transparent focus-visible:outline-none focus-within:inset-shadow-blue-200 cursor-pointer"
				value={systemName ?? ""}
				onChange={(e) => setDesignSystemName(e.currentTarget.value || null)}
			>
				<option value="">(unlinked)</option>
				{systemKeys.map((key) => (
					<option key={key} value={key}>
						{key}
					</option>
				))}
			</select>
		</div>
	);
}
