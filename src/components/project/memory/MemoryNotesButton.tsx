import { useQuery } from "@tanstack/react-query";
import { NotebookPen } from "lucide-react";
import { useState } from "react";
import {
	type MemoryQueryScope,
	memoryQueryOptions,
} from "../../../queries/memory";
import type { ProjectQueryScope } from "../../../queries/project-scope";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { MemoryNotesDrawer } from "./MemoryNotesDrawer";

export function MemoryNotesButton({
	scope,
	projectScope,
	title,
	subtitle,
	label = "Memory",
	variant = "block",
	className,
	disabled,
}: {
	scope: MemoryQueryScope;
	projectScope?: ProjectQueryScope;
	title: string;
	subtitle?: string;
	label?: string;
	variant?: "block" | "outlined" | "ghost" | "filled";
	className?: string;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const memoryQuery = useQuery(memoryQueryOptions(scope, projectScope));
	const count = memoryQuery.data?.summary.noteCount ?? 0;

	return (
		<>
			<Button
				type="button"
				variant={variant}
				className={["flex items-center gap-1.5", className]
					.filter(Boolean)
					.join(" ")}
				onClick={() => setOpen(true)}
				disabled={disabled}
				aria-label={`${label} (${count})`}
			>
				<NotebookPen className="size-4" aria-hidden="true" />
				{label}
				{count > 0 ? (
					<Badge tone="info" edge="stamped">
						{count}
					</Badge>
				) : null}
			</Button>
			<MemoryNotesDrawer
				open={open}
				onOpenChange={setOpen}
				scope={scope}
				projectScope={projectScope}
				title={title}
				subtitle={subtitle}
			/>
		</>
	);
}
