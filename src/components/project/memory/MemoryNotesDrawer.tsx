import { X } from "lucide-react";
import type { MemoryQueryScope } from "../../../queries/memory";
import type { ProjectQueryScope } from "../../../queries/project-scope";
import { Button } from "../../ui/button";
import { Sheet, SheetClose, SheetContent } from "../../ui/sheet";
import { Text } from "../../ui/text";
import { MemoryNotesPanel } from "./MemoryNotesPanel";

export function MemoryNotesDrawer({
	open,
	onOpenChange,
	scope,
	projectScope,
	title,
	subtitle,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	scope: MemoryQueryScope;
	projectScope?: ProjectQueryScope;
	title: string;
	subtitle?: string;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent aria-label={title}>
				<div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
					<div className="flex min-w-0 flex-col">
						<Text variant="eyebrow">Memory</Text>
						<Text variant="title" className="truncate text-base">
							{title}
						</Text>
						{subtitle ? (
							<Text tone="faint" className="truncate font-mono text-[11px]">
								{subtitle}
							</Text>
						) : null}
					</div>
					<SheetClose
						render={
							<Button
								variant="ghost"
								className="p-1.5"
								aria-label="Close memory drawer"
							>
								<X className="size-4" aria-hidden="true" />
							</Button>
						}
					/>
				</div>
				<div className="min-h-0 flex-1">
					<MemoryNotesPanel scope={scope} projectScope={projectScope} />
				</div>
			</SheetContent>
		</Sheet>
	);
}
