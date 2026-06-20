import { Dialog as BaseUiDialog } from "@base-ui/react/dialog";
import { useKeyHold } from "@tanstack/react-hotkeys";
import {
	Blocks,
	Box,
	ChevronRight,
	Frame,
	Library,
	Package,
	Plus,
	Repeat2,
	Type,
} from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { availableRegistries, type RegistryId } from "../../libraries/registry";
import {
	getShortcutPlacementIntent,
	type ShortcutPlacementIntent,
} from "../../utils/editor-shortcuts";
import {
	CommandEmpty,
	CommandFooter,
	CommandFooterHint,
	CommandFooterLeft,
	CommandFooterRight,
	CommandGroup,
	CommandGroupLabel,
	CommandInput,
	CommandItem,
	CommandKeyBadge,
	CommandList,
	CommandRoot,
} from "../ui/command";
import {
	getRegistryPickerSections,
	getUserComponentPickerSections,
	type LayerInsertion,
	type PickerItem,
} from "./useLayerInsertion";

export type EditorCommandPage = "root" | "home" | "libraries";

const LIBRARY_IDS = availableRegistries.filter(
	(library): library is RegistryId => library !== "trickroom",
);

const SLOT_DISABLED_REASON = "This recipe slot does not allow that child";

type AddLayerCommandMenuProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Current page; controlled by the parent so shortcuts can deep-link. */
	page: EditorCommandPage;
	onPageChange: (page: EditorCommandPage) => void;
	/** Placement intent captured when the menu was opened (modifier-driven). */
	intent: ShortcutPlacementIntent;
	insertion: LayerInsertion;
};

function ItemRow({
	value,
	keywords,
	icon,
	label,
	secondary,
	shortcut,
	disabled,
	disabledReason,
	onSelect,
}: {
	value: string;
	keywords?: string[];
	icon: ReactNode;
	label: string;
	secondary?: string | null;
	shortcut?: ReactNode;
	disabled?: boolean;
	disabledReason?: string;
	onSelect: () => void;
}) {
	return (
		<CommandItem
			value={value}
			keywords={keywords}
			disabled={disabled}
			title={disabled ? disabledReason : undefined}
			onSelect={onSelect}
		>
			{icon}
			<span className="flex min-w-0 flex-1 flex-col">
				<span data-item-name="" className="truncate text-sm">
					{label}
				</span>
				{secondary ? (
					<span
						data-item-secondary=""
						className="truncate font-mono text-[10px] text-slate-500"
					>
						{secondary}
					</span>
				) : null}
			</span>
			{shortcut ? (
				<span
					data-item-secondary=""
					className="shrink-0 font-mono text-[10px] text-slate-400"
				>
					{shortcut}
				</span>
			) : null}
		</CommandItem>
	);
}

/**
 * Trickroom builtins for the menu, minus container/text which are offered as
 * fast primitives in the Insert group (so each element appears exactly once).
 */
export function getTrickroomBuiltinMenuItems(): {
	components: PickerItem[];
	recipes: PickerItem[];
} {
	const sections = getRegistryPickerSections("trickroom", "");
	const components =
		sections
			.find((section) => section.title === "Components")
			?.items.filter(
				(item) =>
					item.type !== "component" ||
					(item.component !== "container" && item.component !== "text"),
			) ?? [];
	const recipes =
		sections.find((section) => section.title === "Recipes")?.items ?? [];
	return { components, recipes };
}

function pickerItemMeta(item: PickerItem) {
	if (item.type === "component") {
		const controlKeys = item.definition.controls
			? Object.keys(item.definition.controls)
			: [];
		return {
			value: `component:${item.component}`,
			keywords: [
				item.definition.label,
				item.component,
				item.definition.role,
				item.definition.description ?? "",
			],
			label: item.definition.label,
			secondary:
				controlKeys.length > 0
					? `${item.definition.role} · ${controlKeys.join(", ")}`
					: item.definition.role,
			icon: (
				<Box className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
			),
		};
	}

	return {
		value: `recipe:${item.recipe}`,
		keywords: [
			item.definition.label,
			item.recipe,
			"recipe",
			item.definition.description ?? "",
		],
		label: item.definition.label,
		secondary: "recipe",
		icon: (
			<Blocks className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
		),
	};
}

