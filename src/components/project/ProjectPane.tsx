import { useQuery } from "@tanstack/react-query";
import { MousePointerClick, Sparkles } from "lucide-react";
import { designSummariesQueryOptions } from "../../queries/design-file";
import { sessionQueryOptions } from "../../queries/projects";
import { useProjectScope, useTailwindSyncController } from "../contexts";
import { EmptyState } from "../ui/empty-state";
import { Kbd } from "../ui/kbd";
import { Text } from "../ui/text";
import { DesignDetailPane } from "./DesignDetailPane";
import { SystemDetailPane } from "./SystemDetailPane";

function KbdHint({ kbd, label }: { kbd: string; label: string }) {
	return (
		<div className="flex items-center gap-1.5">
			<Kbd>{kbd}</Kbd>
			<Text tone="faint" className="text-xs">
				{label}
			</Text>
		</div>
	);
}

function KbdHintRow({ hints }: { hints: { kbd: string; label: string }[] }) {
	return (
		<div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
			{hints.map((hint) => (
				<KbdHint key={hint.kbd} kbd={hint.kbd} label={hint.label} />
			))}
		</div>
	);
}

function WelcomePane({ projectRoot }: { projectRoot: string }) {
	return (
		<EmptyState
			icon={Sparkles}
			title="Welcome to Trickroom"
			description="This project doesn't have any designs or systems yet. Start by creating a design board."
		>
			<Text tone="faint" className="font-mono text-xs">
				{projectRoot}
			</Text>
			<KbdHintRow
				hints={[
					{ kbd: "⌘N", label: "new design" },
					{ kbd: "⌘⇧N", label: "new system" },
					{ kbd: "⌘K", label: "switch project" },
				]}
			/>
		</EmptyState>
	);
}

function NothingSelectedPane() {
	return (
		<EmptyState
			icon={MousePointerClick}
			title="Nothing selected"
			description="Pick a design or system from the sidebar to preview its contents and edit metadata."
		>
			<KbdHintRow
				hints={[
					{ kbd: "↑↓", label: "navigate" },
					{ kbd: "↵", label: "open" },
					{ kbd: "⌘N", label: "new design" },
					{ kbd: "⌘⇧N", label: "new system" },
				]}
			/>
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
	const projectRoot = sessionQuery.data?.activeProject?.projectRoot ?? "";
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

	if (designs.length === 0 && systemEntries.length === 0) {
		return <WelcomePane projectRoot={projectRoot} />;
	}

	return <NothingSelectedPane />;
}
