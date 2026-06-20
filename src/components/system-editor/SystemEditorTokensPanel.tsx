import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Check,
	Download,
	EyeOff,
	RefreshCw,
	X,
} from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { TailwindSyncResult } from "../../hooks/useTailwindSyncController";
import type { ProjectQueryScope } from "../../queries/project-scope";
import {
	type StoredTailwindCustomUtility,
	type StoredTailwindTokensResponse,
	saveAndConfirmTailwindTokens,
	storedTailwindTokensQueryKey,
	storedTailwindTokensQueryOptions,
} from "../../queries/tailwind-sync-tokens";
import { defaultTailwindTokensByDomain } from "../../utils/default-tailwind-tokens";
import { getKey, useWindowKeyDown } from "../../utils/editor-shortcuts";
import { computeColorOverrides } from "../../utils/tailwind-color-tokens";
import {
	computeTokenDomainOverrides,
	TAILWIND_TOKEN_DOMAINS,
	type TailwindDefaultTokenEntry,
	type TailwindOverriddenTokenEntry,
	type TailwindTokenDomain,
	type TailwindTokenDomainDiffs,
	type TailwindTokenEntry,
} from "../../utils/tailwind-token-domains";
import { useTailwindSyncController } from "../contexts";
import { formatRelativeTime, pluralize } from "../project/project-view-utils";
import { SystemDiffChips } from "../project/SystemDiffChips";
import {
	SystemStatusBadge,
	type SystemStatusBadgeState,
} from "../project/SystemStatusBadge";
import {
	deriveTokenDomainPills,
	filterAndGroupTokenRowsByDomain,
	filterTokenRows,
	SystemTokenSwatch,
	TokenDomainPills,
	type TokenDomainSection,
	TokenDomainSectionList,
	TokenFilterInput,
	type TokenRowValue,
} from "../project/SystemTokenRows";
import { Button } from "../ui/button";
import { Text } from "../ui/text";

type StoredTokenDomains = StoredTailwindTokensResponse["domains"];
type TokenOverridesByDomain = Partial<Record<TailwindTokenDomain, string[]>>;
type TokenGroupMode = "domain" | "status";
type TokenChangeTone = "added" | "overridden" | "removed";
type SyncedTokenStatus = "default" | "added" | "overridden";

type TokenDiff = {
	added: number;
	overridden: number;
	removed: number;
};

type TokenChangeRow = {
	key: string;
	domain: TailwindTokenDomain;
	name: string;
	value: string;
	tone: TokenChangeTone;
	previousValue?: string;
	incomingValue?: string;
	summary: string;
};

type SyncedTokenEntry = TailwindTokenEntry & {
	status: SyncedTokenStatus;
	defaultValue?: string;
};

type VisualTokenRow = TokenRowValue & {
	domain: TailwindTokenDomain;
};

type NumericTokenRow = {
	domain: TailwindTokenDomain;
	name: string;
	value: string;
};

type ColorTokenGroup = {
	key: string;
	label: string;
	rows: readonly VisualTokenRow[];
};

const visualTokenDomains = [
	"color",
	"font",
	"text",
	"font-weight",
	"text-shadow",
	"leading",
	"tracking",
	"spacing",
	"breakpoint",
	"container",
	"radius",
	"shadow",
	"inset-shadow",
	"drop-shadow",
] as const satisfies readonly TailwindTokenDomain[];
const visualTokenDomainSet = new Set<string>(visualTokenDomains);
const baseColorTokenNames = new Set([
	"black",
	"white",
	"transparent",
	"current",
	"currentColor",
]);

const syncedTokenStatusConfig: Record<
	SyncedTokenStatus,
	{ label: string; description: string; order: number }
> = {
	default: {
		label: "Default",
		description: "Tailwind baseline tokens available to this system.",
		order: 0,
	},
	overridden: {
		label: "Overridden",
		description: "Tailwind defaults replaced by the project theme.",
		order: 1,
	},
	added: {
		label: "Added",
		description: "Custom tokens added by the project theme.",
		order: 2,
	},
};

const tokenChangeToneConfig: Record<
	TokenChangeTone,
	{
		label: string;
		tag: string;
		borderClassName: string;
		headerClassName: string;
		tagClassName: string;
		dotClassName: string;
		textClassName: string;
	}
> = {
	added: {
		label: "Added",
		tag: "ADDED",
		borderClassName: "border-emerald-200",
		headerClassName: "bg-emerald-50 border-emerald-100",
		tagClassName: "bg-emerald-100 text-emerald-700",
		dotClassName: "bg-emerald-500",
		textClassName: "text-emerald-700",
	},
	overridden: {
		label: "Overridden",
		tag: "CHANGED",
		borderClassName: "border-amber-200",
		headerClassName: "bg-amber-50 border-amber-100",
		tagClassName: "bg-amber-100 text-amber-700",
		dotClassName: "bg-amber-500",
		textClassName: "text-amber-700",
	},
	removed: {
		label: "Removed",
		tag: "REMOVED",
		borderClassName: "border-rose-200",
		headerClassName: "bg-rose-50 border-rose-100",
		tagClassName: "bg-rose-100 text-rose-700",
		dotClassName: "bg-rose-500",
		textClassName: "text-rose-700",
	},
};

function getCssBasename(cssPath: string) {
	return cssPath.split(/[\\/]/).pop() || cssPath;
}

function formatDomainLabel(domain: string): string {
	return domain
		.split("-")
		.map((part) => part.replace(/^([a-z])/, (match) => match.toUpperCase()))
		.join(" ");
}

function getSyncState({
	result,
	reviewRequired,
	hasStoredSnapshot,
}: {
	result: TailwindSyncResult;
	reviewRequired: boolean;
	hasStoredSnapshot: boolean;
}): SystemStatusBadgeState {
	if (result.status === "error") {
		return "error";
	}

	if (result.status === "pending") {
		return "syncing";
	}

	if (reviewRequired) {
		return "review";
	}

	if (
		hasStoredSnapshot ||
		result.status === "success" ||
		result.status === "updated"
	) {
		return "synced";
	}

	return "idle";
}

export function canConfirmTokenReview({
	hasStoredSnapshot,
	hasSyncResult,
	isSaving,
	isStoredSnapshotPending,
	reviewRequired,
}: {
	hasStoredSnapshot: boolean;
	hasSyncResult: boolean;
	isSaving: boolean;
	isStoredSnapshotPending: boolean;
	reviewRequired: boolean;
}) {
	if (!reviewRequired || isSaving) {
		return false;
	}

	return hasSyncResult || (!isStoredSnapshotPending && hasStoredSnapshot);
}

function cloneTokenOverridesByDomain(
	overridesByDomain: TokenOverridesByDomain,
): Record<TailwindTokenDomain, string[]> {
	return Object.fromEntries(
		TAILWIND_TOKEN_DOMAINS.map((domain) => [
			domain,
			[...(overridesByDomain[domain] ?? [])].sort((left, right) =>
				left.localeCompare(right),
			),
		]),
	) as Record<TailwindTokenDomain, string[]>;
}

function getStoredTokenOverridesByDomain(
	domains: StoredTokenDomains | undefined,
) {
	return cloneTokenOverridesByDomain(
		Object.fromEntries(
			TAILWIND_TOKEN_DOMAINS.map((domain) => [
				domain,
				domains?.[domain]?.overrides ?? [],
			]),
		) as TokenOverridesByDomain,
	);
}

function computeSuggestedTokenOverridesByDomain(
	removedTokens: readonly TailwindDefaultTokenEntry[],
) {
	const overridesByDomain: TokenOverridesByDomain = {
		color: computeColorOverrides(
			removedTokens.filter((token) => token.domain === "color"),
		),
	};

	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		if (domain === "color") {
			continue;
		}

		overridesByDomain[domain] = computeTokenDomainOverrides(
			removedTokens.filter((token) => token.domain === domain),
		);
	}

	return cloneTokenOverridesByDomain(overridesByDomain);
}

function toTokenSaveDomains(overridesByDomain: TokenOverridesByDomain) {
	return Object.fromEntries(
		TAILWIND_TOKEN_DOMAINS.map((domain) => [
			domain,
			{ overrides: overridesByDomain[domain] ?? [] },
		]),
	) as Record<TailwindTokenDomain, { overrides: string[] }>;
}

function collectSyncAddedTokens(
	baselineDiffs: TailwindTokenDomainDiffs | undefined,
): TailwindTokenEntry[] {
	return TAILWIND_TOKEN_DOMAINS.flatMap(
		(domain) => baselineDiffs?.[domain]?.added ?? [],
	);
}

function collectStoredAddedTokens(
	domains: StoredTokenDomains | undefined,
): TailwindTokenEntry[] {
	return TAILWIND_TOKEN_DOMAINS.flatMap(
		(domain) => domains?.[domain]?.baselineDiff.added ?? [],
	);
}

function collectSyncOverriddenTokens(
	baselineDiffs: TailwindTokenDomainDiffs | undefined,
): TailwindOverriddenTokenEntry[] {
	return TAILWIND_TOKEN_DOMAINS.flatMap(
		(domain) => baselineDiffs?.[domain]?.overridden ?? [],
	);
}

function collectStoredOverriddenTokens(
	domains: StoredTokenDomains | undefined,
): TailwindOverriddenTokenEntry[] {
	return TAILWIND_TOKEN_DOMAINS.flatMap(
		(domain) => domains?.[domain]?.baselineDiff.overridden ?? [],
	);
}

