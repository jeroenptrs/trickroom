import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { type ReactNode, type RefObject, useState } from "react";
import { Input } from "../ui/input";
import { Text } from "../ui/text";

export type TokenRowValue = {
	name: string;
	value: string;
	valueLabel?: ReactNode;
};

export type TokenDomainSection = {
	domain: string;
	label: string;
	rows: readonly TokenRowValue[];
};

type DomainLabelResolver = (domain: string) => string;

export type TokenDomainPill = {
	domain: string;
	label: string;
	count: number;
	isActive: boolean;
};

function defaultDomainLabel(domain: string): string {
	return domain.replace(/^([a-z])/, (match) => match.toUpperCase());
}

const colorValuePattern =
	/^(#[0-9a-f]{3,8}|(?:rgb[a]?|hsl[a]?|hwb|lab|lch|oklab|oklch|color|color-mix)\(.+\)|var\(--[^)]+\)|currentColor|transparent|black|white)$/i;

export function isColorLikeValue(value: string): boolean {
	const trimmed = value.trim();
	return colorValuePattern.test(trimmed);
}

export function normalizeTokenFilter(value: string): string {
	return value.trim().toLowerCase();
}

export function tokenMatchesSearch(
	row: { name: string; value: string; domain: string },
	filter: string,
): boolean {
	const normalizedFilter = normalizeTokenFilter(filter);
	if (!normalizedFilter) {
		return true;
	}

	return (
		row.name.toLowerCase().includes(normalizedFilter) ||
		row.value.toLowerCase().includes(normalizedFilter) ||
		row.domain.toLowerCase().includes(normalizedFilter)
	);
}

export function filterTokenRows<
	TToken extends { domain: string; name: string; value: string },
>(
	tokens: readonly TToken[] | undefined,
	options?: {
		filter?: string;
		domainFilter?: readonly string[];
	},
): TToken[] {
	const normalizedFilter = normalizeTokenFilter(options?.filter ?? "");
	const domainFilter = options?.domainFilter;
	const domainFilterSet =
		domainFilter && domainFilter.length > 0 ? new Set(domainFilter) : null;

	return (tokens ?? []).filter((token) => {
		const matchesFilter = tokenMatchesSearch(token, normalizedFilter);
		const matchesDomain = domainFilterSet
			? domainFilterSet.has(token.domain)
			: true;
		return matchesFilter && matchesDomain;
	});
}

export function groupTokenRowsByDomain<TToken extends { domain: string }>(
	tokens: readonly TToken[] | undefined,
	mapRow: (token: TToken) => TokenRowValue,
	options?: {
		domainOrder?: readonly string[];
		getDomainLabel?: DomainLabelResolver;
	},
): TokenDomainSection[] {
	const grouped = new Map<string, TokenRowValue[]>();

	for (const token of tokens ?? []) {
		const row = mapRow(token);
		const rows = grouped.get(token.domain) ?? [];
		rows.push(row);
		grouped.set(token.domain, rows);
	}

	if (grouped.size === 0) {
		return [];
	}

	const resolvedLabel = options?.getDomainLabel ?? defaultDomainLabel;
	const orderedDomains = options?.domainOrder
		? options.domainOrder.filter((domain) => grouped.has(domain))
		: [...grouped.keys()];

	const remainingDomains = options?.domainOrder
		? [...grouped.keys()].filter((domain) => !orderedDomains.includes(domain))
		: [];

	for (const domain of remainingDomains) {
		orderedDomains.push(domain);
	}

	return orderedDomains.map((domain) => ({
		domain,
		label: resolvedLabel(domain),
		rows: grouped.get(domain) ?? [],
	}));
}

export function filterAndGroupTokenRowsByDomain<
	TToken extends { domain: string; name: string; value: string },
>(
	tokens: readonly TToken[] | undefined,
	mapRow: (token: TToken) => TokenRowValue,
	options?: {
		filter?: string;
		domainFilter?: readonly string[];
		domainOrder?: readonly string[];
		getDomainLabel?: DomainLabelResolver;
	},
): TokenDomainSection[] {
	return groupTokenRowsByDomain(filterTokenRows(tokens, options), mapRow, {
		domainOrder: options?.domainOrder,
		getDomainLabel: options?.getDomainLabel,
	});
}

export function SystemTokenSwatch({ value }: { value: string }) {
	const isColor = isColorLikeValue(value);

	if (isColor) {
		return (
			<span
				className="size-3 shrink-0 inset-shadow-[0_0_0_1px] inset-shadow-slate-300"
				style={{ background: value }}
				aria-hidden="true"
			/>
		);
	}

	return (
		<span
			className="inline-flex size-3 shrink-0 items-center justify-center border border-dashed border-slate-300 bg-slate-100"
			aria-hidden="true"
		>
			<span className="h-px w-[70%] bg-slate-400" />
		</span>
	);
}

export function SystemTokenRow({ row }: { row: TokenRowValue }) {
	return (
		<div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2">
			<SystemTokenSwatch value={row.value} />
			<span className="flex-1 truncate font-mono text-xs text-slate-800">
				{row.name}
			</span>
			<span className="font-mono text-[10px] text-slate-500">
				{row.valueLabel ?? row.value}
			</span>
		</div>
	);
}

export function TokenFilterInput({
	filter,
	inputRef,
	onFilterChange,
	onClear,
}: {
	filter: string;
	inputRef?: RefObject<HTMLInputElement | null>;
	onFilterChange: (nextFilter: string) => void;
	onClear?: () => void;
}) {
	const hasValue = filter.length > 0;

	return (
		<div className="relative">
			<Search
				className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
				aria-hidden="true"
			/>
			<Input
				ref={inputRef}
				variant="formCompact"
				className="w-full px-7"
				aria-label="Filter tokens"
				placeholder="Filter tokens…"
				value={filter}
				onChange={(event) => onFilterChange(event.target.value)}
			/>
			{hasValue && onClear ? (
				<button
					type="button"
					className="absolute right-2 top-1/2 -translate-y-1/2"
					onClick={onClear}
					aria-label="Clear token filter"
				>
					<X className="size-3.5 text-slate-500" aria-hidden="true" />
				</button>
			) : null}
		</div>
	);
}

export function deriveTokenDomainPills({
	sections,
	activeDomains,
}: {
	sections: readonly TokenDomainSection[];
	activeDomains?: readonly string[];
}): TokenDomainPill[] {
	const activeDomainSet =
		activeDomains && activeDomains.length > 0 ? new Set(activeDomains) : null;

	return sections.map((section) => ({
		domain: section.domain,
		label: section.label,
		count: section.rows.length,
		isActive: activeDomainSet ? activeDomainSet.has(section.domain) : true,
	}));
}

export function TokenDomainPills({
	pills,
	onToggle,
	onClearAll,
	leadingControl,
}: {
	pills: readonly TokenDomainPill[];
	onToggle: (domain: string) => void;
	onClearAll?: () => void;
	leadingControl?: ReactNode;
}) {
	const [isExpanded, setIsExpanded] = useState(false);
	const allActive = pills.every((pill) => pill.isActive);
	const collapsedLimit = 6;
	const canCollapse = pills.length > collapsedLimit;
	const visiblePills =
		canCollapse && !isExpanded ? pills.slice(0, collapsedLimit) : pills;
	const hiddenCount = Math.max(0, pills.length - visiblePills.length);

	return (
		<div
			className={`flex min-w-0 flex-wrap justify-end gap-1.5 ${
				isExpanded ? "max-w-full" : "max-w-[26rem]"
			}`}
		>
			{leadingControl}
			{onClearAll ? (
				<button
					type="button"
					className={`shrink-0 px-2 py-1 text-xs font-medium ${allActive ? "bg-slate-900 text-white" : "bg-white text-slate-700 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 hover:bg-slate-100"}`}
					onClick={onClearAll}
				>
					All
				</button>
			) : null}
			{visiblePills.map((pill) => (
				<button
					type="button"
					key={pill.domain}
					onClick={() => onToggle(pill.domain)}
					aria-pressed={pill.isActive}
					className={`inline-flex min-w-0 items-center gap-1.5 px-2 py-1 text-xs font-medium ${pill.isActive ? "bg-slate-900 text-white" : "bg-white text-slate-700 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 hover:bg-slate-100"}`}
				>
					<span className="truncate">{pill.label}</span>
					<span className="font-mono text-[10px] text-slate-400">
						{pill.count}
					</span>
				</button>
			))}
			{canCollapse ? (
				<button
					type="button"
					className="shrink-0 bg-white px-2 py-1 text-xs font-medium text-slate-700 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 hover:bg-slate-100"
					onClick={() => setIsExpanded((current) => !current)}
					aria-expanded={isExpanded}
				>
					{isExpanded ? "Less" : `More ${hiddenCount}`}
				</button>
			) : null}
		</div>
	);
}

export function TokenDomainSectionList({
	section,
	emptyMessage = "No tokens in this section.",
	isCollapsed,
	onToggle,
}: {
	section: TokenDomainSection;
	emptyMessage?: string;
	isCollapsed?: boolean;
	onToggle?: () => void;
}) {
	const canCollapse = typeof onToggle === "function";
	const collapsed = canCollapse && isCollapsed === true;

	if (!canCollapse) {
		return (
			<>
				<Text variant="section-divider" render={<div />}>
					{section.label}
				</Text>
				{section.rows.length === 0 ? (
					<p className="px-4 py-6 text-sm text-slate-500">{emptyMessage}</p>
				) : (
					<div className="flex flex-col">
						{section.rows.map((row) => (
							<SystemTokenRow key={`${section.domain}:${row.name}`} row={row} />
						))}
					</div>
				)}
			</>
		);
	}

	const Icon = collapsed ? ChevronRight : ChevronDown;

	return (
		<>
			<button
				type="button"
				className="flex w-full items-center bg-slate-50 px-3 py-2.5 text-left"
				onClick={onToggle}
				aria-expanded={!collapsed}
			>
				<div className="flex items-center gap-2">
					<Icon
						className="size-3.5 shrink-0 text-slate-500"
						aria-hidden="true"
					/>
					<Text
						variant="section-divider"
						render={<span />}
						className="px-0 py-0"
					>
						{section.label}
					</Text>
					<span
						className="size-1 rounded-full bg-slate-300"
						aria-hidden="true"
					/>
					<span className="font-mono text-[10px] text-slate-500">
						{section.rows.length}
					</span>
				</div>
			</button>
			{collapsed ? null : section.rows.length === 0 ? (
				<p className="px-4 py-6 text-sm text-slate-500">{emptyMessage}</p>
			) : (
				<div className="flex flex-col">
					{section.rows.map((row) => (
						<SystemTokenRow key={`${section.domain}:${row.name}`} row={row} />
					))}
				</div>
			)}
		</>
	);
}
