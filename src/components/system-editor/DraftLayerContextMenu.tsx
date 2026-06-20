import { ContextMenu } from "@base-ui/react/context-menu";
import { deleteTemplateNode } from "../../stores/component-draft-store";
import { contextMenu } from "../ui/context-menu";

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
