import { Save, X } from "lucide-react";
import { useRef, useState } from "react";
import type {
	MemoryCategory,
	MemoryNote,
} from "../../../utils/memory-manifest-service.types";
import type { MemoryReferenceType } from "../../../utils/memory-references.shared";
import {
	type MemoryQueryScope,
} from "../../../queries/memory";
import type { ProjectQueryScope } from "../../../queries/project-scope";
import { Alert } from "../../ui/alert";
import { Button } from "../../ui/button";
import Checkbox from "../../ui/checkbox";
import { Field } from "../../ui/field";
import { Input } from "../../ui/input";
import { Segmented } from "../../ui/segmented";
import { Text } from "../../ui/text";
import { MEMORY_CATEGORY_OPTIONS } from "./memory-category-meta";
import { parseMemoryNoteTags } from "./memory-note-utils";
import {
	detectActiveReferenceTrigger,
	formatMemoryReferenceToken,
	insertMemoryReferenceToken,
} from "./memory-reference-editor";
import { MemoryReferenceSuggest } from "./MemoryReferenceSuggest";

export type MemoryNoteDraft = {
	title: string;
	category: MemoryCategory;
	body: string;
	tags: string[];
	pinned: boolean;
};

export function MemoryNoteEditor({
	note,
	scope,
	projectScope,
	isSubmitting,
	error,
	onSubmit,
	onCancel,
}: {
	note?: MemoryNote;
	scope: MemoryQueryScope;
	projectScope?: ProjectQueryScope;
	isSubmitting: boolean;
	error?: string | null;
	onSubmit: (draft: MemoryNoteDraft) => void;
	onCancel: () => void;
}) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [title, setTitle] = useState(note?.title ?? "");
	const [category, setCategory] = useState<MemoryCategory>(
		note?.category ?? "intent",
	);
	const [body, setBody] = useState(note?.body ?? "");
	const [tags, setTags] = useState((note?.tags ?? []).join(", "));
	const [pinned, setPinned] = useState(note?.pinned ?? false);
	const [cursor, setCursor] = useState(0);

	const submitDisabled = isSubmitting || body.trim().length === 0;
	const trigger = detectActiveReferenceTrigger(body, cursor);

	const syncCursor = () => {
		const nextCursor = textareaRef.current?.selectionStart ?? 0;
		setCursor(nextCursor);
	};

	const applyBodyEdit = (nextBody: string, nextCursor: number) => {
		setBody(nextBody);
		setCursor(nextCursor);
		requestAnimationFrame(() => {
			const textarea = textareaRef.current;
			if (!textarea) {
				return;
			}
			textarea.focus();
			textarea.setSelectionRange(nextCursor, nextCursor);
		});
	};

	const pickType = (type: MemoryReferenceType) => {
		if (!trigger) {
			return;
		}
		const token = `{{${type}:`;
		const { nextBody, nextCursor } = insertMemoryReferenceToken(
			body,
			trigger,
			token,
		);
		applyBodyEdit(nextBody, nextCursor);
	};

	const pickTarget = (type: MemoryReferenceType, id: string) => {
		if (!trigger || trigger.kind !== "targets") {
			return;
		}
		const token = formatMemoryReferenceToken(type, id);
		const { nextBody, nextCursor } = insertMemoryReferenceToken(
			body,
			trigger,
			token,
		);
		applyBodyEdit(nextBody, nextCursor);
	};

	const submit = () => {
		if (submitDisabled) {
			return;
		}
		onSubmit({
			title: title.trim(),
			category,
			body: body.trim(),
			tags: parseMemoryNoteTags(tags),
			pinned,
		});
	};

	return (
		<div className="flex flex-col gap-3 bg-white p-4 inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
			<Text variant="subtitle">{note ? "Edit note" : "New note"}</Text>

			{error ? (
				<Alert variant="panel" tone="danger">
					{error}
				</Alert>
			) : null}

			<Field label="Category">
				<Segmented
					ariaLabel="Note category"
					className="flex-wrap"
					options={MEMORY_CATEGORY_OPTIONS}
					value={category}
					onChange={(next) => setCategory(next ?? category)}
				/>
			</Field>

			<Field label="Title" description="Optional short heading.">
				<Input
					variant="formCompact"
					value={title}
					placeholder="e.g. Spacing scale rationale"
					onChange={(event) => setTitle(event.target.value)}
					disabled={isSubmitting}
				/>
			</Field>

			<Field
				label="Body"
				description="Markdown. Type {{ to insert design, component, token, asset, or icon references."
			>
				<div className="relative">
					<textarea
						ref={textareaRef}
						data-slot="field-control"
						value={body}
						placeholder="Markdown body…"
						onChange={(event) => {
							setBody(event.target.value);
							setCursor(event.target.selectionStart ?? 0);
						}}
						onClick={syncCursor}
						onKeyUp={syncCursor}
						onSelect={syncCursor}
						disabled={isSubmitting}
						className="min-h-32 w-full rounded-none border-none bg-white px-2 py-1.5 text-sm text-slate-950 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 placeholder:text-slate-500 focus-visible:inset-shadow-cyan-500 focus-visible:outline-none disabled:opacity-50"
					/>
					{trigger ? (
						<MemoryReferenceSuggest
							trigger={trigger}
							scope={scope}
							projectScope={projectScope}
							onPickType={pickType}
							onPickTarget={pickTarget}
						/>
					) : null}
				</div>
			</Field>

			<Field label="Tags" description="Comma-separated.">
				<Input
					variant="formCompact"
					value={tags}
					placeholder="layout, spacing"
					onChange={(event) => setTags(event.target.value)}
					disabled={isSubmitting}
				/>
			</Field>

			<label htmlFor="memory-note-pinned" className="flex items-center gap-2">
				<Checkbox
					id="memory-note-pinned"
					checked={pinned}
					onCheckedChange={(checked) => setPinned(checked === true)}
					disabled={isSubmitting}
				/>
				<Text variant="label" tone="foreground">
					Pin to top
				</Text>
			</label>

			<div className="flex items-center justify-end gap-2 pt-1">
				<Button
					variant="ghost"
					className="flex items-center gap-1.5"
					onClick={onCancel}
					disabled={isSubmitting}
				>
					<X className="size-3.5" aria-hidden="true" />
					Cancel
				</Button>
				<Button
					variant="filled"
					className="flex items-center gap-1.5"
					onClick={submit}
					disabled={submitDisabled}
				>
					<Save className="size-3.5" aria-hidden="true" />
					{isSubmitting ? "Saving..." : note ? "Save changes" : "Add note"}
				</Button>
			</div>
		</div>
	);
}
