import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Image, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
	createDesignFile,
	designFileQueryOptions,
	designSummariesQueryKey,
	designSummariesQueryOptions,
	getDesignFileForUuid,
} from "../../queries/design-file";
import type { TrickroomDesign } from "../../types";
import {
	markDesignOpened,
	sortDesignsByRecentActivity,
} from "../../utils/design-activity";
import { useProjectScope } from "../contexts";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { Text } from "../ui/text";
import { formatRelativeTime, pluralize } from "./project-view-utils";
import { useScrollSelectedIntoView } from "./useScrollSelectedIntoView";

export function Designs({
	selectedUuid,
	onSelect,
}: {
	selectedUuid: string | null;
	onSelect: (uuid: string | null) => void;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [filter, setFilter] = useState("");
	const [activeUuid, setActiveUuid] = useState<string | null>(null);
	const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const projectScope = useProjectScope();
	const designsQuery = useQuery(designSummariesQueryOptions(projectScope));
	const designsErrorMessage = (designsQuery.error as Error | null)?.message;
	const designs = useMemo(
		() => sortDesignsByRecentActivity(designsQuery.data ?? [], projectScope),
		[designsQuery.data, projectScope],
	);
	const setSelectedItemRef = useScrollSelectedIntoView(selectedUuid);
	const normalizedFilter = filter.trim().toLowerCase();
	const filteredDesigns = useMemo(
		() =>
			normalizedFilter
				? designs.filter((design) =>
						design.name.toLowerCase().includes(normalizedFilter),
					)
				: designs,
		[designs, normalizedFilter],
	);

	const prefetchDesignFile = (file: string) =>
		queryClient.prefetchQuery(designFileQueryOptions(file, projectScope));

	// TODO: when creating - add a secondary state requesting a name for the design file

	const createDesignMutation = useMutation({
		mutationFn: async () => {
			const designUuid = crypto.randomUUID();
			const designFile = getDesignFileForUuid(designUuid);
			const design: TrickroomDesign = {
				name: "Untitled",
				boards: [],
			};

			await createDesignFile(designFile, design);
			return designUuid;
		},
		onSuccess: async (designUuid) => {
			markDesignOpened(projectScope, designUuid);
			await queryClient.invalidateQueries({
				queryKey: designSummariesQueryKey,
			});
			onSelect(designUuid);
		},
	});
	const createErrorMessage = (createDesignMutation.error as Error | null)
		?.message;

	useHotkey(
		"Mod+N",
		() => {
			if (!createDesignMutation.isPending) {
				createDesignMutation.mutate();
			}
		},
		{ preventDefault: true },
	);

	useHotkey(
		"Enter",
		() => {
			if (selectedUuid) {
				markDesignOpened(projectScope, selectedUuid);
				navigate(`/design/${selectedUuid}`);
			}
		},
		{ enabled: selectedUuid !== null },
	);

	useHotkey("Escape", () => onSelect(null), {
		enabled: selectedUuid !== null,
	});

	return (
		<section className="flex flex-col flex-[2] min-h-0">
			<div className="flex flex-col gap-2 px-4 py-3">
				{/* Header */}
				<div className="flex items-center justify-between">
					<div className="flex items-baseline gap-2">
						<Text variant="section-header">designs</Text>
						<Text tone="faint" className="font-mono text-[11px]">
							{designs.length}
						</Text>
					</div>
					<Button
						variant="block"
						className="flex items-center gap-1 px-2 py-1 text-xs"
						disabled={createDesignMutation.isPending}
						onClick={() => createDesignMutation.mutate()}
					>
						<FilePlus2 className="size-3.5" aria-hidden="true" />
						{createDesignMutation.isPending ? "Creating..." : "New"}
					</Button>
				</div>

				{/* Filter */}
				<div className="relative">
					<Search
						className="absolute left-1.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
						aria-hidden="true"
					/>
					<Input
						variant="outlined"
						className="w-full pl-6"
						aria-label="Filter designs"
						placeholder="Filter designs…"
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
					/>
				</div>
			</div>
			<Separator />

			<ScrollArea className="flex-1 min-h-0">
				{/* Content */}
				{designsQuery.isPending ? (
					<div className="pointer-events-none divide-y divide-slate-100">
						{[
							"design-skeleton-a",
							"design-skeleton-b",
							"design-skeleton-c",
						].map((key) => (
							<div
								key={key}
								className="flex animate-pulse items-center gap-3 px-3 py-2.5"
							>
								<div className="size-10 shrink-0 bg-slate-200" />
								<div className="min-w-0 flex-1 space-y-2">
									<div className="h-3 w-1/3 bg-slate-200" />
									<div className="h-2 w-1/4 bg-slate-200" />
								</div>
								<div className="h-2 w-10 bg-slate-200" />
							</div>
						))}
					</div>
				) : null}
				{designsQuery.isError ? (
					<Alert variant="panel" className="mx-4 my-3">
						Failed to load designs: {designsErrorMessage}
					</Alert>
				) : null}
				{createDesignMutation.isError ? (
					<Alert variant="panel" className="mx-4 my-3">
						Failed to create design: {createErrorMessage}
					</Alert>
				) : null}
				{designsQuery.isSuccess ? (
					<div className="divide-y divide-slate-100">
						{designs.length === 0 ? (
							<EmptyState
								icon={Image}
								size="sm"
								title="No designs yet"
								description="Press ⌘N or use + New above to create your first design board."
							/>
						) : filteredDesigns.length === 0 ? (
							<div className="px-3 py-10 text-center">
								<Text tone="muted" className="text-sm">
									No matching designs.
								</Text>
							</div>
						) : (
							filteredDesigns.map((design) => {
								const isSelected = selectedUuid === design.uuid;
								const isActive = activeUuid === design.uuid;
								const dotHighlighted = isSelected || isActive;
								return (
									<Button
										key={design.file}
										ref={isSelected ? setSelectedItemRef : undefined}
										variant="block"
										isSelected={isSelected}
										className="flex w-full items-center gap-3 px-4 py-3 text-left"
										onClick={() => {
											if (clickTimerRef.current) {
												clearTimeout(clickTimerRef.current);
												clickTimerRef.current = null;
											}
											if (isSelected) {
												clickTimerRef.current = setTimeout(() => {
													onSelect(null);
													clickTimerRef.current = null;
												}, 250);
											} else {
												markDesignOpened(projectScope, design.uuid);
												onSelect(design.uuid);
											}
										}}
										onDoubleClick={() => {
											if (clickTimerRef.current) {
												clearTimeout(clickTimerRef.current);
												clickTimerRef.current = null;
											}
											markDesignOpened(projectScope, design.uuid);
											navigate(`/design/${design.uuid}`);
										}}
										onPointerDown={() => setActiveUuid(design.uuid)}
										onPointerUp={() => setActiveUuid(null)}
										onPointerLeave={() => setActiveUuid(null)}
										onMouseEnter={() => prefetchDesignFile(design.file)}
									>
										<div
											className={`size-10 shrink-0 bg-[length:12px_12px] inset-shadow-[0_0_0_1px] ${dotHighlighted ? "inset-shadow-cyan-200" : "inset-shadow-slate-200"}`}
											style={{
												backgroundImage: dotHighlighted
													? "radial-gradient(#06b6d4 1px, transparent 1px)"
													: "radial-gradient(#e2e8f0 1px, transparent 1px)",
											}}
										/>
										<div className="flex min-w-0 flex-1 flex-col gap-0.5">
											<Text className="block max-w-full truncate">
												{design.name}
											</Text>
											<Text
												tone="muted"
												className="block max-w-full truncate font-mono text-[10px]"
											>
												{design.layersCount}{" "}
												{pluralize(design.layersCount, "layer")}
												{" · "}
												{formatRelativeTime(design.modifiedAt)}
											</Text>
										</div>
									</Button>
								);
							})
						)}
					</div>
				) : null}
			</ScrollArea>
		</section>
	);
}
