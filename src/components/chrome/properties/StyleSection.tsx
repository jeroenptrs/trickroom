import { useSelector } from "@tanstack/react-store";
import { Plus } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { designStore } from "../../../stores/design-store";
import { Button } from "../../ui/button";
import { Chip } from "../../ui/chip";
import {
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
	CommandRoot,
} from "../../ui/command";
import {
	Disclosure,
	DisclosurePanel,
	DisclosureSummary,
	DisclosureTrigger,
} from "../../ui/disclosure";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import {
	hiddenSectionRows,
	SectionRevealedContext,
	type SectionRowInfo,
	type SectionRowsRegistry,
	SectionRowsRegistryContext,
	useRevealedRows,
} from "./styleSectionRows";

type StyleSectionProps = {
	title: string;
	/** Collapsed-header rollup, rendered as one chip per item (a plain string
	 * becomes a single chip). */
	summary?: readonly string[] | string | null;
	defaultOpen?: boolean;
	children: ReactNode;
};

/**
 * Collapsible Style-tab section shell (right-rail P1): a Disclosure whose
 * collapsed header rolls the section's set values up as chips, and whose body
 * hosts the set-only row registry — rows registered via `useSectionRow` hide
 * while unset, and resurface through dashed likely-next ghost chips or the
 * add-property menu at the bottom of the open section. Revealed-but-unset
 * rows stay revealed until the section unmounts. The dividing rules between
 * sections come from the parent container's `divide-y`.
 */
export function StyleSection({
	title,
	summary,
	defaultOpen = true,
	children,
}: StyleSectionProps) {
	const [rows, setRows] = useState<ReadonlyMap<string, SectionRowInfo | null>>(
		new Map(),
	);
	const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());

	// Revealed-but-unset rows are scoped to the inspected element; selecting
	// another element starts the section quiet again.
	const selectedId = useSelector(designStore, (state) => state.selectedId);
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedId is the reset trigger, not an input.
	useEffect(() => {
		setRevealed((prev) => (prev.size === 0 ? prev : new Set<string>()));
	}, [selectedId]);

	const mount = useCallback((id: string) => {
		setRows((prev) => (prev.has(id) ? prev : new Map(prev).set(id, null)));
		return () => {
			setRows((prev) => {
				if (!prev.has(id)) return prev;
				const next = new Map(prev);
				next.delete(id);
				return next;
			});
		};
	}, []);

	const update = useCallback((info: SectionRowInfo) => {
		setRows((prev) => {
			const current = prev.get(info.id);
			if (
				current &&
				current.label === info.label &&
				current.isSet === info.isSet &&
				current.likely === info.likely
			) {
				return prev;
			}
			// Map.set on an existing key keeps its position, so registration
			// order (= render order) survives info updates.
			return new Map(prev).set(info.id, info);
		});
	}, []);

	const reveal = useCallback((id: string) => {
		setRevealed((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
	}, []);

	const registry = useMemo<SectionRowsRegistry>(
		() => ({ mount, update, reveal }),
		[mount, update, reveal],
	);

	const summaryItems =
		typeof summary === "string" ? [summary] : (summary ?? []);
	const hidden = hiddenSectionRows(rows, revealed);

	return (
		<Disclosure defaultOpen={defaultOpen}>
			<DisclosureTrigger>
				{title}
				{summaryItems.length > 0 ? (
					<DisclosureSummary>
						{summaryItems.map((item) => (
							<Chip key={item} className="shrink-0 px-1 py-0 text-[10px]">
								{item}
							</Chip>
						))}
					</DisclosureSummary>
				) : null}
			</DisclosureTrigger>
			<DisclosurePanel>
				<SectionRowsRegistryContext.Provider value={registry}>
					<SectionRevealedContext.Provider value={revealed}>
						{children}
						<AddPropertyRow hidden={hidden} onReveal={reveal} />
					</SectionRevealedContext.Provider>
				</SectionRowsRegistryContext.Provider>
			</DisclosurePanel>
		</Disclosure>
	);
}

/**
 * Sub-group label inside a section (e.g. "Flex child") that hides itself when
 * none of its rows are visible. `anySet` comes from the section's own model
 * read; the revealed set is read from context, so this must render inside the
 * section's children.
 */
export function SectionGroupLabel({
	label,
	ids,
	anySet,
}: {
	label: string;
	ids: readonly string[];
	anySet: boolean;
}) {
	const revealed = useRevealedRows();
	const visible = anySet || ids.some((id) => revealed.has(id));
	if (!visible) return null;
	return <span className="px-0.5 text-[10px] text-slate-400">{label}</span>;
}

function AddPropertyRow({
	hidden,
	onReveal,
}: {
	hidden: readonly SectionRowInfo[];
	onReveal: (id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	if (hidden.length === 0) return null;
	const ghosts = hidden.filter((row) => row.likely);

	return (
		<div className="flex flex-wrap items-center gap-1">
			{ghosts.map((row) => (
				<button
					key={row.id}
					type="button"
					onClick={() => onReveal(row.id)}
					aria-label={`Add ${row.label}`}
					className="focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"
				>
					<Chip
						tone="ghost"
						className="text-[10px] hover:border-slate-400 hover:text-slate-600"
					>
						{row.label}
					</Chip>
				</button>
			))}
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger
					render={(props, { open: isOpen }) => (
						<Button
							{...props}
							variant="block"
							isSelected={isOpen}
							className="p-0.5"
							aria-label="Add property"
							title="Add property"
						/>
					)}
				>
					<Plus className="size-3 text-slate-900" />
				</PopoverTrigger>
				<PopoverContent align="start" className="w-56 p-0">
					<CommandRoot size="compact">
						<CommandInput autoFocus placeholder="Add property…" />
						<CommandList>
							<CommandEmpty>No properties found.</CommandEmpty>
							{hidden.map((row) => (
								<CommandItem
									key={row.id}
									value={row.label}
									onSelect={() => {
										onReveal(row.id);
										setOpen(false);
									}}
								>
									{row.label}
								</CommandItem>
							))}
						</CommandList>
					</CommandRoot>
				</PopoverContent>
			</Popover>
		</div>
	);
}
