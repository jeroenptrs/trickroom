import { Save, X } from "lucide-react";
import { useState } from "react";
import type {
	MemoryCategory,
	MemoryNote,
} from "../../../utils/memory-manifest-service.types";
import { Alert } from "../../ui/alert";
import { Button } from "../../ui/button";
import Checkbox from "../../ui/checkbox";
import { Field } from "../../ui/field";
import { Input, TextareaField } from "../../ui/input";
import { Segmented } from "../../ui/segmented";
import { Text } from "../../ui/text";
import { MEMORY_CATEGORY_OPTIONS } from "./memory-category-meta";
import { parseMemoryNoteTags } from "./memory-note-utils";

export type MemoryNoteDraft = {
	title: string;
	category: MemoryCategory;
	body: string;
	tags: string[];
	pinned: boolean;
};

export function MemoryNoteEditor({
	note,
	isSubmitting,
	error,
	onSubmit,
	onCancel,
}: {
	note?: MemoryNote;
	isSubmitting: boolean;
	error?: string | null;
	onSubmit: (draft: MemoryNoteDraft) => void;
	onCancel: () => void;
}) {
	const [title, setTitle] = useState(note?.title ?? "");
	const [category, setCategory] = useState<MemoryCategory>(
		note?.category ?? "intent",
	);
	const [body, setBody] = useState(note?.body ?? "");
	const [tags, setTags] = useState((note?.tags ?? []).join(", "));
	const [pinned, setPinned] = useState(note?.pinned ?? false);

	const submitDisabled = isSubmitting || body.trim().length === 0;

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

			<TextareaField
				label="Body"
				variant="formCompact"
				value={body}
				placeholder="Markdown. Reference with {{design:id}}, {{component:id}}, {{token:domain/name}}, {{asset:id}}, {{icon:id}}."
				onChange={(event) => setBody(event.target.value)}
				disabled={isSubmitting}
				className="min-h-32"
			/>

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
