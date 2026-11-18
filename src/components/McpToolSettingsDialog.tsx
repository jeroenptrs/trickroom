import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2, X } from "lucide-react";
import { useState } from "react";
import { MCP_TOOL_GROUPS, type McpToolGroupId } from "../mcp/tool-groups";
import {
	mcpToolGroupSettingsQueryKey,
	mcpToolGroupSettingsQueryOptions,
	updateMcpToolGroupSettings,
} from "../queries/mcp-settings";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
} from "./ui/dialog";
import {
	Disclosure,
	DisclosurePanel,
	DisclosureSummary,
	DisclosureTrigger,
} from "./ui/disclosure";
import { ScrollArea } from "./ui/scroll-area";
import { Skeleton } from "./ui/skeleton";
import { Switch } from "./ui/switch";
import { Text } from "./ui/text";

type McpToolSettingsDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

const mcpToolGroupTools = Object.fromEntries(
	MCP_TOOL_GROUPS.map((group) => [group.id, group.tools]),
) as Record<McpToolGroupId, readonly string[]>;

function McpToolGroupSettingRow({
	group,
	disabled,
	onToggle,
}: {
	group: {
		id: McpToolGroupId;
		label: string;
		description: string;
		toolCount: number;
		enabled: boolean;
	};
	disabled: boolean;
	onToggle: (enabled: boolean) => void;
}) {
	const inputId = `mcp-tool-group-${group.id}`;
	const tools = mcpToolGroupTools[group.id];

	return (
		<li>
			<div className="flex items-start justify-between gap-3 px-3 py-3">
				<div className="min-w-0 flex-1">
					<label
						htmlFor={inputId}
						className="block text-sm font-medium text-slate-900"
					>
						{group.label}
					</label>
					<Text tone="muted" className="mt-1 text-xs leading-relaxed">
						{group.description}
					</Text>
				</div>
				<Switch
					id={inputId}
					checked={group.enabled}
					disabled={disabled}
					onCheckedChange={onToggle}
				/>
			</div>

			<div className="border-t border-slate-200 px-3 pb-2">
				<Disclosure defaultOpen={false}>
					<DisclosureTrigger className="px-0 py-2 text-[11px] font-medium text-slate-600">
						Tools
						<DisclosureSummary>
							<Text tone="faint" className="font-mono text-[10px]">
								{group.toolCount}
							</Text>
						</DisclosureSummary>
					</DisclosureTrigger>
					<DisclosurePanel className="gap-1 px-0 pb-1">
						<ul className="flex flex-col gap-0.5">
							{tools.map((tool) => (
								<li
									key={tool}
									className="font-mono text-[10px] leading-relaxed text-slate-600"
								>
									{tool}
								</li>
							))}
						</ul>
					</DisclosurePanel>
				</Disclosure>
			</div>
		</li>
	);
}

/** Mirrors one group row: label, description line, switch, tools toggle. */
function McpToolGroupSkeletonRow() {
	return (
		<li className="flex flex-col">
			<div className="flex items-start justify-between gap-3 px-3 py-3">
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-3 w-56" />
				</div>
				<Skeleton className="h-4 w-7" />
			</div>
			<div className="border-t border-slate-200 px-3 py-2.5">
				<Skeleton className="h-3 w-12" />
			</div>
		</li>
	);
}

export function McpToolSettingsDialog({
	open,
	onOpenChange,
}: McpToolSettingsDialogProps) {
	const queryClient = useQueryClient();
	const settingsQuery = useQuery({
		...mcpToolGroupSettingsQueryOptions(),
		enabled: open,
	});
	const [actionError, setActionError] = useState<string | null>(null);

	const updateMutation = useMutation({
		mutationFn: updateMcpToolGroupSettings,
		onMutate: () => setActionError(null),
		onSuccess: async (data) => {
			queryClient.setQueryData(mcpToolGroupSettingsQueryKey, data);
		},
		onError: (error) => {
			setActionError(
				error instanceof Error
					? error.message
					: "Failed to update MCP tool settings",
			);
		},
	});

	const handleToggle = (groupId: McpToolGroupId, enabled: boolean) => {
		const currentGroups = settingsQuery.data?.toolGroups ?? [];
		const nextPatch = Object.fromEntries(
			currentGroups.map((group) => [
				group.id,
				group.id === groupId ? enabled : group.enabled,
			]),
		) as Partial<Record<McpToolGroupId, boolean>>;

		updateMutation.mutate(nextPatch);
	};

	const isSaving = updateMutation.isPending;
	const loadError = (settingsQuery.error as Error | null)?.message;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogPortal>
				<DialogOverlay />
				<DialogContent
					className="grid! max-h-[min(100dvh-2rem,40rem)] min-h-0 w-[calc(100vw-2rem)] max-w-lg grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden md:max-w-lg"
					initialFocus={false}
				>
					<div className="flex shrink-0 flex-row items-center justify-between border-b border-slate-200 px-4 py-3">
						<div className="flex min-w-0 items-center gap-2">
							<Settings2
								className="size-4 shrink-0 text-slate-500"
								aria-hidden="true"
							/>
							<DialogTitle className="p-0 text-sm font-medium text-slate-900">
								MCP Settings
							</DialogTitle>
						</div>
						<DialogClose
							aria-label="Close"
							className="inline-flex size-6 items-center justify-center text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"
						>
							<X className="size-4" aria-hidden="true" />
						</DialogClose>
					</div>

					<div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
						<div className="shrink-0">
							<DialogDescription className="px-4 pt-3 text-xs text-slate-600">
								Choose which MCP tool groups agents can discover and call. Saved
								to{" "}
								<code className="font-mono text-[11px]">
									~/.trickroom/settings.json
								</code>
								. Running MCP servers pick up changes automatically.
							</DialogDescription>

							{loadError ? (
								<div className="mx-4 mt-3 flex items-start gap-2">
									<Alert variant="panel" className="min-w-0 flex-1">
										Failed to load MCP settings: {loadError}
									</Alert>
									<Button
										type="button"
										variant="outlined"
										className="shrink-0 px-2 py-1 text-xs"
										disabled={settingsQuery.isFetching}
										onClick={() => void settingsQuery.refetch()}
									>
										Retry
									</Button>
								</div>
							) : null}

							{actionError ? (
								<Alert variant="panel" className="mx-4 mt-3">
									{actionError}
								</Alert>
							) : null}
						</div>

						<ScrollArea className="h-full min-h-0 overflow-hidden">
							<div className="px-4 py-4">
								{settingsQuery.isError ? null : (
									<ul
										className="flex flex-col divide-y divide-slate-200 border border-slate-200 bg-slate-50"
										aria-busy={settingsQuery.isPending}
									>
										{settingsQuery.isPending
											? ["a", "b", "c"].map((key) => (
													<McpToolGroupSkeletonRow key={key} />
												))
											: settingsQuery.data.toolGroups.map((group) => (
													<McpToolGroupSettingRow
														key={group.id}
														group={group}
														disabled={isSaving || settingsQuery.isFetching}
														onToggle={(enabled) =>
															handleToggle(group.id, enabled)
														}
													/>
												))}
									</ul>
								)}
							</div>
						</ScrollArea>
					</div>

					<div className="flex shrink-0 justify-end border-t border-slate-200 px-4 py-3">
						<DialogClose render={<Button type="button" variant="block" />}>
							Done
						</DialogClose>
					</div>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	);
}