function collectSyncRemovedTokens(
	baselineDiffs: TailwindTokenDomainDiffs | undefined,
): TailwindDefaultTokenEntry[] {
	return TAILWIND_TOKEN_DOMAINS.flatMap(
		(domain) => baselineDiffs?.[domain]?.removed ?? [],
	);
}

function collectStoredRemovedTokens(
	domains: StoredTokenDomains | undefined,
): TailwindDefaultTokenEntry[] {
	return TAILWIND_TOKEN_DOMAINS.flatMap(
		(domain) => domains?.[domain]?.baselineDiff.removed ?? [],
	);
}

export function buildCompleteSyncedTokens({
	addedTokens,
	extraTokens,
	overriddenTokens,
	removedTokens = [],
}: {
	addedTokens: readonly TailwindTokenEntry[];
	extraTokens?: readonly TailwindTokenEntry[];
	overriddenTokens: readonly TailwindOverriddenTokenEntry[];
	removedTokens?: readonly TailwindDefaultTokenEntry[];
}): SyncedTokenEntry[] {
	const tokensByDomain = new Map<
		TailwindTokenDomain,
		Map<string, SyncedTokenEntry>
	>();

	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		const domainTokens = new Map<string, SyncedTokenEntry>();
		const defaultTokens = defaultTailwindTokensByDomain[domain] ?? {};
		for (const [name, value] of Object.entries(defaultTokens)) {
			domainTokens.set(name, {
				name,
				value,
				domain,
				status: "default",
				defaultValue: value,
			});
		}
		tokensByDomain.set(domain, domainTokens);
	}

	for (const token of removedTokens) {
		tokensByDomain.get(token.domain)?.delete(token.name);
	}

	const upsertSyncedToken = (token: TailwindTokenEntry) => {
		const defaultValue =
			defaultTailwindTokensByDomain[token.domain]?.[token.name];
		tokensByDomain.get(token.domain)?.set(token.name, {
			name: token.name,
			value: token.value,
			domain: token.domain,
			status:
				defaultValue === undefined
					? "added"
					: defaultValue === token.value
						? "default"
						: "overridden",
			defaultValue,
		});
	};

	for (const token of extraTokens ?? []) {
		upsertSyncedToken(token);
	}

	for (const token of overriddenTokens) {
		tokensByDomain.get(token.domain)?.set(token.name, {
			name: token.name,
			value: token.value,
			domain: token.domain,
			status: "overridden",
			defaultValue: token.defaultValue,
		});
	}

	for (const token of addedTokens) {
		tokensByDomain.get(token.domain)?.set(token.name, {
			name: token.name,
			value: token.value,
			domain: token.domain,
			status: "added",
		});
	}

	return sortTokenRowsByDomainAndValue(
		TAILWIND_TOKEN_DOMAINS.flatMap((domain) => [
			...(tokensByDomain.get(domain)?.values() ?? []),
		]),
	);
}

function buildTokenChangeRows({
	addedTokens,
	overriddenTokens,
	removedTokens,
}: {
	addedTokens: readonly TailwindTokenEntry[];
	overriddenTokens: readonly TailwindOverriddenTokenEntry[];
	removedTokens: readonly TailwindDefaultTokenEntry[];
}): TokenChangeRow[] {
	return sortTokenRowsByDomainAndValue([
		...overriddenTokens.map((token) => ({
			key: `overridden:${token.domain}:${token.name}`,
			domain: token.domain,
			name: token.name,
			value: token.value,
			tone: "overridden" as const,
			previousValue: token.defaultValue,
			incomingValue: token.value,
			summary: "Value differs from Tailwind baseline",
		})),
		...addedTokens.map((token) => ({
			key: `added:${token.domain}:${token.name}`,
			domain: token.domain,
			name: token.name,
			value: token.value,
			tone: "added" as const,
			incomingValue: token.value,
			summary: "Custom token in the project theme",
		})),
		...removedTokens.map((token) => ({
			key: `removed:${token.domain}:${token.name}`,
			domain: token.domain,
			name: token.name,
			value: token.defaultValue,
			tone: "removed" as const,
			previousValue: token.defaultValue,
			summary: "Default token missing from the project theme",
		})),
	]);
}

function SectionHeader({
	index,
	title,
	description,
	count,
}: {
	index: string;
	title: string;
	description: string;
	count: number;
}) {
	return (
		<div className="mb-5 flex min-w-0 items-baseline gap-3">
			<span className="font-mono text-[11px] text-slate-300">{index}</span>
			<Text variant="subtitle" className="text-[15px] text-slate-900">
				{title}
			</Text>
			<span className="text-[11px] text-slate-500">{description}</span>
			<span className="ml-auto font-mono text-[10px] text-slate-400">
				{count.toLocaleString()}
			</span>
		</div>
	);
}

function EmptyTokenState({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-80 flex-1 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
			<p className="text-sm font-medium text-slate-900">{title}</p>
			<p className="mt-1 max-w-sm text-sm text-slate-500">{children}</p>
		</div>
	);
}

function TokenMasthead({
	systemId,
	systemName,
	cssPath,
	syncedAt,
	baselineVersion,
	status,
	tokenCount,
	domainCount,
	diff,
	isSyncing,
	onSync,
	syncDisabled,
	canExport,
}: {
	systemId: string;
	systemName: string;
	cssPath: string;
	syncedAt: string | null;
	baselineVersion: string | null;
	status: SystemStatusBadgeState;
	tokenCount: number;
	domainCount: number;
	diff: TokenDiff;
	isSyncing: boolean;
	onSync: () => void;
	syncDisabled: boolean;
	canExport: boolean;
}) {
	const syncLabel = syncedAt ? formatRelativeTime(syncedAt) : "never";
	const versionLabel = baselineVersion
		? `Tailwind ${baselineVersion}`
		: "Tailwind";
	const exportHref = `/api/trickroom/tailwind/systems/${encodeURIComponent(systemId)}/tokens.html?download=1`;

	return (
		<header className="border-b border-slate-200 bg-white">
			<div className="flex items-start justify-between gap-6 px-10 pt-8 pb-6">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<Text variant="eyebrow" className="text-slate-400">
						Design system
					</Text>
					<div className="flex min-w-0 flex-wrap items-center gap-3">
						<h1 className="min-w-0 truncate text-2xl font-semibold text-slate-900">
							{systemName} Tokens
						</h1>
						<SystemStatusBadge state={status} />
					</div>
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
						<span className="font-mono text-[11px] text-slate-500">
							{getCssBasename(cssPath)} · {versionLabel} · synced {syncLabel}
						</span>
						<SystemDiffChips
							added={diff.added}
							overridden={diff.overridden}
							removed={diff.removed}
						/>
					</div>
				</div>
				<div className="flex shrink-0 flex-col items-end gap-2">
					<div className="font-mono text-[10px] text-slate-400">
						{tokenCount.toLocaleString()} {pluralize(tokenCount, "token")} ·{" "}
						{domainCount.toLocaleString()} {pluralize(domainCount, "domain")}
					</div>
					<div className="flex items-center gap-2">
						{canExport ? (
							<a
								className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-950 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 hover:bg-slate-100"
								href={exportHref}
								title="Export static HTML"
							>
								<Download className="size-3.5" aria-hidden="true" />
								Export HTML
							</a>
						) : null}
						<Button
							type="button"
							variant="blockDark"
							className="flex items-center gap-1.5 bg-slate-950 px-3 py-2"
							onClick={onSync}
							disabled={syncDisabled}
						>
							<RefreshCw
								className={`size-3.5 ${isSyncing ? "animate-spin text-cyan-300" : ""}`}
								aria-hidden="true"
							/>
							{isSyncing
								? "Syncing..."
								: status === "idle"
									? "Sync"
									: "Re-sync"}
						</Button>
					</div>
				</div>
			</div>
		</header>
	);
}

function TokenGroupModeControl({
	groupMode,
	onChange,
}: {
	groupMode: TokenGroupMode;
	onChange: (mode: TokenGroupMode) => void;
}) {
	const modes: Array<{ mode: TokenGroupMode; label: string }> = [
		{ mode: "domain", label: "Domain" },
		{ mode: "status", label: "Status" },
	];

	return (
		<div className="flex items-center gap-2">
			<span className="text-[10px] font-semibold tracking-wider text-slate-400">
				GROUP BY
			</span>
			<div className="flex items-center inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
				{modes.map(({ mode, label }) => (
					<button
						key={mode}
						type="button"
						aria-pressed={groupMode === mode}
						className={`px-2.5 py-1 text-sm ${
							groupMode === mode
								? "bg-slate-950 font-medium text-slate-100"
								: "text-slate-700 hover:bg-slate-100"
						}`}
						onClick={() => onChange(mode)}
					>
						{label}
					</button>
				))}
			</div>
		</div>
	);
}

