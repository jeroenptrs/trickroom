import { ContextMenu } from "@base-ui/react/context-menu";
import { tv } from "tailwind-variants";
import { deleteElement } from "../../stores/design-store";

const contextMenu = tv({
	slots: {
		trigger: "select-none",
		positioner: "outline-hidden",
		popup:
			"min-w-25 origin-[var(--transform-origin)] transition-[opacity] data-[ending-style]:opacity-0 shadow-lg shadow-gray-500/10 bg-gray-50 text-gray-900 inset-shadow-[0_0_0_1px] inset-shadow-gray-200",
		item: "flex cursor-default p-1 text-xs outline-hidden select-none data-[highlighted]:text-gray-50 data-highlighted:bg-blue-500",
	},
});

const { trigger, positioner, popup, item } = contextMenu();

function LayerContextMenu({
	id,
	className,
	...props
}: ContextMenu.Trigger.Props & { className?: string; id: string }) {
	return (
		<ContextMenu.Root>
			<ContextMenu.Trigger
				id={id}
				data-slot="context-menu-trigger"
				className={trigger({ className })}
				{...props}
			/>
			<ContextMenu.Portal>
				<ContextMenu.Positioner className={positioner()}>
					<ContextMenu.Popup className={popup()}>
						<ContextMenu.Item
							className={item()}
							onClick={() => deleteElement(id)}
						>
							Delete
						</ContextMenu.Item>
					</ContextMenu.Popup>
				</ContextMenu.Positioner>
			</ContextMenu.Portal>
		</ContextMenu.Root>
	);
}

export { LayerContextMenu };
