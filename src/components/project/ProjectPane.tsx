import { useQuery } from "@tanstack/react-query";
import {
	FilePlus2,
	LayoutTemplate,
	MousePointerClick,
	Plus,
} from "lucide-react";
import { useState } from "react";
import { designSummariesQueryOptions } from "../../queries/design-file";
import { sessionQueryOptions } from "../../queries/projects";
import { useProjectScope, useTailwindSyncController } from "../contexts";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { KbdHint } from "../ui/kbd-hint";
import { CreateSystemDialog } from "./CreateSystemDialog";
import { DesignDetailPane } from "./DesignDetailPane";
import { SystemDetailPane } from "./SystemDetailPane";
import { useCreateDesign } from "./useCreateDesign";

function WelcomePane({
	onDesignCreated,
	onSystemCreated,
}: {
	onDesignCreated: (designUuid: string) => void;
	onSystemCreated: (systemId: string) => void;
}) {
	const createDesignMutation = useCreateDesign(onDesignCreated);
	const [createSystemOpen, setCreateSystemOpen] = useState(false);
	const createError = (createDesignMutation.error as Error | null)?.message;

	return (
		<>
			<EmptyState
				icon={LayoutTemplate}
				title="No designs or systems yet"
				description="Create a design to start drawing, or add a system to use your tokens."
				action={
					<div className="flex items-center gap-2">
						<Button
							variant="filled"
							className="flex items-center gap-1.5"
							disabled={createDesignMutation.isPending}
							onClick={() => createDesignMutation.mutate()}
						>
							<FilePlus2 className="size-3.5" aria-hidden="true" />
							{createDesignMutation.isPending ? "Creating…" : "New design"}
						</Button>
						<Button
							variant="outlined"
							className="flex items-center gap-1.5"
							onClick={() => setCreateSystemOpen(true)}
						>
							<Plus className="size-3.5" aria-hidden="true" />
							Add system
						</Button>
					</div>
				}
			>
				{createError ? (
					<Alert variant="panel">
						Could not create the design: {createError}
					</Alert>
				) : null}
			</EmptyState>
			<CreateSystemDialog
				open={createSystemOpen}
				onOpenChange={setCreateSystemOpen}
				onCreated={(system) => onSystemCreated(system.systemId)}
			/>
		</>
	);
}

function NothingSelectedPane() {
	return (
		<EmptyState icon={MousePointerClick} title="Select a design or system">
			<div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
				<KbdHint keys="↑↓" label="Select" />
				<KbdHint keys="⌘N" label="New design" />
				<KbdHint keys="⌘⇧N" label="Add system" />
			</div>
		</EmptyState>
	);
}

export function ProjectPane({
	selectedDesignUuid,
	selectedSystemId,
	onSelectDesign,
	onSelectSystem,
}: {
	selectedDesignUuid: string | null;
	selectedSystemId: string | null;
	onSelectDesign: (uuid: string | null) => void;
	onSelectSystem: (systemId: string | null) => void;
}) {
	const projectScope = useProjectScope();
	const designsQuery = useQuery(designSummariesQueryOptions(projectScope));
	const sessionQuery = useQuery(sessionQueryOptions());
	const systems = useTailwindSyncController();
	const designs = designsQuery.data ?? [];
	const systemEntries = Object.entries(systems.statusBySystem);
	const locationId = sessionQuery.data?.activeProject?.locationId ?? "";

	const selectedDesign = designs.find((d) => d.uuid === selectedDesignUuid);
	const selectedSystem = selectedSystemId
		? (systems.results[selectedSystemId] ?? {
				status: systems.statusBySystem[selectedSystemId] ?? "idle",
			})
		: null;

	if (selectedDesign) {
		return (
			<DesignDetailPane
				design={selectedDesign}
				locationId={locationId}
				onDelete={() => onSelectDesign(null)}
			/>
		);
	}

	if (selectedSystemId && selectedSystem) {
		return (
			<SystemDetailPane
				systemId={selectedSystemId}
				result={selectedSystem}
				onSelectSystem={onSelectSystem}
			/>
		);
	}

	// An unloaded list is not an empty project.
	if (
		designsQuery.isSuccess &&
		designs.length === 0 &&
		systemEntries.length === 0
	) {
		return (
			<WelcomePane
				onDesignCreated={onSelectDesign}
				onSystemCreated={onSelectSystem}
			/>
		);
	}

	return <NothingSelectedPane />;
}