function TokenToolbar({
	groupMode,
	onGroupModeChange,
	filter,
	filterInputRef,
	onFilterChange,
	onClearFilter,
	showDefaultFilter,
	hideDefaultTokens,
	onToggleDefaultTokens,
	defaultTokenCount,
	pills,
	onToggleDomain,
	onClearDomains,
	filteredCount,
	totalCount,
}: {
	groupMode: TokenGroupMode;
	onGroupModeChange: (mode: TokenGroupMode) => void;
	filter: string;
	filterInputRef: RefObject<HTMLInputElement | null>;
	onFilterChange: (value: string) => void;
	onClearFilter: () => void;
	showDefaultFilter?: boolean;
	hideDefaultTokens?: boolean;
	onToggleDefaultTokens?: () => void;
	defaultTokenCount?: number;
	pills: ReturnType<typeof deriveTokenDomainPills>;
	onToggleDomain: (domain: string) => void;
	onClearDomains: () => void;
	filteredCount: number;
	totalCount: number;
}) {
	const canToggleDefaults =
		showDefaultFilter &&
		typeof onToggleDefaultTokens === "function" &&
		(defaultTokenCount ?? 0) > 0;

	return (
		<div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-slate-100 bg-white/95 px-10 py-3 backdrop-blur">
			<div className="flex min-w-0 items-center justify-between gap-3">
				<TokenGroupModeControl
					groupMode={groupMode}
					onChange={onGroupModeChange}
				/>
				<div className="flex min-w-0 flex-1 items-center justify-end gap-2">
					<div className="min-w-52 max-w-80 flex-1">
						<TokenFilterInput
							filter={filter}
							inputRef={filterInputRef}
							onFilterChange={onFilterChange}
							onClear={onClearFilter}
						/>
					</div>
					<span className="shrink-0 font-mono text-[10px] text-slate-500">
						{filteredCount === totalCount
							? `${totalCount.toLocaleString()} tokens`
							: `${filteredCount.toLocaleString()} / ${totalCount.toLocaleString()}`}
					</span>
				</div>
			</div>
			<div className="flex min-w-0 flex-wrap items-start justify-end gap-2">
				<TokenDomainPills
					pills={pills}
					onToggle={onToggleDomain}
					onClearAll={onClearDomains}
					leadingControl={
						canToggleDefaults ? (
							<button
								type="button"
								aria-pressed={hideDefaultTokens}
								className={`inline-flex shrink-0 items-center gap-1.5 px-2 py-1 text-xs font-medium ${
									hideDefaultTokens
										? "bg-slate-900 text-white"
										: "bg-white text-slate-700 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 hover:bg-slate-100"
								}`}
								onClick={onToggleDefaultTokens}
							>
								<EyeOff className="size-3" aria-hidden="true" />
								<span>
									{hideDefaultTokens ? "Defaults hidden" : "Hide defaults"}
								</span>
								<span className="font-mono text-[10px] text-slate-400">
									{defaultTokenCount?.toLocaleString()}
								</span>
							</button>
						) : null
					}
				/>
			</div>
		</div>
	);
}

