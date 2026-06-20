import { useQuery } from "@tanstack/react-query";
import { MousePointerClick, Sparkles } from "lucide-react";
import { designSummariesQueryOptions } from "../../queries/design-file";
import { sessionQueryOptions } from "../../queries/projects";
import { useProjectScope, useTailwindSyncController } from "../contexts";
import { Text } from "../ui/text";
import { DesignDetailPane } from "./DesignDetailPane";
import { SystemDetailPane } from "./SystemDetailPane";

function KbdHint({ kbd, label }: { kbd: string; label: string }) {
	return (
		<div className="flex items-center gap-1.5">
			<span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] font-medium text-slate-600">
				{kbd}
			</span>
			<span className="text-xs text-slate-500">{label}</span>
		</div>
	);
}

function WelcomePane({ projectRoot }: { projectRoot: string }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
			<div className="flex size-12 items-center justify-center bg-slate-100 inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
				<Sparkles className="size-5 text-slate-400" aria-hidden="true" />
			</div>
			<div className="flex flex-col gap-1.5">
				<Text variant="title">Welcome to Trickroom</Text>
				<p className="max-w-xs text-sm text-slate-500">
					This project doesn&apos;t have any designs or systems yet. Start by
					creating a design board.
				</p>
			</div>
			<p className="font-mono text-xs text-slate-400">{projectRoot}</p>
			<div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
				<KbdHint kbd="⌘N" label="new design" />
				<KbdHint kbd="⌘⇧N" label="new system" />
				<KbdHint kbd="⌘K" label="switch project" />
			</div>
		</div>
	);
}

function NothingSelectedPane() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
			<div className="flex size-12 items-center justify-center bg-slate-100 inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
				<MousePointerClick
					className="size-5 text-slate-400"
					aria-hidden="true"
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Text variant="title">Nothing selected</Text>
				<p className="max-w-sm text-sm text-slate-500">
					Pick a design or system from the sidebar to preview its contents and
					edit metadata.
				</p>
			</div>
			<div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
				<KbdHint kbd="↑↓" label="navigate" />
				<KbdHint kbd="↵" label="open" />
				<KbdHint kbd="⌘N" label="new design" />
				<KbdHint kbd="⌘⇧N" label="new system" />
			</div>
		</div>
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
