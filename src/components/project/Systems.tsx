import { RiInformationLine as Info } from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { TailwindSyncResult } from "../../hooks/useTailwindSyncController";
import {
	saveAndConfirmTailwindTokens,
	storedTailwindTokensQueryKey,
	storedTailwindTokensQueryOptions,
} from "../../queries/tailwind-sync-tokens";
import { useTailwindSyncController } from "../contexts";
import { Button } from "../ui/button";
import Checkbox from "../ui/checkbox";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
} from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { Text } from "../ui/text";

function System({ system }: { system: TailwindSyncResult }) {
	const addedScrollViewportRef = useRef<HTMLDivElement>(null);
	const removedScrollViewportRef = useRef<HTMLDivElement>(null);
	const queryClient = useQueryClient();
	const syncController = useTailwindSyncController();
	const [open, setOpen] = useState(false);
	const [shouldInjectOverrides, setShouldInjectOverrides] = useState(false);
	const shouldHaveOverrides = Boolean(
		(system?.data?.baselineDiff.removed ?? []).length,
	);
	// TODO: when more domains are supported this should probably include logic
	// TODO - future: granularly parse overrides so it's not --color-* but --color-red-* etc. where necessary
	const possibleOverrides = ["--color-*"];
	const systemName = system.data?.systemName ?? "";
	const storedTokensQuery = useQuery({
		...storedTailwindTokensQueryOptions(systemName),
		enabled: open && systemName.length > 0,
	});
	const saveOverridesMutation = useMutation({
		mutationFn: (overrides: string[]) =>
			saveAndConfirmTailwindTokens({
				systemName,
				domains: {
					color: {
						overrides,
					},
				},
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: storedTailwindTokensQueryKey(systemName),
			});
			// Refresh controller/sync state so stale review/warning indicators
			// for this system clear.
			await syncController.syncSystem(systemName);
		},
	});

	useEffect(() => {
		if (!open) {
			return;
		}

		const storedOverrides =
			storedTokensQuery.data?.domains.color.overrides ?? [];
		setShouldInjectOverrides(storedOverrides.length > 0);
	}, [open, storedTokensQuery.data]);

	const saveError =
		saveOverridesMutation.error instanceof Error
			? saveOverridesMutation.error.message
			: null;
	const storedOverrides = storedTokensQuery.data?.domains.color.overrides ?? [];
	const nextOverrides =
		shouldHaveOverrides && shouldInjectOverrides ? possibleOverrides : [];
	const overridesChanged =
		JSON.stringify(nextOverrides) !== JSON.stringify(storedOverrides);
	const reviewRequired = Boolean(
		system.data?.reviewRequired || storedTokensQuery.data?.reviewRequired,
	);
	const saveDisabled =
		!system.data ||
		saveOverridesMutation.isPending ||
		storedTokensQuery.isPending ||
		(!overridesChanged && !reviewRequired);

	const handleSave = () => {
		if (!system.data || saveDisabled) {
			return;
		}

		saveOverridesMutation.mutate(nextOverrides);
	};

	const showWarning = Boolean(system.data?.reviewRequired);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger>
				<Button
					variant="block"
					className="w-full inset-shadow-gray-200 px-3 py-4"
					flavor={showWarning ? "warning" : undefined}
				>
					<span className="flex flex-row gap-1 items-center justify-center">
						{showWarning ? <Info className="size-4" /> : null}
						{system.data?.systemName}
					</span>
				</Button>
			</DialogTrigger>
			<DialogPortal>
				<DialogOverlay />
				<DialogContent initialFocus={false}>
					<DialogTitle render={<Text variant="title" />}>
						{system.data?.systemName}
					</DialogTitle>
					<Separator />
					<div className="flex flex-col bg-green-50 text-green-950">
						<Text variant="label" className="ml-2 py-1">
							Added tokens
						</Text>
						<ScrollArea
							viewportRef={addedScrollViewportRef}
							className="h-20 px-2"
						>
							{(system.data?.tokens ?? []).map((token) => (
								<div
									key={token.name}
									className="flex flex-row w-full justify-between gap-1"
								>
									<span>
										{token.name}: {token.value}
									</span>
									<pre className="bg-green-900 text-green-50 px-0.5">
										{token.domain}
									</pre>
								</div>
							))}
						</ScrollArea>
					</div>
					{shouldHaveOverrides ? (
						<div className="flex flex-col bg-red-50 text-red-950">
							<Text variant="label" className="ml-2 py-1">
								Removed tokens
							</Text>
							<ScrollArea
								viewportRef={removedScrollViewportRef}
								className="h-20 px-2"
							>
								{(system.data?.baselineDiff.removed ?? []).map((token) => (
									<div
										key={token.name}
										className="flex flex-row w-full justify-between gap-1"
									>
										<span>
											{token.name}: {token.defaultValue}
										</span>
										<pre className="bg-red-900 text-red-50 px-0.5">
											{token.domain}
										</pre>
									</div>
								))}
							</ScrollArea>
							<div className="p-2 flex flex-row gap-1 items-center flex-wrap">
								<Checkbox
									checked={shouldInjectOverrides}
									onCheckedChange={(checked) =>
										setShouldInjectOverrides(Boolean(checked))
									}
									disabled={saveOverridesMutation.isPending}
								/>
								<span>Inject the following overrides:</span>
								{possibleOverrides.map((override) => (
									<pre className="bg-red-900 text-red-50 px-0.5" key={override}>
										{override}
									</pre>
								))}
							</div>
						</div>
					) : null}
					{saveError ? (
						<div className="bg-red-500 px-2 py-1 text-xs text-white">
							Failed to save overrides: {saveError}
						</div>
					) : null}
					<Separator />
					<div className="flex flex-row">
						<DialogClose
							className="flex-1 py-2"
							render={<Button variant="block" />}
						>
							Close
						</DialogClose>
						<Separator orientation="vertical" />
						<Button
							variant="block"
							className="flex-1 py-2"
							onClick={handleSave}
							disabled={saveDisabled}
						>
							{saveOverridesMutation.isPending
								? "Saving..."
								: "Save and confirm"}
						</Button>
					</div>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	);
}

export function Systems() {
	const systems = useTailwindSyncController();
	const systemCardsData = Object.values(systems.results);
	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-row items-center justify-between">
				<Text variant="subtitle">Systems</Text>
			</div>
			{systems.isPending ? (
				<div className="pointer-events-none bg-gray-500 px-2 py-1 text-xs text-white w-fit">
					Loading systems...
				</div>
			) : null}
			{/* {systems.isError ? (
				<div className="bg-red-500 px-2 py-1 text-xs text-white w-fit">
					Failed to load designs: {designsErrorMessage}
				</div>
			) : null} */}
			{systems.isSuccess ? (
				<div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
					{systemCardsData.map((system) => (
						<System key={system?.data?.systemName} system={system} />
					))}
				</div>
			) : null}
		</div>
	);
}