function ReviewBanner({
	diff,
	saveError,
	isSaving,
	confirmDisabled,
	discardDisabled,
	onConfirm,
	onDiscard,
}: {
	diff: TokenDiff;
	saveError: string | null;
	isSaving: boolean;
	confirmDisabled: boolean;
	discardDisabled: boolean;
	onConfirm: () => void;
	onDiscard: () => void;
}) {
	const changeCount = diff.added + diff.overridden + diff.removed;

	return (
		<div className="border-b border-amber-200 bg-amber-50 px-10 py-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<Text variant="subtitle" className="text-amber-950">
							Review token changes
						</Text>
						<SystemDiffChips
							added={diff.added}
							overridden={diff.overridden}
							removed={diff.removed}
						/>
					</div>
					<p className="text-[11px] text-amber-800">
						{changeCount.toLocaleString()} {pluralize(changeCount, "change")}{" "}
						pending confirmation.
					</p>
					{saveError ? (
						<p className="text-[11px] text-red-700">{saveError}</p>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Button
						type="button"
						variant="outlined"
						className="flex items-center gap-1.5 bg-amber-50 px-3 py-2 text-amber-800 inset-shadow-amber-300"
						onClick={onDiscard}
						disabled={discardDisabled}
					>
						<X className="size-3.5" aria-hidden="true" />
						{isSaving ? "Saving..." : "Discard suggestions"}
					</Button>
					<Button
						type="button"
						variant="blockDark"
						className="flex items-center gap-1.5 bg-amber-600 px-3 py-2 text-white hover:bg-amber-700"
						onClick={onConfirm}
						disabled={confirmDisabled}
					>
						<Check className="size-3.5" aria-hidden="true" />
						{isSaving ? "Confirming..." : "Confirm changeset"}
					</Button>
				</div>
			</div>
		</div>
	);
}

function rowsForDomains(
	sections: readonly TokenDomainSection[],
	domains: readonly TailwindTokenDomain[],
): VisualTokenRow[] {
	const domainSet = new Set<string>(domains);
	return sections
		.filter((section) => domainSet.has(section.domain))
		.flatMap((section) =>
			section.rows.map((row) => ({
				...row,
				domain: section.domain as TailwindTokenDomain,
			})),
		);
}

function parseColorTokenName(name: string) {
	const weightedMatch = /^(.*)-(\d+)$/.exec(name);

	if (weightedMatch) {
		return {
			group: weightedMatch[1],
			weight: Number(weightedMatch[2]),
		};
	}

	return {
		group: baseColorTokenNames.has(name) ? "base" : "custom",
		weight: null,
	};
}

function compareColorGroups(left: string, right: string) {
	if (left === right) return 0;
	if (left === "custom") return -1;
	if (right === "custom") return 1;
	if (left === "base") return -1;
	if (right === "base") return 1;

	return left.localeCompare(right, undefined, { numeric: true });
}

function compareColorRows(left: VisualTokenRow, right: VisualTokenRow) {
	const leftParts = parseColorTokenName(left.name);
	const rightParts = parseColorTokenName(right.name);

	if (leftParts.weight !== null || rightParts.weight !== null) {
		return (
			(leftParts.weight ?? Number.NEGATIVE_INFINITY) -
			(rightParts.weight ?? Number.NEGATIVE_INFINITY)
		);
	}

	return left.name.localeCompare(right.name, undefined, { numeric: true });
}

function getColorGroupLabel(group: string) {
	if (group === "custom") {
		return "Custom colors";
	}

	if (group === "base") {
		return "Base colors";
	}

	return `Color ${formatDomainLabel(group)}`;
}

function groupColorRows(rows: readonly VisualTokenRow[]): ColorTokenGroup[] {
	const groups = new Map<string, VisualTokenRow[]>();

	for (const row of rows) {
		const { group } = parseColorTokenName(row.name);
		const groupRows = groups.get(group) ?? [];
		groupRows.push(row);
		groups.set(group, groupRows);
	}

	return [...groups.entries()]
		.sort(([left], [right]) => compareColorGroups(left, right))
		.map(([key, groupRows]) => ({
			key,
			label: getColorGroupLabel(key),
			rows: [...groupRows].sort(compareColorRows),
		}));
}

function ColorTokenSection({
	index,
	rows,
}: {
	index: string;
	rows: readonly VisualTokenRow[];
}) {
	if (rows.length === 0) {
		return null;
	}

	const colorGroups = groupColorRows(rows);

	return (
		<section className="border-b border-slate-100 px-10 py-8">
			<SectionHeader
				index={index}
				title="Color"
				description="Resolved color tokens with their project values."
				count={rows.length}
			/>
			<div className="flex flex-col gap-6">
				{colorGroups.map((group) => (
					<div key={group.key} className="flex min-w-0 flex-col gap-2">
						<div className="flex items-center gap-2">
							<Text variant="section-divider" render={<div />}>
								{group.label}
							</Text>
							<span className="font-mono text-[10px] text-slate-400">
								{group.rows.length.toLocaleString()}
							</span>
						</div>
						<div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,7.25rem))] justify-start gap-2">
							{group.rows.map((row) => (
								<div
									key={row.name}
									className="flex min-w-0 flex-col border border-slate-200 bg-white"
								>
									<div
										className="h-11 border-b border-slate-200"
										style={{ background: row.value }}
										aria-hidden="true"
									/>
									<div className="flex min-w-0 flex-col gap-0.5 px-2 py-2">
										<span className="truncate font-mono text-[11px] font-medium text-slate-800">
											{row.name}
										</span>
										<span className="truncate font-mono text-[10px] text-slate-500">
											{row.value}
										</span>
									</div>
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

const textSizeOrder = [
	"xs",
	"sm",
	"base",
	"lg",
	"xl",
	"2xl",
	"3xl",
	"4xl",
	"5xl",
	"6xl",
	"7xl",
	"8xl",
	"9xl",
];
const containerSizeOrder = [
	"3xs",
	"2xs",
	"xs",
	"sm",
	"md",
	"lg",
	"xl",
	"2xl",
	"3xl",
	"4xl",
	"5xl",
	"6xl",
	"7xl",
];
const radiusSizeOrder = [
	"xs",
	"sm",
	"DEFAULT",
	"md",
	"lg",
	"xl",
	"2xl",
	"3xl",
	"4xl",
];
const fontWeightOrder = [
	"thin",
	"extralight",
	"light",
	"normal",
	"medium",
	"semibold",
	"bold",
	"extrabold",
	"black",
];
const rhythmOrder = [
	"tighter",
	"tight",
	"snug",
	"normal",
	"relaxed",
	"loose",
	"wide",
	"wider",
	"widest",
];
const shadowSizeOrder = [
	"2xs",
	"xs",
	"sm",
	"DEFAULT",
	"md",
	"lg",
	"xl",
	"2xl",
	"inner",
];
const shadowDomainOrder = new Map<TailwindTokenDomain, number>([
	["shadow", 0],
	["inset-shadow", 1],
	["drop-shadow", 2],
	["text-shadow", 3],
]);

function compareByOrder(left: string, right: string, order: readonly string[]) {
	const leftIndex = order.indexOf(left);
	const rightIndex = order.indexOf(right);

	if (leftIndex !== -1 || rightIndex !== -1) {
		return (
			(leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
			(rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
		);
	}

	return left.localeCompare(right, undefined, { numeric: true });
}

function buildTokenValueMap(rows: readonly NumericTokenRow[]) {
	const valuesByDomain = new Map<TailwindTokenDomain, Map<string, string>>();

	for (const row of rows) {
		const domainValues = valuesByDomain.get(row.domain) ?? new Map();
		domainValues.set(row.name, row.value);
		valuesByDomain.set(row.domain, domainValues);
	}

	return valuesByDomain;
}

function getDomainOrderIndex(domain: TailwindTokenDomain) {
	const index = TAILWIND_TOKEN_DOMAINS.indexOf(domain);
	return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function compareNumericTokenRows<TToken extends NumericTokenRow>(
	left: TToken,
	right: TToken,
	valuesByDomain: Map<TailwindTokenDomain, Map<string, string>>,
	order?: readonly string[],
) {
	const leftValue = resolveNumericTokenValue(left, valuesByDomain);
	const rightValue = resolveNumericTokenValue(right, valuesByDomain);

	if (leftValue !== null || rightValue !== null) {
		if (leftValue === null) {
			return 1;
		}
		if (rightValue === null) {
			return -1;
		}
		if (leftValue !== rightValue) {
			return leftValue - rightValue;
		}
	}

	return order
		? compareByOrder(left.name, right.name, order)
		: left.name.localeCompare(right.name, undefined, { numeric: true });
}

function sortTokenRowsByDomainAndValue<TToken extends NumericTokenRow>(
	rows: readonly TToken[],
) {
	const valuesByDomain = buildTokenValueMap(rows);
	return [...rows].sort((left, right) => {
		const domainComparison =
			getDomainOrderIndex(left.domain) - getDomainOrderIndex(right.domain);
		if (domainComparison !== 0) {
			return domainComparison;
		}
		return compareNumericTokenRows(left, right, valuesByDomain);
	});
}

function rowsForDomain(
	rows: readonly VisualTokenRow[],
	domain: TailwindTokenDomain,
	order?: readonly string[],
) {
	const domainRows = rows.filter((row) => row.domain === domain);
	const valuesByDomain = buildTokenValueMap(domainRows);
	return [...domainRows].sort((left, right) =>
		compareNumericTokenRows(left, right, valuesByDomain, order),
	);
}

function getDisplayTokenName(row: VisualTokenRow) {
	return row.name === "DEFAULT" ? formatDomainLabel(row.domain) : row.name;
}

function VisualSubgroup({
	title,
	description,
	count,
	children,
}: {
	title: string;
	description?: string;
	count: number;
	children: ReactNode;
}) {
	if (count === 0) {
		return null;
	}

	return (
		<div className="flex min-w-0 flex-col gap-2">
			<div className="flex min-w-0 items-baseline gap-2">
				<Text variant="section-divider" render={<div />} className="shrink-0">
					{title}
				</Text>
				{description ? (
					<span className="min-w-0 truncate text-[11px] text-slate-500">
						{description}
					</span>
				) : null}
				<span className="ml-auto font-mono text-[10px] text-slate-400">
					{count.toLocaleString()}
				</span>
			</div>
			{children}
		</div>
	);
}

function parseLengthValue(value: string): number | null {
	const trimmed = value.trim();
	const pxMatch = /^(-?\d+(?:\.\d+)?)px$/i.exec(trimmed);
	if (pxMatch) {
		return Number(pxMatch[1]);
	}

	const remMatch = /^(-?\d+(?:\.\d+)?)rem$/i.exec(trimmed);
	if (remMatch) {
		return Number(remMatch[1]) * 16;
	}

	const numericMatch = /^-?\d+(?:\.\d+)?$/.exec(trimmed);
	if (numericMatch) {
		return Number(trimmed) * 4;
	}

	return null;
}

function resolveNumericTokenValue(
	row: NumericTokenRow,
	valuesByDomain: Map<TailwindTokenDomain, Map<string, string>>,
): number | null {
	const directLength = parseLengthValue(row.value);
	if (directLength !== null) {
		return directLength;
	}

	const spacingValue = resolveSpacingFunctionValue(
		row.value,
		valuesByDomain.get("spacing"),
	);
	if (spacingValue !== null) {
		return spacingValue;
	}

	return null;
}

function resolveSpacingFunctionValue(
	value: string,
	spacingValues: Map<string, string> | undefined,
) {
	const match = /^--spacing\((-?\d+(?:\.\d+)?)\)$/.exec(value.trim());
	if (!match) {
		return null;
	}

	const spacingBase =
		spacingValues?.get("DEFAULT") ??
		defaultTailwindTokensByDomain.spacing.DEFAULT;
	const baseLength = spacingBase ? parseLengthValue(spacingBase) : null;
	if (baseLength === null) {
		return null;
	}

	return Number(match[1]) * baseLength;
}

function FontFamilyGrid({ rows }: { rows: readonly VisualTokenRow[] }) {
	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,16rem))] justify-start gap-2">
			{rows.map((row) => (
				<div
					key={`${row.domain}:${row.name}`}
					className="min-w-0 border border-slate-200 bg-white px-3 py-3"
				>
					<div
						className="truncate text-lg text-slate-900"
						style={{ fontFamily: row.value }}
					>
						AaBbCc
					</div>
					<div className="mt-2 flex min-w-0 items-center justify-between gap-3">
						<span className="truncate font-mono text-[11px] font-medium text-slate-800">
							{row.name}
						</span>
						<span className="truncate text-right font-mono text-[10px] text-slate-500">
							{row.value}
						</span>
					</div>
				</div>
			))}
		</div>
	);
}

function getPreviewFontSize(value: string) {
	const length = parseLengthValue(value);
	if (length === null) {
		return undefined;
	}

	return `${Math.max(12, Math.min(28, length))}px`;
}

function TextSizeGrid({ rows }: { rows: readonly VisualTokenRow[] }) {
	const valuesByDomain = buildTokenValueMap(rows);
	const lineHeightByName = new Map(
		rows
			.filter((row) => row.name.endsWith("--line-height"))
			.map((row) => [row.name.replace(/--line-height$/, ""), row.value]),
	);
	const sizeRows = rows
		.filter((row) => !row.name.endsWith("--line-height"))
		.sort((left, right) =>
			compareNumericTokenRows(left, right, valuesByDomain, textSizeOrder),
		);

	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,11rem))] justify-start gap-2">
			{sizeRows.map((row) => (
				<div
					key={`${row.domain}:${row.name}`}
					className="min-w-0 border border-slate-200 bg-white px-3 py-3"
				>
					<div
						className="truncate font-medium text-slate-900"
						style={{ fontSize: getPreviewFontSize(row.value) }}
					>
						Type
					</div>
					<div className="mt-2 flex min-w-0 items-center justify-between gap-3">
						<span className="font-mono text-[11px] font-medium text-slate-800">
							{row.name}
						</span>
						<span className="truncate text-right font-mono text-[10px] text-slate-500">
							{row.value}
						</span>
					</div>
					{lineHeightByName.has(row.name) ? (
						<div className="mt-1 truncate font-mono text-[10px] text-slate-400">
							leading {lineHeightByName.get(row.name)}
						</div>
					) : null}
				</div>
			))}
		</div>
	);
}

function FontWeightGrid({ rows }: { rows: readonly VisualTokenRow[] }) {
	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,8rem))] justify-start gap-2">
			{rows.map((row) => (
				<div
					key={`${row.domain}:${row.name}`}
					className="min-w-0 border border-slate-200 bg-white px-3 py-3"
				>
					<div
						className="text-2xl leading-none text-slate-900"
						style={{ fontWeight: row.value }}
					>
						Aa
					</div>
					<div className="mt-2 flex min-w-0 items-center justify-between gap-2">
						<span className="truncate font-mono text-[11px] font-medium text-slate-800">
							{row.name}
						</span>
						<span className="font-mono text-[10px] text-slate-500">
							{row.value}
						</span>
					</div>
				</div>
			))}
		</div>
	);
}

function RhythmTokenList({ rows }: { rows: readonly VisualTokenRow[] }) {
	const sortedRows = [...rows].sort((left, right) =>
		compareByOrder(left.name, right.name, rhythmOrder),
	);

	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,16rem))] justify-start gap-2">
			{sortedRows.map((row) => (
				<div
					key={`${row.domain}:${row.name}`}
					className="flex min-w-0 items-center justify-between gap-3 border border-slate-200 bg-white px-3 py-2"
				>
					<span className="truncate font-mono text-[11px] font-medium text-slate-800">
						{getDisplayTokenName(row)}
					</span>
					<span className="truncate text-right font-mono text-[10px] text-slate-500">
						{row.value}
					</span>
				</div>
			))}
		</div>
	);
}

