import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NotebookPen, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
	createMemoryNote,
	deleteMemoryNote,
	invalidateMemory,
	type MemoryQueryScope,
	type MemoryWriteResponse,
	memoryQueryOptions,
	updateMemoryNote,
} from "../../../queries/memory";
import type { ProjectQueryScope } from "../../../queries/project-scope";
import type { MemoryNote } from "../../../utils/memory-manifest-service.types";
import { Alert } from "../../ui/alert";
import { ConfirmationDialog } from "../../ui/alert-dialog";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Chip } from "../../ui/chip";
import { EmptyState } from "../../ui/empty-state";
import { ScrollArea } from "../../ui/scroll-area";
import { Text } from "../../ui/text";
import { type MemoryNoteDraft, MemoryNoteEditor } from "./MemoryNoteEditor";
import { MEMORY_CATEGORY_META } from "./memory-category-meta";
import { sortMemoryNotes } from "./memory-note-utils";

type ReferenceWarning = { message: string };
type WriteResponse = MemoryWriteResponse & {
	referenceWarnings?: ReferenceWarning[];
};

function NoteCard({
	note,
	onEdit,
	onDelete,
	disabled,
}: {
	note: MemoryNote;
	onEdit: () => void;
	onDelete: () => void;
	disabled: boolean;
}) {
	const meta = MEMORY_CATEGORY_META[note.category];
	return (
		<div className="flex flex-col gap-2 bg-white p-3 inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
			<div className="flex items-start justify-between gap-2">
				<div className="flex min-w-0 flex-wrap items-center gap-1.5">
					<Badge tone={meta.tone} edge="stamped">
						{meta.label}
					</Badge>
					{note.pinned ? (
						<Pin className="size-3 text-cyan-600" aria-label="Pinned" />
					) : null}
					{note.title ? (
						<Text className="truncate text-sm font-medium text-slate-900">
							{note.title}
						</Text>
					) : null}
				</div>
				<div className="flex shrink-0 items-center">
					<Button
						variant="ghost"
						className="p-1.5"
						onClick={onEdit}
						disabled={disabled}
						aria-label="Edit note"
					>
						<Pencil className="size-3.5" aria-hidden="true" />
					</Button>
					<Button
						variant="ghost"
						flavor="warning"
						className="p-1.5"
						onClick={onDelete}
						disabled={disabled}
						aria-label="Delete note"
					>
						<Trash2 className="size-3.5" aria-hidden="true" />
					</Button>
				</div>
			</div>
			<Text className="whitespace-pre-wrap text-xs text-slate-700">
				{note.body}
			</Text>
			{note.tags && note.tags.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{note.tags.map((tag) => (
						<Chip key={tag}>{tag}</Chip>
					))}
				</div>
			) : null}
			<Text tone="faint" className="font-mono text-[10px]">
				{note.author.kind === "agent" ? "agent" : "you"}
				{note.author.label ? ` · ${note.author.label}` : ""}
			</Text>
		</div>
	);
}

