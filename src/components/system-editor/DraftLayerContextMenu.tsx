import { ContextMenu } from "@base-ui/react/context-menu";
import { tv } from "tailwind-variants";
import { deleteTemplateNode } from "../../stores/component-draft-store";

const contextMenu = tv({
	slots: {
		trigger: "select-none",
		positioner: "outline-hidden",
		popup:
			"min-w-25 origin-[var(--transform-origin)] transition-[opacity] data-[ending-style]:opacity-0 shadow-lg shadow-slate-500/10 bg-slate-50 text-slate-950 inset-shadow-[0_0_0_1px] inset-shadow-slate-200",
		item: "flex max-w-56 cursor-default p-1 text-xs outline-hidden select-none data-[disabled]:opacity-50 data-[highlighted]:bg-slate-200 data-[highlighted]:active:text-cyan-500 data-[highlighted]:active:bg-cyan-50",
	},
});

const { trigger, positioner, popup, item } = contextMenu();

type DraftLayerContextMenuProps = ContextMenu.Trigger.Props & {
	path: string;
};

function DraftLayerContextMenu({
	path,
	className,
	...props
}: DraftLayerContextMenuProps) {
	return (
		<ContextMenu.Root>
			<ContextMenu.Trigger
				data-slot="context-menu-trigger"
				className={trigger({ className })}
				{...props}
			/>
			<ContextMenu.Portal>
				<ContextMenu.Positioner className={positioner()}>
					<ContextMenu.Popup className={popup()}>
						<ContextMenu.Item
							className={item()}
							onClick={() => deleteTemplateNode(path)}
						>
							Delete
						</ContextMenu.Item>
					</ContextMenu.Popup>
				</ContextMenu.Positioner>
			</ContextMenu.Portal>
		</ContextMenu.Root>
	);
}

export { DraftLayerContextMenu };