function TypeTokenSection({
	index,
	rows,
}: {
	index: string;
	rows: readonly VisualTokenRow[];
}) {
	if (rows.length === 0) {
		return null;
	}

	const fontRows = rowsForDomain(rows, "font");
	const textRows = rowsForDomain(rows, "text", textSizeOrder);
	const textSizeCount = textRows.filter(
		(row) => !row.name.endsWith("--line-height"),
	).length;
	const weightRows = rowsForDomain(rows, "font-weight", fontWeightOrder);
	const leadingRows = rowsForDomain(rows, "leading", rhythmOrder);
	const trackingRows = rowsForDomain(rows, "tracking", rhythmOrder);

	return (
		<section className="border-b border-slate-100 px-10 py-8">
			<SectionHeader
				index={index}
				title="Type"
				description="Font, size, weight, leading, and tracking tokens."
				count={rows.length}
			/>
			<div className="flex flex-col gap-7">
				<VisualSubgroup
					title="Font families"
					description="Project font stacks."
					count={fontRows.length}
				>
					<FontFamilyGrid rows={fontRows} />
				</VisualSubgroup>
				<VisualSubgroup
					title="Text sizes"
					description="Size tokens paired with their line-height metadata."
					count={textSizeCount}
				>
					<TextSizeGrid rows={textRows} />
				</VisualSubgroup>
				<VisualSubgroup
					title="Font weights"
					description="Numeric weight scale."
					count={weightRows.length}
				>
					<FontWeightGrid rows={weightRows} />
				</VisualSubgroup>
				<div className="grid grid-cols-1 gap-7 xl:grid-cols-2">
					<VisualSubgroup
						title="Leading"
						description="Line-height tokens."
						count={leadingRows.length}
					>
						<RhythmTokenList rows={leadingRows} />
					</VisualSubgroup>
					<VisualSubgroup
						title="Tracking"
						description="Letter-spacing tokens."
						count={trackingRows.length}
					>
						<RhythmTokenList rows={trackingRows} />
					</VisualSubgroup>
				</div>
			</div>
		</section>
	);
}

function LengthScaleList({
	rows,
	order,
}: {
	rows: readonly VisualTokenRow[];
	order?: readonly string[];
}) {
	const valuesByDomain = buildTokenValueMap(rows);
	const sortedRows = [...rows].sort((left, right) =>
		compareNumericTokenRows(left, right, valuesByDomain, order),
	);
	const maxLength = sortedRows.reduce((max, row) => {
		const length = resolveNumericTokenValue(row, valuesByDomain);
		return length === null ? max : Math.max(max, length);
	}, 0);

	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			{sortedRows.map((row) => {
				const length = resolveNumericTokenValue(row, valuesByDomain);
				const width =
					length === null || maxLength === 0
						? 24
						: Math.max(10, Math.min(100, (length / maxLength) * 100));
				return (
					<div
						key={`${row.domain}:${row.name}`}
						className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)_5.25rem] items-center gap-3 border border-slate-200 bg-white px-3 py-2"
					>
						<span className="truncate font-mono text-[11px] font-medium text-slate-800">
							{getDisplayTokenName(row)}
						</span>
						<div className="h-2 bg-slate-100" aria-hidden="true">
							<div
								className="h-full bg-cyan-500"
								style={{ width: `${width}%` }}
							/>
						</div>
						<span className="truncate text-right font-mono text-[10px] text-slate-500">
							{row.value}
						</span>
					</div>
				);
			})}
		</div>
	);
}

function RadiusGrid({ rows }: { rows: readonly VisualTokenRow[] }) {
	const valuesByDomain = buildTokenValueMap(rows);
	const sortedRows = [...rows].sort((left, right) =>
		compareNumericTokenRows(left, right, valuesByDomain, radiusSizeOrder),
	);

	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,8rem))] justify-start gap-2">
			{sortedRows.map((row) => {
				const radius = row.value;
				return (
					<div
						key={`${row.domain}:${row.name}`}
						className="min-w-0 border border-slate-200 bg-white px-3 py-3"
					>
						<div
							className="h-9 border border-cyan-500 bg-cyan-50"
							style={{ borderRadius: radius }}
							aria-hidden="true"
						/>
						<div className="mt-2 flex min-w-0 items-center justify-between gap-2">
							<span className="truncate font-mono text-[11px] font-medium text-slate-800">
								{getDisplayTokenName(row)}
							</span>
							<span className="truncate text-right font-mono text-[10px] text-slate-500">
								{row.value}
							</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}

function ShadowGrid({ rows }: { rows: readonly VisualTokenRow[] }) {
	const sortedRows = [...rows].sort((left, right) => {
		const domainComparison =
			(shadowDomainOrder.get(left.domain) ?? Number.MAX_SAFE_INTEGER) -
			(shadowDomainOrder.get(right.domain) ?? Number.MAX_SAFE_INTEGER);
		if (domainComparison !== 0) {
			return domainComparison;
		}
		return compareByOrder(left.name, right.name, shadowSizeOrder);
	});

	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,12rem))] justify-start gap-2">
			{sortedRows.map((row) => {
				const isTextShadow = row.domain === "text-shadow";
				return (
					<div
						key={`${row.domain}:${row.name}`}
						className="min-w-0 border border-slate-200 bg-white px-3 py-3"
					>
						<div className="flex h-12 items-center justify-center bg-slate-50">
							{isTextShadow ? (
								<span
									className="text-xl font-semibold text-slate-900"
									style={{ textShadow: row.value }}
								>
									Aa
								</span>
							) : (
								<span
									className="size-7 bg-white"
									style={{ boxShadow: row.value }}
									aria-hidden="true"
								/>
							)}
						</div>
						<div className="mt-2 flex min-w-0 items-center justify-between gap-2">
							<span className="truncate font-mono text-[11px] font-medium text-slate-800">
								{getDisplayTokenName(row)}
							</span>
						</div>
						<div className="mt-1 truncate font-mono text-[10px] text-slate-500">
							{row.value}
						</div>
					</div>
				);
			})}
		</div>
	);
}

const shadowGroupDescriptions: Partial<Record<TailwindTokenDomain, string>> = {
	shadow: "Outer box shadows.",
	"inset-shadow": "Inset box shadows.",
	"drop-shadow": "Filter drop shadows.",
	"text-shadow": "Text shadows.",
};

function getShadowGroupDomain(row: VisualTokenRow): TailwindTokenDomain {
	if (row.domain === "shadow" && /\binset\b/i.test(row.value)) {
		return "inset-shadow";
	}

	return row.domain;
}

function ShadowTokenGroups({ rows }: { rows: readonly VisualTokenRow[] }) {
	const groups = [...shadowDomainOrder.keys()]
		.map((domain) => ({
			domain,
			rows: rows.filter((row) => getShadowGroupDomain(row) === domain),
		}))
		.filter((group) => group.rows.length > 0);

	if (groups.length === 0) {
		return null;
	}

	return (
		<div className="flex min-w-0 flex-col gap-6">
			{groups.map((group) => (
				<VisualSubgroup
					key={group.domain}
					title={formatDomainLabel(group.domain)}
					description={shadowGroupDescriptions[group.domain]}
					count={group.rows.length}
				>
					<ShadowGrid rows={group.rows} />
				</VisualSubgroup>
			))}
		</div>
	);
}

function SpaceTokenSection({
	index,
	rows,
}: {
	index: string;
	rows: readonly VisualTokenRow[];
}) {
	if (rows.length === 0) {
		return null;
	}

	const spacingRows = rowsForDomain(rows, "spacing");
	const breakpointRows = rowsForDomain(rows, "breakpoint", [
		"sm",
		"md",
		"lg",
		"xl",
		"2xl",
	]);
	const containerRows = rowsForDomain(rows, "container", containerSizeOrder);
	const radiusRows = rowsForDomain(rows, "radius", radiusSizeOrder);
	const shadowRows = rows.filter((row) => shadowDomainOrder.has(row.domain));

	return (
		<section className="px-10 py-8">
			<SectionHeader
				index={index}
				title="Space"
				description="Spacing rhythm, breakpoints, containers, radii, and shadows."
				count={rows.length}
			/>
			<div className="flex flex-col gap-7">
				<div className="grid grid-cols-1 gap-7 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
					<VisualSubgroup
						title="Spacing"
						description="Base spacing scale."
						count={spacingRows.length}
					>
						<LengthScaleList rows={spacingRows} />
					</VisualSubgroup>
					<VisualSubgroup
						title="Breakpoints"
						description="Responsive viewport thresholds."
						count={breakpointRows.length}
					>
						<LengthScaleList
							rows={breakpointRows}
							order={["sm", "md", "lg", "xl", "2xl"]}
						/>
					</VisualSubgroup>
					<VisualSubgroup
						title="Containers"
						description="Layout container widths."
						count={containerRows.length}
					>
						<LengthScaleList rows={containerRows} order={containerSizeOrder} />
					</VisualSubgroup>
				</div>
				<VisualSubgroup
					title="Radii"
					description="Corner radius tokens."
					count={radiusRows.length}
				>
					<RadiusGrid rows={radiusRows} />
				</VisualSubgroup>
				<VisualSubgroup
					title="Shadows"
					description="Outer, inset, drop, and text shadows."
					count={shadowRows.length}
				>
					<ShadowTokenGroups rows={shadowRows} />
				</VisualSubgroup>
			</div>
		</section>
	);
}

function VisualTokenSections({
	sections,
}: {
	sections: readonly TokenDomainSection[];
}) {
	const colorRows = rowsForDomains(sections, ["color"]);
	const typeRows = rowsForDomains(sections, [
		"font",
		"text",
		"font-weight",
		"leading",
		"tracking",
	]);
	const spaceRows = rowsForDomains(sections, [
		"spacing",
		"breakpoint",
		"container",
		"radius",
		"shadow",
		"inset-shadow",
		"drop-shadow",
		"text-shadow",
	]);

	if (colorRows.length + typeRows.length + spaceRows.length === 0) {
		return null;
	}

	const visualSections = [
		{
			key: "color",
			rows: colorRows,
			render: (index: string) => (
				<ColorTokenSection index={index} rows={colorRows} />
			),
		},
		{
			key: "type",
			rows: typeRows,
			render: (index: string) => (
				<TypeTokenSection index={index} rows={typeRows} />
			),
		},
		{
			key: "space",
			rows: spaceRows,
			render: (index: string) => (
				<SpaceTokenSection index={index} rows={spaceRows} />
			),
		},
	].filter((section) => section.rows.length > 0);

	return (
		<div className="border-b border-slate-100">
			{visualSections.map((section, index) => (
				<div key={section.key}>
					{section.render(String(index + 1).padStart(2, "0"))}
				</div>
			))}
		</div>
	);
}

