import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { designSummariesQueryOptions } from "../queries/design-file";
import { sortDesignsByRecentActivity } from "../utils/design-activity";
import { useProjectScope, useTailwindSyncController } from "./contexts";
import { AuditLogLink } from "./project/AuditLogLink";
import { Designs } from "./project/Designs";
import { ProjectHeader } from "./project/ProjectHeader";
import { ProjectPane } from "./project/ProjectPane";
import { Systems } from "./project/Systems";

export function Project() {
	const projectScope = useProjectScope();
	const designsQuery = useQuery(designSummariesQueryOptions(projectScope));
	const systems = useTailwindSyncController();
	const [selectedDesignUuid, setSelectedDesignUuid] = useState<string | null>(
		null,
	);
	const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);

	const selectDesign = (uuid: string | null) => {
		setSelectedDesignUuid(uuid);
		setSelectedSystemId(null);
	};

	const selectSystem = (systemId: string | null) => {
		setSelectedSystemId(systemId);
		setSelectedDesignUuid(null);
	};

	const selectSidebarItem = (direction: 1 | -1) => {
		const designItems = sortDesignsByRecentActivity(
			designsQuery.data ?? [],
			projectScope,
		).map((design) => ({
			kind: "design" as const,
			id: design.uuid,
		}));
		const systemItems = Object.keys(systems.statusBySystem).map((systemId) => ({
			kind: "system" as const,
			id: systemId,
		}));
		const items = [...designItems, ...systemItems];
		if (items.length === 0) {
			return;
		}

		const selectedIndex = items.findIndex((item) =>
			item.kind === "design"
				? item.id === selectedDesignUuid
				: item.id === selectedSystemId,
		);
		const nextIndex =
			selectedIndex === -1
				? direction === 1
					? 0
					: items.length - 1
				: (selectedIndex + direction + items.length) % items.length;
		const nextItem = items[nextIndex];
		if (nextItem.kind === "design") {
			selectDesign(nextItem.id);
		} else {
			selectSystem(nextItem.id);
		}
	};

	useHotkey("ArrowDown", () => selectSidebarItem(1), {
		preventDefault: true,
	});
	useHotkey("ArrowUp", () => selectSidebarItem(-1), {
		preventDefault: true,
	});

	return (
		<div className="flex h-full w-full flex-col">
			<ProjectHeader />
			<div className="flex flex-1 flex-row overflow-hidden">
				<div className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
					<Designs selectedUuid={selectedDesignUuid} onSelect={selectDesign} />
					<Systems
						selectedSystemId={selectedSystemId}
						onSelectSystem={selectSystem}
					/>
					<AuditLogLink />
				</div>
				<div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
					<ProjectPane
						selectedDesignUuid={selectedDesignUuid}
						selectedSystemId={selectedSystemId}
						onSelectDesign={selectDesign}
						onSelectSystem={selectSystem}
					/>
				</div>
			</div>
		</div>
	);
}
