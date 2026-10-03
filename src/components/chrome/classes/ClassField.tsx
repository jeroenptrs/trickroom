import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
	type KeyboardEvent,
	useDeferredValue,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	type TailwindClassInspection,
	tailwindClassCatalogQueryOptions,
	tailwindClassInspectQueryOptions,
} from "../../../queries/tailwind-class-catalog";
import { useProjectScope } from "../../contexts";
import {
	applyClassCompletion,
	type ClassCatalogIndex,
	type ClassCompletion,
	createClassCatalogIndex,
	getClassCompletions,
	getClassFieldCommit,
	getTokenAtCursor,
	getUninspectedClasses,
	replaceClassToken,
	tokenizeClassName,
} from "./classField";

export type ClassFieldHint = {
	token: string;
	message: string;
	tone: "unknown" | "shadowed";
	/** Clicking the hint replaces the token with this (empty string removes it). */
	fix?: { label: string; replacement: string };
};

function useClassCatalogIndex(systemId: string | null) {
	const projectScope = useProjectScope();
	const catalogQuery = useQuery(
		tailwindClassCatalogQueryOptions(systemId, projectScope),
	);
	const data = catalogQuery.data;
	return useMemo<ClassCatalogIndex | null>(
		() => (data ? createClassCatalogIndex(data) : null),
		[data],
	);
}

/**
 * Unknown classes in `value`: tokens the catalog can't vouch for go to the
 * server's Tailwind design system. Results lag typing slightly (deferred) and
 * keep the previous answer while a new one loads, so flags don't flicker.
 */
function useUnknownClasses(
	systemId: string | null,
	index: ClassCatalogIndex | null,
	value: string,
) {
	const projectScope = useProjectScope();
	const deferredValue = useDeferredValue(value);
	const candidates = useMemo(
		() => (index ? getUninspectedClasses(index, deferredValue) : []),
		[index, deferredValue],
	);
	const inspectQuery = useQuery({
		...tailwindClassInspectQueryOptions(systemId, candidates, projectScope),
		enabled: candidates.length > 0,
		placeholderData: keepPreviousData,
	});
	return useMemo(() => {
		const unknown = new Map<string, TailwindClassInspection>();
		if (candidates.length === 0) {
			return unknown;
		}
		for (const result of inspectQuery.data?.results ?? []) {
			if (!result.supported && candidates.includes(result.candidate)) {
				unknown.set(result.candidate, result);
			}
		}
		return unknown;
	}, [candidates, inspectQuery.data]);
}

const FIELD_TEXT =
	"px-2 py-1.5 font-mono text-xs leading-5 whitespace-pre-wrap break-words";

/**
 * Free-text className editor: behaves like editing `className` in code.
 * Wrapping monospace text, commit on blur or Cmd/Ctrl+Enter, Escape reverts.
 * Completes the token at the caret from the project's compiled Tailwind
 * design system and underlines classes Tailwind doesn't recognize.
 */