function TokenValuePreview({
	label,
	value,
	emptyLabel,
}: {
	label: string;
	value?: string;
	emptyLabel: string;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1 p-3">
			<span className="text-[9px] font-semibold tracking-wider text-slate-400">
				{label}
			</span>
			{value ? (
				<div className="flex min-w-0 items-center gap-2">
					<SystemTokenSwatch value={value} />
					<span className="min-w-0 truncate font-mono text-[10px] text-slate-700">
						{value}
					</span>
				</div>
			) : (
				<span className="font-mono text-[10px] text-slate-400">
					{emptyLabel}
				</span>
			)}
		</div>
	);
}

function TokenChangeCard({ row }: { row: TokenChangeRow }) {
	const config = tokenChangeToneConfig[row.tone];

	return (
		<div className={`border bg-white ${config.borderClassName}`}>
			<div
				className={`flex min-w-0 items-center gap-2 border-b px-3 py-2 ${config.headerClassName}`}
			>
				<span
					className={`shrink-0 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider ${config.tagClassName}`}
				>
					{config.tag}
				</span>
				<span
					className={`min-w-0 flex-1 truncate font-mono text-[11px] ${
						row.tone === "removed"
							? "text-slate-500 line-through"
							: "text-slate-700"
					}`}
				>
					{formatDomainLabel(row.domain)} / {row.name}
				</span>
				<span className={`shrink-0 text-[10px] ${config.textClassName}`}>
					{row.summary}
				</span>
			</div>
			<div className="grid min-w-0 grid-cols-2">
				<TokenValuePreview
					label={row.tone === "added" ? "PREVIOUS" : "BASELINE"}
					value={row.previousValue}
					emptyLabel="not stored"
				/>
				<div className="border-l border-slate-100">
					<TokenValuePreview
						label="INCOMING"
						value={row.incomingValue}
						emptyLabel={row.tone === "removed" ? "removed" : "unchanged"}
					/>
				</div>
			</div>
		</div>
	);
}

function ChangeSection({
	tone,
	rows,
	collapsed,
	onToggle,
}: {
	tone: TokenChangeTone;
	rows: readonly TokenChangeRow[];
	collapsed?: boolean;
	onToggle?: () => void;
}) {
	const config = tokenChangeToneConfig[tone];
	const canToggle = typeof onToggle === "function";

	if (rows.length === 0) {
		return null;
	}

	return (
		<section className="flex flex-col border border-slate-200 bg-white">
			<button
				type="button"
				className="flex items-center gap-2 bg-slate-50 px-4 py-2.5 text-left disabled:pointer-events-none"
				onClick={onToggle}
				disabled={!canToggle}
				aria-expanded={canToggle ? !collapsed : undefined}
			>
				<span className={`size-2 ${config.dotClassName}`} aria-hidden="true" />
				<Text variant="subtitle" className="text-[11px] text-slate-700">
					{config.label}
				</Text>
				<span className="font-mono text-[10px] text-slate-400">
					{rows.length.toLocaleString()}
				</span>
			</button>
			{collapsed ? null : (
				<div className="flex flex-col gap-3 px-4 py-4">
					{rows.map((row) => (
						<TokenChangeCard key={row.key} row={row} />
					))}
				</div>
			)}
		</section>
	);
}

function StatusGroupedChanges({
	rows,
	isRemovedCollapsed,
	onToggleRemoved,
	emptyMessage,
}: {
	rows: readonly TokenChangeRow[];
	isRemovedCollapsed: boolean;
	onToggleRemoved: () => void;
	emptyMessage: string;
}) {
	if (rows.length === 0) {
		return <p className="px-10 py-8 text-sm text-slate-500">{emptyMessage}</p>;
	}

	return (
		<div className="flex flex-col gap-4 px-10 py-6">
			<ChangeSection
				tone="overridden"
				rows={rows.filter((row) => row.tone === "overridden")}
			/>
			<ChangeSection
				tone="added"
				rows={rows.filter((row) => row.tone === "added")}
			/>
			<ChangeSection
				tone="removed"
				rows={rows.filter((row) => row.tone === "removed")}
				collapsed={isRemovedCollapsed}
				onToggle={onToggleRemoved}
			/>
		</div>
	);
}

function DomainGroupedChanges({
	rows,
	emptyMessage,
}: {
	rows: readonly TokenChangeRow[];
	emptyMessage: string;
}) {
	const grouped = useMemo(() => {
		const groups = new Map<TailwindTokenDomain, TokenChangeRow[]>();
		for (const row of rows) {
			const groupRows = groups.get(row.domain) ?? [];
			groupRows.push(row);
			groups.set(row.domain, groupRows);
		}

		return TAILWIND_TOKEN_DOMAINS.filter((domain) => groups.has(domain)).map(
			(domain) => ({
				domain,
				rows: groups.get(domain) ?? [],
			}),
		);
	}, [rows]);

	if (rows.length === 0) {
		return <p className="px-10 py-8 text-sm text-slate-500">{emptyMessage}</p>;
	}

	return (
		<div className="flex flex-col px-10 py-6">
			{grouped.map((group) => (
				<section key={group.domain} className="flex flex-col">
					<Text variant="section-divider" render={<div />}>
						{formatDomainLabel(group.domain)}
					</Text>
					<div className="flex flex-col gap-3 px-4 py-4">
						{group.rows.map((row) => (
							<TokenChangeCard key={row.key} row={row} />
						))}
					</div>
				</section>
			))}
		</div>
	);
}

function DomainTokenBrowser({
	sections,
	collapsedDomains,
	onToggleDomain,
}: {
	sections: readonly TokenDomainSection[];
	collapsedDomains: readonly string[];
	onToggleDomain: (domain: string) => void;
}) {
	if (sections.length === 0) {
		return (
			<p className="px-10 py-8 text-sm text-slate-500">
				No tokens match the current filters.
			</p>
		);
	}

	return (
		<div className="flex flex-col">
			{sections.map((section) => (
				<TokenDomainSectionList
					key={section.domain}
					section={section}
					emptyMessage="No tokens in this domain."
					isCollapsed={collapsedDomains.includes(section.domain)}
					onToggle={() => onToggleDomain(section.domain)}
				/>
			))}
		</div>
	);
}

function SyncedStatusTokenBrowser({
	tokens,
}: {
	tokens: readonly SyncedTokenEntry[];
}) {
	const sections = useMemo(
		() =>
			(["default", "overridden", "added"] as const).flatMap((status) => {
				const rows = tokens
					.filter((token) => token.status === status)
					.map((token) => ({
						name: `${formatDomainLabel(token.domain)} / ${token.name}`,
						value: token.value,
						valueLabel:
							status === "overridden" && token.defaultValue ? (
								<span className="inline-flex min-w-0 items-center gap-1.5">
									<span className="truncate bg-slate-50 px-1 text-slate-500">
										{token.defaultValue}
									</span>
									<span className="shrink-0 text-slate-400">→</span>
									<span className="truncate bg-amber-50 px-1 text-amber-700">
										{token.value}
									</span>
								</span>
							) : (
								token.value
							),
					}));

				if (rows.length === 0) {
					return [];
				}

				const config = syncedTokenStatusConfig[status];
				return [
					{
						domain: `status:${status}`,
						label: `${config.label} · ${config.description}`,
						rows,
					},
				];
			}),
		[tokens],
	);

	if (sections.length === 0) {
		return (
			<p className="px-10 py-8 text-sm text-slate-500">
				No token status records match the current filters.
			</p>
		);
	}

	return (
		<div className="flex flex-col">
			{sections.map((section) => (
				<TokenDomainSectionList
					key={section.domain}
					section={section}
					emptyMessage="No tokens in this status."
				/>
			))}
		</div>
	);
}

/**
 * Read-only review of the custom `@utility` definitions and the CSS variables
 * they consume — the data that lives outside the fixed token domains
 * (`customProperties` / `customUtilities` in the v3 snapshot). Surfacing it here
 * lets designers confirm what the system contributed beyond standard tokens.
 */
