import { GitMerge } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { manifestFieldLabels } from "../../stores/design-merge";
import {
	type BoardConflict,
	designStore,
	useDesignConflicts,
} from "../../stores/design-store";
import {
	type ConflictChoice,
	resolveDesignConflicts,
} from "../../stores/design-sync";
import {
	AlertDialog,
	AlertDialogBackdrop,
	AlertDialogDescription,
	AlertDialogPopup,
	AlertDialogPortal,
	AlertDialogTitle,
	AlertDialogViewport,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Segmented, type SegmentedOption } from "../ui/segmented";
import { Separator } from "../ui/separator";

const choiceOptions: readonly SegmentedOption<ConflictChoice>[] = [
	{ value: "theirs", label: "Take theirs" },
	{ value: "mine", label: "Keep mine" },
];

const MAX_LAYER_NAMES = 3;

const describeBoardConflict = (conflict: BoardConflict) => {
	switch (conflict.reason) {
		case "deleted-on-disk":
			return "Deleted on disk, edited here.";
		case "deleted-here":
			return "Deleted here, changed on disk.";
		default:
			return conflict.nodeIds.length > 0
				? "Changed here and on disk:"
				: "Changed here and on disk.";
	}
};

const layerNames = (conflict: BoardConflict) => {
	const { entitiesById } = designStore.get();
	const names = conflict.nodeIds.map((id) => {
		const name = entitiesById[id]?.props["data-trickroom-name"];
		return typeof name === "string" && name ? name : id;
	});
	const shown = names.slice(0, MAX_LAYER_NAMES).join(", ");
	return names.length > MAX_LAYER_NAMES
		? `${shown} and ${names.length - MAX_LAYER_NAMES} more`
		: shown;
};

type Part = {
	key: string;
	title: string;
	detail: string;
	layers?: string;
};

/**
 * Asks, part by part, what to do with changes made both here and on disk:
 * take the disk version (drops the local edits to that part) or keep the
 * local version (saved over that part on disk, checked against the version
 * shown here). Everything else already merged on its own.
 */
export function DesignConflictDialog() {
	const conflicts = useDesignConflicts();
	const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});

	const parts = useMemo<Part[]>(() => {
		if (!conflicts) return [];
		return [
			...conflicts.boards.map((conflict) => ({
				key: `board:${conflict.boardId}`,
				title: `Board ${conflict.name}`,
				detail: describeBoardConflict(conflict),
				layers: layerNames(conflict) || undefined,
			})),
			...(conflicts.manifest
				? [
						{
							key: "manifest",
							title: "Design settings",
							detail: `Changed here and on disk: ${conflicts.manifest.fields
								.map((field) => manifestFieldLabels[field])
								.join(", ")}.`,
						},
					]
				: []),
			...(conflicts.order
				? [
						{
							key: "order",
							title: "Board order",
							detail: "Boards were reordered here and on disk.",
						},
					]
				: []),
		];
	}, [conflicts]);

	// Choices for parts that are no longer in conflict are dropped.
	useEffect(() => {
		setChoices((current) => {
			const next: Record<string, ConflictChoice> = {};
			for (const part of parts) {
				const choice = current[part.key];
				if (choice) next[part.key] = choice;
			}
			return next;
		});
	}, [parts]);

	const allChosen = parts.every((part) => choices[part.key]);
	const apply = () => {
		if (!conflicts || !allChosen) return;
		resolveDesignConflicts({
			boards: Object.fromEntries(
				conflicts.boards.map((conflict) => [
					conflict.boardId,
					choices[`board:${conflict.boardId}`] ?? "theirs",
				]),
			),
			manifest: choices.manifest,
			order: choices.order,
		});
		setChoices({});
	};
	const chooseAll = (choice: ConflictChoice) =>
		setChoices(Object.fromEntries(parts.map((part) => [part.key, choice])));

	return (
		<AlertDialog open={conflicts !== null} onOpenChange={() => undefined}>
			<AlertDialogPortal>
				<AlertDialogBackdrop />
				<AlertDialogViewport>
					<AlertDialogPopup
						initialFocus={false}
						className="w-[calc(100vw-2rem)] max-w-120 gap-0 overflow-hidden"
						data-testid="design-conflict-dialog"
					>
						<div className="flex items-center gap-2 px-4 py-3">
							<GitMerge
								className="size-4 shrink-0 text-cyan-600"
								aria-hidden="true"
							/>
							<AlertDialogTitle className="p-0 text-sm font-medium text-slate-900">
								Changed here and on disk
							</AlertDialogTitle>
						</div>
						<Separator />
						<AlertDialogDescription className="m-0 px-4 py-3 text-sm leading-relaxed text-slate-700">
							Everything else merged on its own. For each part below, take the
							version on disk (your edits to it are dropped) or keep yours (it
							is saved over the version on disk).
						</AlertDialogDescription>
						<ul className="flex max-h-80 flex-col overflow-y-auto border-t border-slate-200">
							{parts.map((part) => (
								<li
									key={part.key}
									className="flex items-center gap-3 border-b border-slate-200 px-4 py-2"
									data-conflict-part={part.key}
								>
									<div className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="truncate text-xs font-medium text-slate-900">
											{part.title}
										</span>
										<span className="text-xs text-slate-600">
											{part.detail}
										</span>
										{part.layers ? (
											<span className="truncate font-mono text-[11px] text-cyan-700">
												{part.layers}
											</span>
										) : null}
									</div>
									<Segmented
										ariaLabel={`Resolve ${part.title}`}
										options={choiceOptions}
										value={choices[part.key] ?? null}
										onChange={(choice) =>
											setChoices((current) => {
												const next = { ...current };
												if (choice) {
													next[part.key] = choice;
												} else {
													delete next[part.key];
												}
												return next;
											})
										}
										className="w-44 shrink-0"
									/>
								</li>
							))}
						</ul>
						<div className="flex items-center gap-2 px-4 py-3">
							<Button
								type="button"
								variant="ghost"
								className="px-2 py-1 text-xs"
								onClick={() => chooseAll("theirs")}
							>
								All theirs
							</Button>
							<Button
								type="button"
								variant="ghost"
								className="px-2 py-1 text-xs"
								onClick={() => chooseAll("mine")}
							>
								All mine
							</Button>
							<Button
								type="button"
								variant="filled"
								className="ml-auto px-3 py-1 text-xs"
								disabled={!allChosen}
								onClick={apply}
							>
								Apply
							</Button>
						</div>
					</AlertDialogPopup>
				</AlertDialogViewport>
			</AlertDialogPortal>
		</AlertDialog>
	);
}