export function MemoryNotesPanel({
	scope,
	projectScope,
}: {
	scope: MemoryQueryScope;
	projectScope?: ProjectQueryScope;
}) {
	const queryClient = useQueryClient();
	const memoryQuery = useQuery(memoryQueryOptions(scope, projectScope));
	const [mode, setMode] = useState<"idle" | "create" | { editId: string }>(
		"idle",
	);
	const [deleteTarget, setDeleteTarget] = useState<MemoryNote | null>(null);
	const [warnings, setWarnings] = useState<string[]>([]);

	const revision = memoryQuery.data?.revision;
	const notes = sortMemoryNotes(memoryQuery.data?.notes ?? []);

	const afterWrite = async (response: WriteResponse | undefined) => {
		setWarnings((response?.referenceWarnings ?? []).map((w) => w.message));
		await invalidateMemory(queryClient, scope, projectScope);
		setMode("idle");
	};

	const createMutation = useMutation({
		mutationFn: (draft: MemoryNoteDraft) =>
			createMemoryNote(scope, {
				body: draft.body,
				category: draft.category,
				...(draft.title ? { title: draft.title } : {}),
				tags: draft.tags,
				pinned: draft.pinned,
				...(revision ? { expectedRevision: revision } : {}),
			}) as Promise<WriteResponse>,
		onSuccess: afterWrite,
	});

	const updateMutation = useMutation({
		mutationFn: ({
			noteId,
			draft,
		}: {
			noteId: string;
			draft: MemoryNoteDraft;
		}) => {
			if (!revision) {
				throw new Error("Memory revision unavailable; reopen the drawer.");
			}
			return updateMemoryNote(scope, noteId, {
				expectedRevision: revision,
				body: draft.body,
				category: draft.category,
				title: draft.title ? draft.title : null,
				tags: draft.tags,
				pinned: draft.pinned,
			}) as Promise<WriteResponse>;
		},
		onSuccess: afterWrite,
	});

	const deleteMutation = useMutation({
		mutationFn: (note: MemoryNote) => {
			if (!revision) {
				throw new Error("Memory revision unavailable; reopen the drawer.");
			}
			return deleteMemoryNote(scope, note.noteId, revision);
		},
		onSuccess: async () => {
			await invalidateMemory(queryClient, scope, projectScope);
			setDeleteTarget(null);
		},
	});

	const isWriting =
		createMutation.isPending ||
		updateMutation.isPending ||
		deleteMutation.isPending;
	const createError =
		createMutation.error instanceof Error ? createMutation.error.message : null;
	const updateError =
		updateMutation.error instanceof Error ? updateMutation.error.message : null;

	const loadError =
		memoryQuery.error instanceof Error ? memoryQuery.error.message : null;

	return (
		<div className="flex h-full min-h-0 flex-col">
			{warnings.length > 0 ? (
				<div className="border-b border-amber-200 bg-amber-50 px-4 py-2">
					<Text variant="label" className="text-amber-800">
						Unresolved references
					</Text>
					<ul className="mt-1 list-disc pl-4">
						{warnings.map((message) => (
							<li key={message}>
								<Text className="text-[11px] text-amber-800">{message}</Text>
							</li>
						))}
					</ul>
				</div>
			) : null}

			<div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
				<Text tone="muted" className="text-xs">
					{notes.length} {notes.length === 1 ? "note" : "notes"}
				</Text>
				<Button
					variant="outlined"
					className="flex items-center gap-1.5"
					onClick={() => {
						setWarnings([]);
						createMutation.reset();
						setMode("create");
					}}
					disabled={mode === "create" || isWriting || memoryQuery.isPending}
				>
					<Plus className="size-3.5" aria-hidden="true" />
					Add note
				</Button>
			</div>

			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col gap-3 p-4">
					{loadError ? (
						<Alert variant="panel" tone="danger">
							{loadError}
						</Alert>
					) : null}

					{mode === "create" ? (
						<MemoryNoteEditor
							isSubmitting={createMutation.isPending}
							error={createError}
							onSubmit={(draft) => createMutation.mutate(draft)}
							onCancel={() => setMode("idle")}
						/>
					) : null}

					{notes.length === 0 && mode !== "create" ? (
						<EmptyState
							size="sm"
							icon={NotebookPen}
							title="No notes yet"
							description="Capture intent, usage, conventions, and decisions for this scope."
						/>
					) : null}

					{notes.map((note) =>
						typeof mode === "object" && mode.editId === note.noteId ? (
							<MemoryNoteEditor
								key={note.noteId}
								note={note}
								isSubmitting={updateMutation.isPending}
								error={updateError}
								onSubmit={(draft) =>
									updateMutation.mutate({ noteId: note.noteId, draft })
								}
								onCancel={() => setMode("idle")}
							/>
						) : (
							<NoteCard
								key={note.noteId}
								note={note}
								disabled={isWriting}
								onEdit={() => {
									setWarnings([]);
									updateMutation.reset();
									setMode({ editId: note.noteId });
								}}
								onDelete={() => setDeleteTarget(note)}
							/>
						),
					)}
				</div>
			</ScrollArea>

			<ConfirmationDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => {
					if (!open && !deleteMutation.isPending) {
						setDeleteTarget(null);
					}
				}}
				title="Delete note"
				description="Delete this memory note? This cannot be undone."
				icon={<Trash2 className="size-4" aria-hidden="true" />}
				actionIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
				actionLabel={deleteMutation.isPending ? "Deleting..." : "Delete"}
				actionDisabled={deleteMutation.isPending}
				tone="destructive"
				onAction={() => {
					if (deleteTarget) {
						deleteMutation.mutate(deleteTarget);
					}
				}}
			/>
		</div>
	);
}