function CustomUtilitiesSection({
	customProperties,
	customUtilities,
}: {
	customProperties: StoredTailwindTokensResponse["customProperties"];
	customUtilities: StoredTailwindTokensResponse["customUtilities"];
}) {
	const [collapsed, setCollapsed] = useState(true);
	const variables = Object.entries(customProperties ?? {});
	const utilities = customUtilities ?? [];

	if (variables.length === 0 && utilities.length === 0) {
		return null;
	}

	// Fold each utility into the domain(s) it affects (multi-tag). Utilities the
	// inference couldn't place go under "uncategorized", listed last.
	const UNCATEGORIZED = "uncategorized";
	const byDomain = new Map<string, StoredTailwindCustomUtility[]>();
	for (const utility of utilities) {
		const keys =
			utility.domains && utility.domains.length > 0
				? utility.domains
				: [UNCATEGORIZED];
		for (const key of keys) {
			const bucket = byDomain.get(key) ?? [];
			bucket.push(utility);
			byDomain.set(key, bucket);
		}
	}
	const domainGroups = [...byDomain.entries()].sort(([left], [right]) => {
		if (left === UNCATEGORIZED) return 1;
		if (right === UNCATEGORIZED) return -1;
		return left.localeCompare(right);
	});

	return (
		<section className="border-t border-slate-200 px-10 py-6">
			<button
				type="button"
				onClick={() => setCollapsed((value) => !value)}
				className="flex w-full items-baseline gap-3 text-left"
				aria-expanded={!collapsed}
			>
				<span className="font-mono text-[11px] text-slate-300">＊</span>
				<Text variant="subtitle" className="text-[15px] text-slate-900">
					Custom utilities
				</Text>
				<span className="text-[11px] text-slate-500">
					@utility definitions grouped by the domain they affect
				</span>
				<span className="ml-auto font-mono text-[10px] text-slate-400">
					{utilities.length.toLocaleString()}
				</span>
			</button>

			{collapsed ? null : (
				<div className="mt-5 flex flex-col gap-6">
					{domainGroups.map(([domain, domainUtilities]) => (
						<div key={domain} className="flex flex-col gap-2">
							<p className="text-[11px] font-medium text-slate-500">
								{domain === UNCATEGORIZED
									? "Uncategorized"
									: formatDomainLabel(domain)}{" "}
								({domainUtilities.length})
							</p>
							<div className="flex flex-wrap gap-1">
								{domainUtilities.map((utility) => {
									const isFunctional = utility.kind !== "static";
									const label = isFunctional
										? `${utility.root}-*`
										: utility.root;
									const tooltip = isFunctional
										? [
												utility.consumedNamespaces.join(", "),
												utility.completionValues.join(" · "),
											]
												.filter(Boolean)
												.join("  •  ")
										: undefined;
									return (
										<span
											key={`${domain}:${utility.root}`}
											title={tooltip}
											className={
												isFunctional
													? "bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-800 ring-1 ring-slate-300 ring-inset"
													: "bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700"
											}
										>
											{label}
										</span>
									);
								})}
							</div>
						</div>
					))}

					{variables.length > 0 ? (
						<div className="flex flex-col gap-2">
							<p className="text-[11px] font-medium text-slate-500">
								Custom CSS variables ({variables.length})
							</p>
							<div className="flex flex-col gap-1">
								{variables.map(([name, value]) => (
									<div
										key={name}
										className="flex flex-wrap items-baseline gap-x-3 font-mono text-[11px]"
									>
										<span className="text-slate-900">{name}</span>
										<span className="text-slate-500">{value}</span>
									</div>
								))}
							</div>
						</div>
					) : null}
				</div>
			)}
		</section>
	);
}