export function AddLayerCommandMenu({
	open,
	onOpenChange,
	page,
	onPageChange,
	intent,
	insertion,
}: AddLayerCommandMenuProps) {
	const [keyboardSelectionActive, setKeyboardSelectionActive] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const isAltPressed = useKeyHold("Alt");
	const isShiftPressed = useKeyHold("Shift");
	const effectiveIntent: ShortcutPlacementIntent =
		isAltPressed || isShiftPressed
			? getShortcutPlacementIntent({
					altKey: isAltPressed,
					shiftKey: isShiftPressed,
				})
			: intent;

	const canInsertHere = insertion.canInsert(effectiveIntent);
	const { lastAddedRef } = insertion;

	// Refocus the search input whenever the menu opens or changes page (the
	// CommandRoot remount on page change drops focus otherwise).
	// biome-ignore lint/correctness/useExhaustiveDependencies: page is a trigger; its remount is what drops focus.
	useEffect(() => {
		if (!open) return;
		const id = setTimeout(() => inputRef.current?.focus(), 0);
		return () => clearTimeout(id);
	}, [open, page]);

	const close = () => onOpenChange(false);

	const handleMenuKeyDown = (event: ReactKeyboardEvent) => {
		if (
			event.key === "ArrowDown" ||
			event.key === "ArrowUp" ||
			event.key === "Home" ||
			event.key === "End"
		) {
			setKeyboardSelectionActive(true);
		}

		// Escape pops one page deeper → shallower; on the root page it closes.
		if (event.key !== "Escape" || page === "root") {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		onPageChange(page === "libraries" ? "home" : "root");
	};

	const userSections = getUserComponentPickerSections(
		insertion.systemComponents,
		"",
	);
	const { components: builtinComponents, recipes: builtinRecipes } =
		getTrickroomBuiltinMenuItems();

	const addPickerItem = (item: PickerItem, library: RegistryId) => {
		const added =
			item.type === "component"
				? insertion.addComponent(
						{ library, component: item.component },
						effectiveIntent,
					)
				: insertion.addRecipe(
						{ library, recipe: item.recipe },
						effectiveIntent,
					);
		if (added) {
			close();
		}
	};

	const renderPickerItem = (item: PickerItem, library: RegistryId) => {
		const meta = pickerItemMeta(item);
		const allowed = insertion.isItemAllowed(item, library, effectiveIntent);
		return (
			<ItemRow
				key={`${library}:${meta.value}`}
				value={`${library}:${meta.value}`}
				keywords={meta.keywords}
				icon={meta.icon}
				label={meta.label}
				secondary={meta.secondary}
				disabled={!allowed}
				disabledReason={SLOT_DISABLED_REASON}
				onSelect={() => addPickerItem(item, library)}
			/>
		);
	};

	const lastAddedLabel = lastAddedRef
		? lastAddedRef.type === "component"
			? lastAddedRef.component
			: lastAddedRef.recipe
		: null;

	return (
		<BaseUiDialog.Root open={open} onOpenChange={onOpenChange}>
			<BaseUiDialog.Portal>
				<BaseUiDialog.Backdrop className="fixed inset-0 bg-slate-950/70 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
				<BaseUiDialog.Popup
					data-shortcuts-disabled=""
					aria-label={page === "root" ? "Command menu" : "Add layer"}
					initialFocus={inputRef}
					onKeyDownCapture={handleMenuKeyDown}
					className="fixed top-24 left-1/2 z-20 w-[640px] -translate-x-1/2 shadow-2xl outline-none transition-all duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
				>
					{/* Key remounts CommandRoot to clear search on page change. */}
					<CommandRoot
						key={`${open}-${page}`}
						loop
						disablePointerSelection
						data-keyboard-selection={keyboardSelectionActive}
					>
						<CommandInput
							ref={inputRef}
							placeholder={
								page === "root"
									? "Search commands…"
									: page === "libraries"
										? "Search library elements…"
										: "Search elements to add…"
							}
						/>

						<CommandList>
							<CommandEmpty>
								{page === "root"
									? "No matching commands."
									: "No matching elements."}
							</CommandEmpty>

							{page === "root" ? (
								<CommandGroup>
									<CommandGroupLabel>Insert</CommandGroupLabel>
									<ItemRow
										value="root:add-layer"
										keywords={[
											"add",
											"layer",
											"element",
											"component",
											"recipe",
										]}
										icon={
											<Plus
												className="size-4 shrink-0 text-slate-500"
												aria-hidden="true"
											/>
										}
										label="Add layer…"
										shortcut="A"
										onSelect={() => onPageChange("home")}
									/>
								</CommandGroup>
							) : page === "home" ? (
								<>
									<CommandGroup>
										<CommandGroupLabel>Insert</CommandGroupLabel>
										<ItemRow
											value="insert:container"
											keywords={["container", "frame", "box", "div"]}
											icon={
												<Frame
													className="size-4 shrink-0 text-slate-500"
													aria-hidden="true"
												/>
											}
											label="Container"
											shortcut="F"
											disabled={!canInsertHere}
											disabledReason="Cannot insert here"
											onSelect={() => {
												if (
													insertion.addBasicLayer("container", effectiveIntent)
												) {
													close();
												}
											}}
										/>
										<ItemRow
											value="insert:text"
											keywords={["text", "label", "type", "paragraph"]}
											icon={
												<Type
													className="size-4 shrink-0 text-slate-500"
													aria-hidden="true"
												/>
											}
											label="Text"
											shortcut="T"
											disabled={!canInsertHere}
											disabledReason="Cannot insert here"
											onSelect={() => {
												if (insertion.addBasicLayer("text", effectiveIntent)) {
													close();
												}
											}}
										/>
										{lastAddedRef ? (
											<ItemRow
												value="insert:repeat"
												keywords={["repeat", "last", lastAddedLabel ?? ""]}
												icon={
													<Repeat2
														className="size-4 shrink-0 text-slate-500"
														aria-hidden="true"
													/>
												}
												label={`Repeat ${lastAddedLabel}`}
												shortcut="."
												disabled={!canInsertHere}
												disabledReason="Cannot insert here"
												onSelect={() => {
													if (insertion.repeatLast(effectiveIntent)) {
														close();
													}
												}}
											/>
										) : null}
									</CommandGroup>

									{userSections.map((section) => (
										<CommandGroup
											key={`user:${section.groupPath || "ungrouped"}`}
										>
											<CommandGroupLabel>
												{section.groupPath
													? `Your system · ${section.groupPath}`
													: "Your system"}
											</CommandGroupLabel>
											{section.items.map((item) => {
												const allowed = Boolean(
													insertion.systemId && item.component.currentVersion,
												);
												return (
													<ItemRow
														key={`system-component:${item.component.componentId}`}
														value={`system-component:${item.component.componentId}`}
														keywords={[
															item.component.name,
															item.component.slug,
															item.component.group ?? "",
															item.component.description ?? "",
														]}
														icon={
															<Package
																className="size-4 shrink-0 text-slate-500"
																aria-hidden="true"
															/>
														}
														label={item.component.name}
														secondary={`${item.component.slug} · v${item.component.currentVersion}`}
														disabled={!allowed || !canInsertHere}
														disabledReason={SLOT_DISABLED_REASON}
														onSelect={() => {
															void insertion
																.addSystemComponent(
																	item.component,
																	effectiveIntent,
																)
																.then((added) => {
																	if (added) {
																		close();
																	}
																});
														}}
													/>
												);
											})}
										</CommandGroup>
									))}

									{builtinComponents.length > 0 || builtinRecipes.length > 0 ? (
										<CommandGroup>
											<CommandGroupLabel>Trickroom builtins</CommandGroupLabel>
											{builtinComponents.map((item) =>
												renderPickerItem(item, "trickroom"),
											)}
											{builtinRecipes.map((item) =>
												renderPickerItem(item, "trickroom"),
											)}
										</CommandGroup>
									) : null}

									<CommandGroup>
										<CommandGroupLabel>Libraries</CommandGroupLabel>
										<ItemRow
											value="browse:libraries"
											keywords={["libraries", "library", "base-ui", "elements"]}
											icon={
												<Library
													className="size-4 shrink-0 text-slate-500"
													aria-hidden="true"
												/>
											}
											label="Browse all libraries…"
											shortcut={
												<ChevronRight
													className="size-3.5 shrink-0 text-slate-400"
													aria-hidden="true"
												/>
											}
											onSelect={() => onPageChange("libraries")}
										/>
									</CommandGroup>
								</>
							) : (
								LIBRARY_IDS.map((library) => {
									const sections = getRegistryPickerSections(library, "");
									return sections.map((section) =>
										section.items.length > 0 ? (
											<CommandGroup key={`${library}:${section.title}`}>
												<CommandGroupLabel>
													{library} · {section.title}
												</CommandGroupLabel>
												{section.items.map((item) =>
													renderPickerItem(item, library),
												)}
											</CommandGroup>
										) : null,
									);
								})
							)}
						</CommandList>

						<CommandFooter>
							<CommandFooterLeft>
								<CommandFooterHint>
									<CommandKeyBadge>↑↓</CommandKeyBadge>
									<span>navigate</span>
								</CommandFooterHint>
								<CommandFooterHint>
									<CommandKeyBadge>↵</CommandKeyBadge>
									<span>insert</span>
								</CommandFooterHint>
								<CommandFooterHint>
									<CommandKeyBadge>esc</CommandKeyBadge>
									<span>{page === "root" ? "close" : "back"}</span>
								</CommandFooterHint>
							</CommandFooterLeft>
							{page === "root" ? null : (
								<CommandFooterRight>
									<span>Insert {effectiveIntent}</span>
								</CommandFooterRight>
							)}
						</CommandFooter>
					</CommandRoot>
				</BaseUiDialog.Popup>
			</BaseUiDialog.Portal>
		</BaseUiDialog.Root>
	);
}