export function ClassField({
	value,
	onCommit,
	systemId,
	label,
	hints = [],
}: {
	value: string;
	onCommit: (next: string) => void;
	systemId: string | null;
	label: string;
	/** Extra lint lines (e.g. shadowed classes) shown under the unknown ones. */
	hints?: readonly ClassFieldHint[];
}) {
	const listId = useId();
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [draft, setDraft] = useState<string | null>(null);
	const draftRef = useRef<string | null>(null);
	// The stored value when editing began, so an untouched draft never
	// overwrites a change that arrived while the field had focus.
	const baseRef = useRef(value);
	const [cursor, setCursor] = useState(0);
	const [completionOpen, setCompletionOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const index = useClassCatalogIndex(systemId);
	const text = draft ?? value;
	const unknown = useUnknownClasses(systemId, index, text);

	const updateDraft = (next: string | null) => {
		draftRef.current = next;
		setDraft(next);
	};
	const edit = (next: string) => {
		if (draftRef.current === null) baseRef.current = value;
		updateDraft(next);
	};

	const token = useMemo(() => getTokenAtCursor(text, cursor), [text, cursor]);
	const completions = useMemo<ClassCompletion[]>(
		() =>
			completionOpen && index ? getClassCompletions(index, token.value) : [],
		[completionOpen, index, token.value],
	);
	const showCompletions = completions.length > 0;

	// Grow with the content instead of scrolling, so the underline backdrop
	// stays aligned with the text.
	// biome-ignore lint/correctness/useExhaustiveDependencies: text is the re-measure trigger
	useLayoutEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
	}, [text]);

	const commit = () => {
		const current = draftRef.current;
		if (current === null) return;
		const next = getClassFieldCommit(current, baseRef.current);
		if (next !== null) {
			onCommit(next);
		}
	};

	const syncCursor = () => {
		const textarea = textareaRef.current;
		if (textarea) setCursor(textarea.selectionStart);
	};

	const acceptCompletion = (completion: ClassCompletion) => {
		const textarea = textareaRef.current;
		const applied = applyClassCompletion(text, token, completion.value);
		edit(applied.value);
		setCursor(applied.cursor);
		setActiveIndex(0);
		// A variant keeps completing the utility after it; a utility is done.
		setCompletionOpen(completion.kind === "variant");
		requestAnimationFrame(() => {
			textarea?.setSelectionRange(applied.cursor, applied.cursor);
		});
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (showCompletions) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const step = event.key === "ArrowDown" ? 1 : -1;
				setActiveIndex(
					(current) =>
						(current + step + completions.length) % completions.length,
				);
				return;
			}
			if (
				(event.key === "Enter" || event.key === "Tab") &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.shiftKey
			) {
				event.preventDefault();
				const completion = completions[activeIndex] ?? completions[0];
				if (completion) acceptCompletion(completion);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				setCompletionOpen(false);
				return;
			}
		}

		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			commit();
			updateDraft(null);
			setCompletionOpen(false);
			return;
		}
		if (event.key === " " && event.ctrlKey) {
			event.preventDefault();
			setCompletionOpen(true);
			setActiveIndex(0);
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			updateDraft(null);
			setCompletionOpen(false);
			textareaRef.current?.blur();
		}
	};

	const tokens = tokenizeClassName(text);
	const unknownHints: ClassFieldHint[] = [...unknown.values()].map(
		(inspection) => {
			const suggestion = inspection.suggestions?.[0];
			return {
				token: inspection.candidate,
				message: "is not a class in this design system",
				tone: "unknown" as const,
				...(suggestion
					? { fix: { label: suggestion, replacement: suggestion } }
					: {}),
			};
		},
	);
	const allHints = [...unknownHints, ...hints];

	return (
		<div className="flex flex-col gap-1.5">
			<div className="relative bg-white inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-within:inset-shadow-cyan-500">
				{/* Underline layer: same metrics as the textarea, text invisible. */}
				<div
					aria-hidden="true"
					className={`pointer-events-none absolute inset-0 text-transparent ${FIELD_TEXT}`}
				>
					{tokens.length === 0 ? null : (
						<>
							{text.slice(0, tokens[0]?.start ?? 0)}
							{tokens.map((entry, position) => (
								<span key={`${entry.start}:${entry.value}`}>
									<span
										className={
											unknown.has(entry.value)
												? "underline decoration-red-500 decoration-wavy decoration-1 underline-offset-2"
												: undefined
										}
									>
										{entry.value}
									</span>
									{text.slice(
										entry.end,
										tokens[position + 1]?.start ?? text.length,
									)}
								</span>
							))}
						</>
					)}
					{"​"}
				</div>
				<textarea
					ref={textareaRef}
					aria-label={label}
					role="combobox"
					aria-expanded={showCompletions}
					aria-controls={listId}
					aria-autocomplete="list"
					aria-activedescendant={
						showCompletions ? `${listId}-${activeIndex}` : undefined
					}
					spellCheck={false}
					autoCapitalize="off"
					autoComplete="off"
					autoCorrect="off"
					rows={2}
					placeholder="Tailwind classes"
					value={text}
					className={`relative block w-full resize-none overflow-hidden bg-transparent text-slate-950 outline-none placeholder:font-sans placeholder:text-slate-400 ${FIELD_TEXT}`}
					onChange={(event) => {
						edit(event.currentTarget.value);
						setCursor(event.currentTarget.selectionStart);
						setCompletionOpen(true);
						setActiveIndex(0);
					}}
					onSelect={syncCursor}
					onClick={() => setCompletionOpen(false)}
					onKeyDown={handleKeyDown}
					onBlur={() => {
						commit();
						updateDraft(null);
						setCompletionOpen(false);
					}}
				/>
				{showCompletions ? (
					<CompletionList
						anchor={textareaRef.current}
						id={listId}
						completions={completions}
						activeIndex={activeIndex}
						onAccept={acceptCompletion}
						onHover={setActiveIndex}
					/>
				) : null}
			</div>
			{allHints.length > 0 ? (
				<ul className="flex flex-col gap-0.5">
					{allHints.map((hint) => (
						<li
							key={`${hint.token}:${hint.message}`}
							className="flex flex-wrap items-baseline gap-x-1 text-[11px] text-slate-600"
						>
							<span
								className={`font-mono ${
									hint.tone === "unknown" ? "text-red-700" : "text-amber-700"
								}`}
							>
								{hint.token}
							</span>
							<span>{hint.message}</span>
							{hint.fix ? (
								<button
									type="button"
									className="font-mono text-cyan-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => {
										const next = replaceClassToken(
											text,
											hint.token,
											hint.fix?.replacement ?? "",
										);
										if (draftRef.current !== null) {
											edit(next);
										} else {
											const committed = getClassFieldCommit(next, value);
											if (committed !== null) onCommit(committed);
										}
									}}
								>
									{hint.fix.replacement
										? `→ ${hint.fix.label}`
										: hint.fix.label}
								</button>
							) : null}
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

const LIST_MAX_HEIGHT = 240;

/**
 * Completion list, portaled and fixed under the field so the inspector's
 * scroll area never clips it. Focus stays in the textarea throughout.
 */
function CompletionList({
	anchor,
	id,
	completions,
	activeIndex,
	onAccept,
	onHover,
}: {
	anchor: HTMLTextAreaElement | null;
	id: string;
	completions: readonly ClassCompletion[];
	activeIndex: number;
	onAccept: (completion: ClassCompletion) => void;
	onHover: (index: number) => void;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	const [rect, setRect] = useState<DOMRect | null>(null);

	useLayoutEffect(() => {
		if (!anchor) return;
		const update = () => setRect(anchor.getBoundingClientRect());
		update();
		window.addEventListener("scroll", update, true);
		window.addEventListener("resize", update);
		const observer = new ResizeObserver(update);
		observer.observe(anchor);
		return () => {
			window.removeEventListener("scroll", update, true);
			window.removeEventListener("resize", update);
			observer.disconnect();
		};
	}, [anchor]);

	useEffect(() => {
		listRef.current?.children[activeIndex]?.scrollIntoView({
			block: "nearest",
		});
	}, [activeIndex]);

	if (!rect) return null;
	const below = window.innerHeight - rect.bottom;
	const placeAbove = below < LIST_MAX_HEIGHT && rect.top > below;

	return createPortal(
		<div
			ref={listRef}
			id={id}
			role="listbox"
			className="fixed z-50 flex max-h-60 flex-col overflow-y-auto border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10"
			style={{
				left: rect.left,
				width: rect.width,
				...(placeAbove
					? { bottom: window.innerHeight - rect.top + 2 }
					: { top: rect.bottom + 2 }),
			}}
		>
			{completions.map((completion, position) => (
				<button
					key={completion.value}
					type="button"
					tabIndex={-1}
					id={`${id}-${position}`}
					role="option"
					aria-selected={position === activeIndex}
					className={`flex w-full cursor-pointer items-center justify-between gap-2 px-2 py-1 text-left font-mono text-xs ${
						position === activeIndex
							? "bg-cyan-50 text-cyan-900"
							: "text-slate-700"
					}`}
					onMouseDown={(event) => {
						event.preventDefault();
						onAccept(completion);
					}}
					onMouseMove={() => {
						if (position !== activeIndex) onHover(position);
					}}
				>
					<span className="truncate">{completion.label}</span>
					{completion.kind === "variant" ? (
						<span className="shrink-0 font-sans text-[10px] uppercase tracking-wider text-slate-400">
							variant
						</span>
					) : null}
				</button>
			))}
		</div>,
		document.body,
	);
}