export function SystemEditorTokensPanel({
	isActive = true,
	systemId,
	projectScope,
}: {
	isActive?: boolean;
	systemId: string;
	projectScope?: ProjectQueryScope;
}) {
	const queryClient = useQueryClient();
	const syncController = useTailwindSyncController();
	const storedTokensQueryKeyValue = storedTailwindTokensQueryKey(
		systemId,
		projectScope,
	);
	const storedTokensQuery = useQuery({
		...storedTailwindTokensQueryOptions(systemId, projectScope),
		enabled: systemId.length > 0,
	});
	const result: TailwindSyncResult = syncController.results[systemId] ?? {
		status: syncController.statusBySystem[systemId] ?? "idle",
	};
	const target = syncController.targetsById[systemId];
	const data = result.data;
	const storedDomains = storedTokensQuery.data?.domains;
	const reviewRequired = Boolean(
		data?.reviewRequired || storedTokensQuery.data?.reviewRequired,
	);
	const [groupMode, setGroupMode] = useState<TokenGroupMode>(() =>
		reviewRequired ? "status" : "domain",
	);
	const [tokenFilter, setTokenFilter] = useState("");
	const tokenFilterInputRef = useRef<HTMLInputElement>(null);
	const [activeTokenDomains, setActiveTokenDomains] = useState<string[]>([]);
	const [hideDefaultTokens, setHideDefaultTokens] = useState(false);
	const [collapsedTokenDomains, setCollapsedTokenDomains] = useState<
		readonly string[]
	>([]);
	const [isRemovedCollapsed, setIsRemovedCollapsed] = useState(true);

	useEffect(() => {
		if (!systemId) {
			return;
		}
		setGroupMode(reviewRequired ? "status" : "domain");
		setTokenFilter("");
		setActiveTokenDomains([]);
		setHideDefaultTokens(false);
		setCollapsedTokenDomains([]);
		setIsRemovedCollapsed(true);
	}, [reviewRequired, systemId]);

	const handleTokenFilterShortcut = useCallback((event: KeyboardEvent) => {
		const key = getKey(event);
		if (
			key !== "/" &&
			!((event.metaKey || event.ctrlKey) && !event.altKey && key === "f")
		) {
			return;
		}

		tokenFilterInputRef.current?.focus();
		tokenFilterInputRef.current?.select();
		event.preventDefault();
	}, []);

	useWindowKeyDown(handleTokenFilterShortcut, { enabled: isActive });

	const storedOverridesByDomain = useMemo(
		() => getStoredTokenOverridesByDomain(storedDomains),
		[storedDomains],
	);
	const addedTokens = useMemo(
		() =>
			data?.baselineDiffs
				? collectSyncAddedTokens(data.baselineDiffs)
				: collectStoredAddedTokens(storedDomains),
		[data?.baselineDiffs, storedDomains],
	);
	const overriddenTokens = useMemo(
		() =>
			data?.baselineDiffs
				? collectSyncOverriddenTokens(data.baselineDiffs)
				: collectStoredOverriddenTokens(storedDomains),
		[data?.baselineDiffs, storedDomains],
	);
	const removedTokens = useMemo(
		() =>
			data?.baselineDiffs
				? collectSyncRemovedTokens(data.baselineDiffs)
				: collectStoredRemovedTokens(storedDomains),
		[data?.baselineDiffs, storedDomains],
	);
	const suggestedOverridesByDomain = useMemo(
		() => computeSuggestedTokenOverridesByDomain(removedTokens),
		[removedTokens],
	);
	const storedSyncedTokenEntries = useMemo(() => {
		if (data?.tokens) {
			return data.tokens;
		}

		if (!storedDomains) {
			return [];
		}

		return Object.entries(storedDomains).flatMap(([domain, storage]) =>
			Object.entries(storage.tokens).map(([name, value]) => ({
				name,
				value,
				domain: domain as TailwindTokenDomain,
			})),
		);
	}, [data?.tokens, storedDomains]);
	const syncedTokens = useMemo(() => {
		if (!data?.baselineDiffs && !storedDomains) {
			return [];
		}

		return buildCompleteSyncedTokens({
			addedTokens,
			extraTokens: storedSyncedTokenEntries,
			overriddenTokens,
			removedTokens,
		});
	}, [
		addedTokens,
		data?.baselineDiffs,
		overriddenTokens,
		removedTokens,
		storedDomains,
		storedSyncedTokenEntries,
	]);
	const allTokenSections = useMemo(
		() =>
			filterAndGroupTokenRowsByDomain(
				syncedTokens,
				(token) => ({
					name: token.name,
					value: token.value,
				}),
				{
					domainOrder: [...TAILWIND_TOKEN_DOMAINS],
					getDomainLabel: formatDomainLabel,
				},
			),
		[syncedTokens],
	);
	const defaultTokenCount = useMemo(
		() => syncedTokens.filter((token) => token.status === "default").length,
		[syncedTokens],
	);
	const visibleSyncedTokens = useMemo(
		() =>
			hideDefaultTokens
				? syncedTokens.filter((token) => token.status !== "default")
				: syncedTokens,
		[hideDefaultTokens, syncedTokens],
	);
	const availableTokenSections = useMemo(
		() =>
			filterAndGroupTokenRowsByDomain(
				visibleSyncedTokens,
				(token) => ({
					name: token.name,
					value: token.value,
				}),
				{
					domainOrder: [...TAILWIND_TOKEN_DOMAINS],
					getDomainLabel: formatDomainLabel,
				},
			),
		[visibleSyncedTokens],
	);
	const filteredTokenSections = useMemo(
		() =>
			filterAndGroupTokenRowsByDomain(
				visibleSyncedTokens,
				(token) => ({
					name: token.name,
					value: token.value,
				}),
				{
					filter: tokenFilter,
					domainFilter: activeTokenDomains,
					domainOrder: [...TAILWIND_TOKEN_DOMAINS],
					getDomainLabel: formatDomainLabel,
				},
			),
		[activeTokenDomains, tokenFilter, visibleSyncedTokens],
	);
	const filteredSyncedTokens = useMemo(
		() =>
			filterTokenRows(visibleSyncedTokens, {
				filter: tokenFilter,
				domainFilter: activeTokenDomains,
			}),
		[activeTokenDomains, tokenFilter, visibleSyncedTokens],
	);
	const nonVisualTokenSections = useMemo(
		() =>
			filteredTokenSections.filter(
				(section) => !visualTokenDomainSet.has(section.domain),
			),
		[filteredTokenSections],
	);
	const tokenDomainPills = useMemo(
		() =>
			deriveTokenDomainPills({
				sections: availableTokenSections,
				activeDomains: activeTokenDomains,
			}),
		[activeTokenDomains, availableTokenSections],
	);
	const changeRows = useMemo(
		() =>
			buildTokenChangeRows({
				addedTokens,
				overriddenTokens,
				removedTokens,
			}),
		[addedTokens, overriddenTokens, removedTokens],
	);
	const filteredChangeRows = useMemo(
		() =>
			filterTokenRows(changeRows, {
				filter: tokenFilter,
				domainFilter: activeTokenDomains,
			}),
		[activeTokenDomains, changeRows, tokenFilter],
	);
	const tokenDiff = useMemo<TokenDiff>(
		() => ({
			added: addedTokens.length,
			overridden: overriddenTokens.length,
			removed: removedTokens.length,
		}),
		[addedTokens.length, overriddenTokens.length, removedTokens.length],
	);
	const totalTokenCount = syncedTokens.length;
	const domainCount = allTokenSections.length;
	const showingSyncedRows = !reviewRequired;
	const filteredTokenCount = showingSyncedRows
		? groupMode === "domain"
			? filteredTokenSections.reduce(
					(count, section) => count + section.rows.length,
					0,
				)
			: filteredSyncedTokens.length
		: filteredChangeRows.length;
	const status = getSyncState({
		result,
		reviewRequired,
		hasStoredSnapshot: Boolean(storedTokensQuery.data),
	});
	const systemName =
		data?.systemName ??
		storedTokensQuery.data?.systemName ??
		target?.systemName ??
		systemId;
	const cssPath =
		data?.cssPath ??
		storedTokensQuery.data?.cssPath ??
		target?.cssPath ??
		"./src/index.css";
	const syncedAt = data?.syncedAt ?? storedTokensQuery.data?.syncedAt ?? null;
	const baselineVersion =
		data?.tailwindBaselineVersion ??
		storedTokensQuery.data?.tailwindBaselineVersion ??
		null;
	const isSyncing = result.status === "pending";
	const storedTokensError =
		storedTokensQuery.error instanceof Error
			? storedTokensQuery.error.message
			: null;
	const syncError = result.error?.message ?? null;
	const saveMutation = useMutation({
		mutationFn: (overridesByDomain: TokenOverridesByDomain) =>
			saveAndConfirmTailwindTokens({
				systemId,
				domains: toTokenSaveDomains(overridesByDomain),
			}),
		onSuccess: async (response) => {
			queryClient.setQueryData(storedTokensQueryKeyValue, response);
			await queryClient.invalidateQueries({
				queryKey: storedTokensQueryKeyValue,
			});
			await syncController.syncSystem(systemId);
		},
	});
	const saveError =
		saveMutation.error instanceof Error ? saveMutation.error.message : null;
	const hasStoredSnapshot = Boolean(storedTokensQuery.data);
	const confirmReviewDisabled = !canConfirmTokenReview({
		hasStoredSnapshot,
		hasSyncResult: Boolean(data),
		isSaving: saveMutation.isPending,
		isStoredSnapshotPending: storedTokensQuery.isPending,
		reviewRequired,
	});
	const discardReviewDisabled =
		!reviewRequired ||
		saveMutation.isPending ||
		storedTokensQuery.isPending ||
		!hasStoredSnapshot;
	const handleSync = useCallback(() => {
		void syncController
			.syncSystem(systemId)
			.then(() =>
				queryClient.invalidateQueries({ queryKey: storedTokensQueryKeyValue }),
			);
	}, [queryClient, storedTokensQueryKeyValue, syncController, systemId]);
	const handleConfirmReview = useCallback(() => {
		if (confirmReviewDisabled) {
			return;
		}
		saveMutation.mutate(suggestedOverridesByDomain);
	}, [confirmReviewDisabled, saveMutation, suggestedOverridesByDomain]);
	useHotkey("Mod+S", handleConfirmReview, {
		enabled: isActive,
		preventDefault: true,
	});
	const handleDiscardReviewSuggestions = useCallback(() => {
		if (discardReviewDisabled) {
			return;
		}
		saveMutation.mutate(storedOverridesByDomain);
	}, [discardReviewDisabled, saveMutation, storedOverridesByDomain]);
	const handleTokenDomainToggle = useCallback((domain: string) => {
		setActiveTokenDomains((domains) => {
			if (domains.length === 0) {
				return [domain];
			}

			if (domains.includes(domain)) {
				return domains.filter((activeDomain) => activeDomain !== domain);
			}

			return [...domains, domain];
		});
	}, []);
	const handleDefaultTokenToggle = useCallback(() => {
		setHideDefaultTokens((hidden) => !hidden);
	}, []);
	const handleTokenSectionToggle = useCallback((domain: string) => {
		setCollapsedTokenDomains((domains) =>
			domains.includes(domain)
				? domains.filter((collapsedDomain) => collapsedDomain !== domain)
				: [...domains, domain],
		);
	}, []);

	if (storedTokensQuery.isPending && !data) {
		return (
			<div className="flex min-h-0 flex-1 flex-col bg-slate-50">
				<TokenMasthead
					systemId={systemId}
					systemName={systemName}
					cssPath={cssPath}
					syncedAt={syncedAt}
					baselineVersion={baselineVersion}
					status={status}
					tokenCount={0}
					domainCount={0}
					diff={{ added: 0, overridden: 0, removed: 0 }}
					isSyncing={isSyncing}
					onSync={handleSync}
					syncDisabled={isSyncing}
					canExport={false}
				/>
				<div className="px-10 py-8 text-sm text-slate-500">
					Loading token snapshot...
				</div>
			</div>
		);
	}

	if (storedTokensQuery.isError && !data) {
		return (
			<div className="flex min-h-0 flex-1 flex-col bg-slate-50">
				<TokenMasthead
					systemId={systemId}
					systemName={systemName}
					cssPath={cssPath}
					syncedAt={syncedAt}
					baselineVersion={baselineVersion}
					status="error"
					tokenCount={0}
					domainCount={0}
					diff={{ added: 0, overridden: 0, removed: 0 }}
					isSyncing={isSyncing}
					onSync={handleSync}
					syncDisabled={isSyncing}
					canExport={false}
				/>
				<div
					className="mx-10 my-8 flex items-start gap-3 border border-red-200 bg-red-50 px-4 py-4"
					role="alert"
				>
					<AlertTriangle
						className="mt-0.5 size-4 shrink-0 text-red-600"
						aria-hidden="true"
					/>
					<div className="min-w-0">
						<p className="text-sm font-medium text-red-950">
							Failed to load tokens
						</p>
						<p className="mt-1 text-xs text-red-700">{storedTokensError}</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-slate-50 text-slate-950">
			<TokenMasthead
				systemId={systemId}
				systemName={systemName}
				cssPath={cssPath}
				syncedAt={syncedAt}
				baselineVersion={baselineVersion}
				status={status}
				tokenCount={totalTokenCount}
				domainCount={domainCount}
				diff={
					reviewRequired ? tokenDiff : { added: 0, overridden: 0, removed: 0 }
				}
				isSyncing={isSyncing}
				onSync={handleSync}
				syncDisabled={isSyncing}
				canExport={hasStoredSnapshot}
			/>
			{reviewRequired ? (
				<ReviewBanner
					diff={tokenDiff}
					saveError={saveError}
					isSaving={saveMutation.isPending}
					confirmDisabled={confirmReviewDisabled}
					discardDisabled={discardReviewDisabled}
					onConfirm={handleConfirmReview}
					onDiscard={handleDiscardReviewSuggestions}
				/>
			) : null}
			{syncError ? (
				<div className="border-b border-red-200 bg-red-50 px-10 py-2 text-xs text-red-700">
					{syncError}
				</div>
			) : null}
			{totalTokenCount === 0 && changeRows.length === 0 ? (
				<div className="px-10 py-8">
					<EmptyTokenState title="No stored tokens">
						Sync this system to populate the design-token snapshot.
					</EmptyTokenState>
				</div>
			) : (
				<div className="flex min-h-0 flex-1 flex-col bg-white">
					<TokenToolbar
						groupMode={groupMode}
						onGroupModeChange={setGroupMode}
						filter={tokenFilter}
						filterInputRef={tokenFilterInputRef}
						onFilterChange={setTokenFilter}
						onClearFilter={() => setTokenFilter("")}
						showDefaultFilter={showingSyncedRows}
						hideDefaultTokens={hideDefaultTokens}
						onToggleDefaultTokens={handleDefaultTokenToggle}
						defaultTokenCount={defaultTokenCount}
						pills={tokenDomainPills}
						onToggleDomain={handleTokenDomainToggle}
						onClearDomains={() => setActiveTokenDomains([])}
						filteredCount={filteredTokenCount}
						totalCount={
							showingSyncedRows ? visibleSyncedTokens.length : changeRows.length
						}
					/>
					{groupMode === "domain" && !reviewRequired ? (
						<>
							<VisualTokenSections sections={filteredTokenSections} />
							{filteredTokenSections.length === 0 ? (
								<p className="px-10 py-8 text-sm text-slate-500">
									No tokens match the current filters.
								</p>
							) : nonVisualTokenSections.length > 0 ? (
								<DomainTokenBrowser
									sections={nonVisualTokenSections}
									collapsedDomains={collapsedTokenDomains}
									onToggleDomain={handleTokenSectionToggle}
								/>
							) : null}
						</>
					) : groupMode === "domain" ? (
						<DomainGroupedChanges
							rows={filteredChangeRows}
							emptyMessage="No token changes match the current filters."
						/>
					) : reviewRequired ? (
						<StatusGroupedChanges
							rows={filteredChangeRows}
							isRemovedCollapsed={isRemovedCollapsed}
							onToggleRemoved={() =>
								setIsRemovedCollapsed((collapsed) => !collapsed)
							}
							emptyMessage={
								reviewRequired
									? "No token changes match the current filters."
									: "No token status records match the current filters."
							}
						/>
					) : (
						<SyncedStatusTokenBrowser tokens={filteredSyncedTokens} />
					)}
					<CustomUtilitiesSection
						customProperties={storedTokensQuery.data?.customProperties}
						customUtilities={storedTokensQuery.data?.customUtilities}
					/>
				</div>
			)}
		</div>
	);
}
