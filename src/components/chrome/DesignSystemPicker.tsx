import {
	setDesignSystemId,
	useDesignSystemId,
} from "../../stores/design-store";
import { useProjectSystems } from "../contexts";
import { Text } from "../ui/text";

export function DesignSystemPicker() {
	const systems = useProjectSystems();
	const systemId = useDesignSystemId();

	if (systems.length === 0) {
		return (
			<div className="px-1 flex flex-col gap-1">
				<Text variant="label">Design system</Text>
				<span className="text-slate-400 text-xs">No systems configured</span>
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
				className="bg-slate-200/60 text-slate-950 text-xs rounded-none px-1 py-0.5 w-full border-none inset-shadow-[0_0_0_1px] inset-shadow-transparent focus-visible:outline-none focus-within:inset-shadow-cyan-200 cursor-pointer"
				value={systemId ?? ""}
				onChange={(e) => setDesignSystemId(e.currentTarget.value || null)}
			>
				<option value="">(unlinked)</option>
				{systems.map((system) => (
					<option key={system.systemId} value={system.systemId}>
						{system.systemName}
					</option>
				))}
			</select>
		</div>
	);
}
