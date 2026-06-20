import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Check,
	ChevronDown,
	ChevronRight,
	Copy,
	Folder,
	RefreshCw,
	Save,
	Search,
	Trash2,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router";
import { getTrickroomDesktopApi } from "../../desktop-api";
import type { TailwindSyncResult } from "../../hooks/useTailwindSyncController";
import {
	configFileProjectQueryKey,
	configFileQueryKey,
} from "../../queries/config-file";
import type { ProjectQueryScope } from "../../queries/project-scope";
import { sessionQueryOptions } from "../../queries/projects";
import {
	systemAssetsQueryOptions,
} from "../../queries/system-assets";
import {
	addSystemIconFolder,
	removeSystemIconFolder,
	syncSystemIconsMutation,
	systemIconSvgQueriesQueryKey,
	systemIconsQueryKey,
	systemIconsQueryOptions,
} from "../../queries/system-icons";
import { systemUsedByQueryOptions } from "../../queries/system-used-by";
import {
	deleteSystem,
	systemsQueryKey,
	updateSystem,
} from "../../queries/systems";
import {
	type StoredTailwindTokensResponse,
	saveAndConfirmTailwindTokens,
	storedTailwindTokensQueryKey,
	storedTailwindTokensQueryOptions,
} from "../../queries/tailwind-sync-tokens";
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
import { useProjectScope, useTailwindSyncController } from "../contexts";
import { Button } from "../ui/button";
import { ConfirmationDialog } from "../ui/dialog";
import { Input, TextareaField } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../ui/tabs";
import { Text } from "../ui/text";
import { formatRelativeTime } from "./project-view-utils";
import { SystemDiffChips } from "./SystemDiffChips";
import {
	SystemStatusBadge,
	type SystemStatusBadgeState,
} from "./SystemStatusBadge";
import type { SystemTab } from "./SystemTabBar";
import {
	deriveTokenDomainPills,
	filterAndGroupTokenRowsByDomain,
	groupTokenRowsByDomain,
	SystemTokenSwatch,
	TokenDomainPills,
	TokenDomainSectionList,
	TokenFilterInput,
} from "./SystemTokenRows";

function getCssBasename(cssPath: string) {
	return cssPath.split(/[\\/]/).pop() || cssPath;
}

function toProjectRelativePath(path: string, projectRoot: string) {
	const normalizedPath = path.trim().replaceAll("\\", "/").replace(/\/+$/, "");
	const normalizedRoot = projectRoot
		.trim()
		.replaceAll("\\", "/")
		.replace(/\/+$/, "");

	if (!normalizedPath || !normalizedRoot || normalizedPath === normalizedRoot) {
		return null;
	}

	const rootPrefix = `${normalizedRoot}/`;
	if (!normalizedPath.startsWith(rootPrefix)) {
		return null;
	}

	return normalizedPath.slice(rootPrefix.length);
}

function getSyncState(
	result: TailwindSyncResult,
	reviewRequired: boolean,
): SystemStatusBadgeState {
	if (result.status === "error") {
		return "error";
	}

	if (result.status === "pending") {
		return "syncing";
	}

	if (result.status === "idle") {
		return "idle";
	}

	if (reviewRequired) {
		return "review";
	}

	return "synced";
}

export const getSystemEditorPath = (systemId: string) =>
	`/system/${encodeURIComponent(systemId)}`;

export function OpenSystemEditorAction({
	systemId,
	disabled,
}: {
	systemId: string;
	disabled?: boolean;
}) {
	const navigate = useNavigate();

	return (
		<Button
			type="button"
			variant="block"
			onClick={() => navigate(getSystemEditorPath(systemId))}
			disabled={disabled}
		>
			Open in editor
		</Button>
	);
}

type TokenDiff = {
	added: number;
	overridden: number;
	removed: number;
};

type TokenDiffSectionTone = "added" | "overridden" | "removed" | "unchanged";

type TokenDiffSection = {
	key: TokenDiffSectionTone;
	label: string;
	count: number;
	sections: ReturnType<typeof groupTokenRowsByDomain>;
	emptyMessage: string;
	domainEmptyMessage: string;
	tone: TokenDiffSectionTone;
};

type StoredTokenDomains = StoredTailwindTokensResponse["domains"];
type TokenOverridesByDomain = Partial<Record<TailwindTokenDomain, string[]>>;

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

export function getNextTokenOverridesByDomain({
	reviewRequired,
	suggestedOverrides,
	storedOverrides,
}: {
	reviewRequired: boolean;
	suggestedOverrides: TokenOverridesByDomain;
	storedOverrides: TokenOverridesByDomain;
}) {
	if (!reviewRequired) {
		return cloneTokenOverridesByDomain(storedOverrides);
	}

	return cloneTokenOverridesByDomain(suggestedOverrides);
}

export function getNextColorOverrides({
	reviewRequired,
	suggestedOverrides,
	storedOverrides,
}: {
	reviewRequired: boolean;
	suggestedOverrides: readonly string[];
	storedOverrides: readonly string[];
}) {
	return getNextTokenOverridesByDomain({
		reviewRequired,
		suggestedOverrides: { color: [...suggestedOverrides] },
		storedOverrides: { color: [...storedOverrides] },
	}).color;
}

function collectSyncAddedTokens(
	baselineDiffs: TailwindTokenDomainDiffs | undefined,
): TailwindTokenEntry[] {
	return TAILWIND_TOKEN_DOMAINS.flatMap(
		(domain) => baselineDiffs?.[domain].added ?? [],
	);
}

function collectStoredAddedTokens(
	domains: StoredTokenDomains | undefined,
): TailwindTokenEntry[] {
	return TAILWIND_TOKEN_DOMAINS.flatMap(
		(domain) => domains?.[domain].baselineDiff.added ?? [],
	);
}

function collectSyncOverriddenTokens(
	baselineDiffs: TailwindTokenDomainDiffs | undefined,
): TailwindOverriddenTokenEntry[] {
	return TAILWIND_TOKEN_DOMAINS.flatMap(
		(domain) => baselineDiffs?.[domain].overridden ?? [],
	);
}

function collectStoredOverriddenTokens(
	domains: StoredTokenDomains | undefined,
): TailwindOverriddenTokenEntry[] {
	return TAILWIND_TOKEN_DOMAINS.flatMap(
		(domain) => domains?.[domain].baselineDiff.overridden ?? [],
	);
}

function collectSyncRemovedTokens(
	baselineDiffs: TailwindTokenDomainDiffs | undefined,
): TailwindDefaultTokenEntry[] {
	return TAILWIND_TOKEN_DOMAINS.flatMap(
		(domain) => baselineDiffs?.[domain].removed ?? [],
	);
}

function collectStoredRemovedTokens(
	domains: StoredTokenDomains | undefined,
): TailwindDefaultTokenEntry[] {
	return TAILWIND_TOKEN_DOMAINS.flatMap(
		(domain) => domains?.[domain].baselineDiff.removed ?? [],
	);
}

function collectSyncUnchangedTokens(
	baselineDiffs: TailwindTokenDomainDiffs | undefined,
): TailwindOverriddenTokenEntry[] {
	return TAILWIND_TOKEN_DOMAINS.flatMap(
		(domain) => baselineDiffs?.[domain].unchanged ?? [],
	);
}

function getStoredTokenOverridesByDomain(
	domains: StoredTokenDomains | undefined,
) {
	return cloneTokenOverridesByDomain(
		Object.fromEntries(
			TAILWIND_TOKEN_DOMAINS.map((domain) => [
				domain,
				domains?.[domain].overrides ?? [],
			]),
		) as TokenOverridesByDomain,
	);
}

function computeSuggestedTokenOverridesByDomain(
	removedTokens: readonly TailwindDefaultTokenEntry[],
) {
	const colorRemovedTokens = removedTokens.filter(
		(token) => token.domain === "color",
	);
	const overridesByDomain: TokenOverridesByDomain = {
		color: computeColorOverrides(colorRemovedTokens),
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

function flattenTokenOverridesByDomain(
	overridesByDomain: TokenOverridesByDomain,
) {
	return TAILWIND_TOKEN_DOMAINS.flatMap(
		(domain) => overridesByDomain[domain] ?? [],
	);
}

function tokenOverridesByDomainChanged(
	left: TokenOverridesByDomain,
	right: TokenOverridesByDomain,
) {
	return (
		JSON.stringify(cloneTokenOverridesByDomain(left)) !==
		JSON.stringify(cloneTokenOverridesByDomain(right))
	);
}

function toTokenSaveDomains(overridesByDomain: TokenOverridesByDomain) {
	return Object.fromEntries(
		TAILWIND_TOKEN_DOMAINS.map((domain) => [
			domain,
			{ overrides: overridesByDomain[domain] ?? [] },
		]),
	) as Record<TailwindTokenDomain, { overrides: string[] }>;
}

function SystemDetailTabBar() {
	const tabClassName =
		"px-3 py-2 text-sm font-medium text-slate-700 data-active:bg-cyan-100 data-active:text-cyan-900 not-disabled:hover:bg-slate-100 data-active:hover:bg-cyan-100";

	return (
		<TabsList className="flex flex-row flex-wrap border-b border-slate-200">
			<TabsTab className={tabClassName} value="overview">
				Overview
			</TabsTab>
			<TabsTab className={tabClassName} value="tokens">
				Tokens
			</TabsTab>
			<TabsTab className={tabClassName} value="settings">
				Settings
			</TabsTab>
		</TabsList>
	);
}

function SystemDetailHeader({
	title,
	status,
	subline,
	diff,
	primaryAction,
	secondaryAction,
	errors,
}: {
	title: ReactNode;
	status: SystemStatusBadgeState;
	subline: string;
	diff: TokenDiff;
	primaryAction?: ReactNode;
	secondaryAction?: ReactNode;
	errors?: ReactNode;
}) {
	const isSyncing = status === "syncing";

	return (
		<header className="relative border-b border-slate-200">
			{isSyncing ? (
				<div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-cyan-100/70">
					<div className="h-full w-full animate-pulse bg-cyan-500" />
				</div>
			) : null}
			<div className="flex items-start justify-between gap-4 px-10 pt-8 pb-6">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<Text variant="eyebrow" className="text-amber-700">
						System
					</Text>
					<div className="flex min-w-0 flex-wrap items-center gap-3">
						{title}
						<SystemStatusBadge state={status} />
					</div>
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<span className="min-w-0 truncate font-mono text-[11px] text-slate-500">
							{subline}
						</span>
						{diff.added > 0 || diff.overridden > 0 || diff.removed > 0 ? (
							<SystemDiffChips
								added={diff.added}
								overridden={diff.overridden}
								removed={diff.removed}
							/>
						) : null}
					</div>
					{errors}
				</div>
				{secondaryAction ? (
					<div className="flex shrink-0 items-center gap-2">
						{secondaryAction}
					</div>
				) : null}
				{primaryAction ? (
					<div className="flex shrink-0 items-center gap-2">
						{primaryAction}
					</div>
				) : null}
			</div>
		</header>
	);
}

const tokenDiffSectionHeaderClassNames: Record<TokenDiffSectionTone, string> = {
	added: "bg-green-50",
	overridden: "bg-amber-50",
	removed: "bg-red-50",
	unchanged: "bg-slate-50",
};

const tokenDiffSectionTitleClassNames: Record<TokenDiffSectionTone, string> = {
	added: "text-green-900",
	overridden: "text-amber-900",
	removed: "text-red-900",
	unchanged: "text-slate-900",
};

const tokenDiffSectionCountClassNames: Record<TokenDiffSectionTone, string> = {
	added: "text-green-700",
	overridden: "text-amber-700",
	removed: "text-red-700",
	unchanged: "text-slate-500",
};

function TokenDiffSectionCard({
	section,
	renderRows = true,
	children,
	isCollapsed = false,
	onToggle,
}: {
	section: TokenDiffSection;
	renderRows?: boolean;
	children?: ReactNode;
	isCollapsed?: boolean;
	onToggle?: () => void;
}) {
	const effectiveCount = section.sections.reduce(
		(rowCount, sectionDomain) => rowCount + sectionDomain.rows.length,
		0,
	);
	const hasRows = effectiveCount > 0;
	const canCollapse = typeof onToggle === "function";
	const Icon = isCollapsed ? ChevronRight : ChevronDown;
	const headerContent = (
		<div className="flex items-center gap-2">
			{canCollapse ? (
				<Icon className="size-3.5 shrink-0 self-center" aria-hidden="true" />
			) : null}
			<Text
				variant="subtitle"
				className={tokenDiffSectionTitleClassNames[section.tone]}
			>
				{section.label}
			</Text>
			<span
				className="size-1 rounded-full bg-current opacity-30"
				aria-hidden="true"
			/>
			<span
				className={`font-mono text-xs ${tokenDiffSectionCountClassNames[section.tone]}`}
			>
				{hasRows ? effectiveCount : section.count}
			</span>
		</div>
	);

	return (
		<div className="flex flex-col border border-slate-200 bg-white">
			{canCollapse ? (
				<button
					type="button"
					className={`flex items-center px-4 py-3 text-left ${tokenDiffSectionHeaderClassNames[section.tone]} ${tokenDiffSectionTitleClassNames[section.tone]}`}
					onClick={onToggle}
					aria-expanded={!isCollapsed}
				>
					{headerContent}
				</button>
			) : (
				<div
					className={`flex items-center px-4 py-3 ${tokenDiffSectionHeaderClassNames[section.tone]} ${tokenDiffSectionTitleClassNames[section.tone]}`}
				>
					{headerContent}
				</div>
			)}
			{isCollapsed ? null : (
				<>
					{renderRows && hasRows ? (
						section.sections.map((domainSection) => (
							<TokenDomainSectionList
								key={domainSection.domain}
								section={domainSection}
								emptyMessage={section.domainEmptyMessage}
							/>
						))
					) : renderRows ? (
						<p className="px-4 py-6 text-sm text-slate-500">
							{section.emptyMessage}
						</p>
					) : null}
					{children}
				</>
			)}
		</div>
	);
}

function TokenSyncErrorCard({ message }: { message: string | null }) {
	return (
		<div className="flex flex-col border border-red-200 bg-white" role="alert">
			<div className="flex items-baseline justify-between bg-red-50 px-3 py-2">
				<div className="flex items-baseline gap-2">
					<Text variant="subtitle" className="text-red-950">
						Tokens
					</Text>
					<span className="font-mono text-xs text-red-700">Error</span>
				</div>
			</div>
			<div className="flex items-start gap-3 border-t border-red-100 px-4 py-4">
				<AlertTriangle
					className="mt-0.5 size-4 shrink-0 text-red-600"
					aria-hidden="true"
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<Text variant="subtitle" className="text-red-950">
						Token sync failed
					</Text>
					<p className="text-sm text-red-700">
						{message ?? "The token sync did not complete."}
					</p>
				</div>
			</div>
		</div>
	);
}

function ColorOverrideDeclarationRows({
	overrides,
	emptyMessage,
}: {
	overrides: readonly string[];
	emptyMessage: string;
}) {
	if (overrides.length === 0) {
		return <p className="px-4 py-6 text-sm text-slate-500">{emptyMessage}</p>;
	}

	return (
		<div className="flex flex-wrap gap-1.5">
			{overrides.map((override) => (
				<code
					key={override}
					className="inline-flex min-w-0 max-w-full items-center truncate bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-900 inset-shadow-[0_0_0_1px] inset-shadow-slate-200"
				>
					{override}: initial;
				</code>
			))}
		</div>
	);
}

function ColorOverridesBlock({
	overrides,
	description,
}: {
	overrides: readonly string[];
	description: string;
}) {
	return (
		<div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3">
			<div className="flex items-baseline gap-2">
				<span className="text-sm font-medium text-slate-900">
					Override declarations
				</span>
				<span className="font-mono text-xs text-slate-500">
					{overrides.length}
				</span>
			</div>
			<p className="text-xs text-slate-600">{description}</p>
			<ColorOverrideDeclarationRows
				overrides={overrides}
				emptyMessage="No override declarations are needed for these changes."
			/>
		</div>
	);
}

function CompactTokenSectionList({
	sections,
	emptyMessage,
}: {
	sections: ReturnType<typeof groupTokenRowsByDomain>;
	emptyMessage: string;
}) {
	const rows = sections.flatMap((section) =>
		section.rows.map((row) => ({
			...row,
			key: `${section.domain}:${row.name}`,
		})),
	);

	if (rows.length === 0) {
		return <p className="px-4 py-6 text-sm text-slate-500">{emptyMessage}</p>;
	}

	return (
		<div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-4 py-3">
			{rows.map((row) => (
				<span
					key={row.key}
					className="inline-flex max-w-full items-center gap-1.5 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-800 inset-shadow-[0_0_0_1px] inset-shadow-slate-200"
					title={`${row.name} ${row.value}`}
				>
					<SystemTokenSwatch value={row.value} />
					<span className="min-w-0 truncate">{row.name}</span>
				</span>
			))}
		</div>
	);
}

function DenseTokenSectionList({
	sections,
	emptyMessage,
}: {
	sections: ReturnType<typeof groupTokenRowsByDomain>;
	emptyMessage: string;
}) {
	const rowCount = sections.reduce(
		(count, section) => count + section.rows.length,
		0,
	);

	if (rowCount === 0) {
		return <p className="px-4 py-6 text-sm text-slate-500">{emptyMessage}</p>;
	}

	return (
		<div className="flex flex-col border-t border-slate-100">
			{sections.map((section) => (
				<div
					key={section.domain}
					className="border-t border-slate-100 px-4 py-3 first:border-t-0"
				>
					<div className="mb-2 flex items-baseline gap-2">
						<span className="text-xs font-bold text-slate-500 uppercase">
							{section.label}
						</span>
						<span className="font-mono text-[10px] text-slate-400">
							{section.rows.length}
						</span>
					</div>
					<div className="flex flex-wrap gap-1.5">
						{section.rows.map((row) => (
							<span
								key={`${section.domain}:${row.name}`}
								className="inline-flex min-w-0 max-w-full items-center gap-1.5 bg-slate-50 px-2 py-1 text-slate-900 inset-shadow-[0_0_0_1px] inset-shadow-slate-200"
								title={`${row.name}: ${row.value}`}
							>
								<SystemTokenSwatch value={row.value} />
								<span className="max-w-40 truncate font-mono text-[11px]">
									{row.name}
								</span>
								<span className="max-w-56 truncate border-l border-slate-200 pl-1.5 font-mono text-[10px] text-slate-500">
									{row.value}
								</span>
							</span>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

function TokenDiffMiniBar({ diff }: { diff: TokenDiff }) {
	const total = diff.added + diff.overridden + diff.removed;
	if (total === 0) {
		return null;
	}

	const segments = [
		{
			key: "added",
			width: (diff.added / total) * 100,
			className: "bg-emerald-500",
			label: `+${diff.added}`,
		},
		{
			key: "overridden",
			width: (diff.overridden / total) * 100,
			className: "bg-amber-500",
			label: `~${diff.overridden}`,
		},
		{
			key: "removed",
			width: (diff.removed / total) * 100,
			className: "bg-rose-500",
			label: `-${diff.removed}`,
		},
	];

	return (
		<div className="mt-2 flex flex-col gap-1.5">
			<div className="flex h-1.5 overflow-hidden bg-slate-100">
				{segments.map((segment) => (
					<span
						key={segment.key}
						className={`block h-full ${segment.className}`}
						style={{ width: `${segment.width}%` }}
						aria-hidden="true"
					/>
				))}
			</div>
			<div className="flex items-center gap-1.5 text-[10px] text-slate-500">
				<span className="font-medium text-emerald-700">
					{segments[0].label}
				</span>
				<span className="font-medium text-amber-700">{segments[1].label}</span>
				<span className="font-medium text-rose-700">{segments[2].label}</span>
			</div>
		</div>
	);
}

function SystemOverviewTokenMetricCard({
	tokenCount,
	diff,
}: {
	tokenCount: number | null;
	diff: TokenDiff;
}) {
	const tokenValue =
		tokenCount === null ? "Not synced" : tokenCount.toLocaleString();

	return (
		<div className="flex min-h-32 min-w-0 flex-col bg-white inset-shadow-[0_0_0_1px] inset-shadow-slate-200">
			<div className="flex items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-slate-950">
				Tokens
			</div>
			<div className="flex min-w-0 flex-1 flex-col justify-end gap-1 border-t border-slate-100 px-4 py-3">
				<div
					className="truncate text-2xl font-medium text-slate-950"
					title={String(tokenValue)}
				>
					{tokenValue}
				</div>
				<div className="truncate text-xs text-slate-500">
					Stored token records
				</div>
				<TokenDiffMiniBar diff={diff} />
			</div>
		</div>
	);
}

function SystemOverviewSubview({
	cssPath,
	syncedAtLabel,
	tokenCount,
	tokenDiff,
	projectScope,
	systemId,
}: {
	cssPath: string;
	syncedAtLabel: string;
	tokenCount: number | null;
	tokenDiff: TokenDiff;
	projectScope?: ProjectQueryScope;
	systemId: string;
}) {
	const [copiedSystemId, setCopiedSystemId] = useState(false);
	const systemIdCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const assetsQuery = useQuery(
		systemAssetsQueryOptions(systemId, projectScope),
	);
	const assets = assetsQuery.data?.assets ?? [];
	const iconFoldersQuery = useQuery(
		systemIconsQueryOptions(systemId, projectScope),
	);
	const iconCount = iconFoldersQuery.data?.icons.length ?? 0;
	const iconSampleRow = iconFoldersQuery.data?.iconFolderPaths[0];
	const iconDiagnosticCount = iconFoldersQuery.data?.diagnostics.length ?? 0;
	const usedByQuery = useQuery(
		systemUsedByQueryOptions(systemId, projectScope),
	);
	const usedByCount = usedByQuery.isPending
		? "Loading..."
		: usedByQuery.isError
			? "Unavailable"
			: (usedByQuery.data?.usedByCount ?? 0).toLocaleString();
	const usedByDetail = usedByQuery.isError
		? "Could not load usage count"
		: "Design usage count";
	const copySystemId = () => {
		const copyText = async () => {
			const desktopApi = getTrickroomDesktopApi();
			if (desktopApi?.clipboard) {
				await desktopApi.clipboard.writeText(systemId);
			} else {
				await navigator.clipboard.writeText(systemId);
			}
		};

		void copyText()
			.then(() => {
				setCopiedSystemId(true);
				if (systemIdCopyTimeoutRef.current) {
					clearTimeout(systemIdCopyTimeoutRef.current);
				}
				systemIdCopyTimeoutRef.current = setTimeout(() => {
					setCopiedSystemId(false);
				}, 1500);
			})
			.catch(() => {
				setCopiedSystemId(false);
			});
	};
	useEffect(() => {
		return () => {
			if (systemIdCopyTimeoutRef.current) {
				clearTimeout(systemIdCopyTimeoutRef.current);
			}
		};
	}, []);

	const iconLabel = iconFoldersQuery.isPending
		? "Loading..."
		: iconFoldersQuery.isError
			? "Error"
			: `${iconCount.toLocaleString()}`;
	const iconDetail = iconFoldersQuery.isPending
		? "Loading icon index..."
		: iconFoldersQuery.isError
			? iconFoldersQuery.error instanceof Error
				? iconFoldersQuery.error.message
				: "Failed to load icon index"
			: `${iconSampleRow ?? "No icon folders"} · ${iconDiagnosticCount} diagnostic${iconDiagnosticCount === 1 ? "" : "s"}`;

	const metricCards = [
		{
			label: "Assets",
			value: assetsQuery.isPending
				? "..."
				: assetsQuery.isError
					? "Error"
					: assets.length.toLocaleString(),
			detail: assetsQuery.isPending
				? "Loading assets"
				: assetsQuery.isError
					? "Failed to load assets"
					: "Indexed asset images",
		},
		{
			label: "Icons",
			value: iconLabel,
			detail: iconDetail,
		},
		{
			label: "Used By",
			value: usedByCount,
			detail: usedByDetail,
		},
		{
			label: "Last Sync",
			value: syncedAtLabel,
			detail: getCssBasename(cssPath),
		},
		{
			label: "System ID",
			value: systemId,
			detail: "Project config key",
			isMonospace: true,
			showCopy: true,
		},
	];

	return (
		<div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
			<SystemOverviewTokenMetricCard tokenCount={tokenCount} diff={tokenDiff} />
			{metricCards.map((card) => (
				<div
					key={card.label}
					className="flex min-h-32 min-w-0 flex-col bg-white inset-shadow-[0_0_0_1px] inset-shadow-slate-200"
				>
					<div className="flex items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-slate-950">
						{card.label}
					</div>
					<div className="flex min-w-0 flex-1 flex-col justify-end gap-1 border-t border-slate-100 px-4 py-3">
						<div className="flex min-w-0 items-center gap-2">
							<div
								className={`min-w-0 flex-1 truncate text-2xl font-medium text-slate-950 ${
									card.isMonospace ? "font-mono text-lg" : ""
								}`}
								title={String(card.value)}
							>
								{card.value}
							</div>
							{card.showCopy ? (
								<Button
									variant="block"
									className="shrink-0 p-2"
									aria-label={
										copiedSystemId ? "Copied system id" : "Copy system id"
									}
									onClick={copySystemId}
								>
									<Copy
										className={`size-4 ${copiedSystemId ? "text-cyan-600" : ""}`}
										aria-hidden="true"
									/>
								</Button>
							) : null}
						</div>
						<div className="truncate text-xs text-slate-500">{card.detail}</div>
					</div>
				</div>
			))}
		</div>
	);
}

function SettingsSection({
	title,
	children,
	tone = "default",
}: {
	title: string;
	children: ReactNode;
	tone?: "default" | "danger";
}) {
	return (
		<section
			className={`flex flex-col border bg-white ${
				tone === "danger" ? "border-red-200" : "border-slate-200"
			}`}
		>
			<div
				className={`flex items-baseline px-4 py-3 text-sm font-bold ${
					tone === "danger" ? "bg-red-50 text-red-900" : "text-slate-950"
				}`}
			>
				{title}
			</div>
			<div
				className={`flex flex-col gap-3 border-t px-4 py-3 ${
					tone === "danger" ? "border-red-200" : "border-slate-100"
				}`}
			>
				{children}
			</div>
		</section>
	);
}

function SettingsReadOnlyField({
	label,
	value,
	action,
}: {
	label: string;
	value: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<span className="text-xs text-slate-500">{label}</span>
			<div className="flex min-w-0 items-stretch">
				<div
					className={`flex min-w-0 flex-1 items-center border border-slate-200 bg-slate-50 px-2 py-2 font-mono text-sm text-slate-800 ${
						action ? "border-r-0" : ""
					}`}
					title={value}
				>
					<span className="min-w-0 flex-1 truncate">{value}</span>
				</div>
				{action}
			</div>
		</div>
	);
}

function SystemSettingsSubview({
	cssPath,
	projectScope,
	systemDisplayName,
	systemId,
	onDisconnect,
	disconnectDisabled,
	isDisconnecting,
	onSettingsPendingChange,
}: {
	cssPath: string;
	projectScope?: ProjectQueryScope;
	systemDisplayName: string;
	systemId: string;
	onDisconnect: () => void;
	disconnectDisabled: boolean;
	isDisconnecting: boolean;
	onSettingsPendingChange: (isPending: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const syncController = useTailwindSyncController();
	const desktopApi = getTrickroomDesktopApi();
	const sessionQuery = useQuery(sessionQueryOptions());
	const [draftName, setDraftName] = useState(systemDisplayName);
	const [draftCssPath, setDraftCssPath] = useState(cssPath);
	const [draftIconFolderPath, setDraftIconFolderPath] = useState("");
	const [settingsActionError, setSettingsActionError] = useState<string | null>(
		null,
	);
	const [isPickingCssPath, setIsPickingCssPath] = useState(false);
	const [isPickingIconFolder, setIsPickingIconFolder] = useState(false);
	const [copiedSystemId, setCopiedSystemId] = useState(false);
	const systemIdCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const iconsQuery = useQuery(systemIconsQueryOptions(systemId, projectScope));
	const folders = iconsQuery.data?.iconFolderPaths ?? [];
	const iconCount = iconsQuery.data?.icons.length ?? 0;
	const diagnosticCount = iconsQuery.data?.diagnostics.length ?? 0;
	const projectRoot = sessionQuery.data?.activeProject?.projectRoot ?? "";
	const canPickCssPath = Boolean(desktopApi) && Boolean(projectRoot);
	const canPickIconFolder = Boolean(desktopApi) && Boolean(projectRoot);
	const storageRoot = `.trickroom/systems/${systemId}`;
	const tokenStoragePath = `${storageRoot}/tokens.json`;
	const iconManifestPath = `${storageRoot}/icons.json`;
	const assetManifestPath = `${storageRoot}/assets.json`;
	const iconsQueryKey = systemIconsQueryKey(systemId, projectScope);
	const storedTokensQueryKey = storedTailwindTokensQueryKey(
		systemId,
		projectScope,
	);
	const iconSvgQueriesKey = systemIconSvgQueriesQueryKey(systemId);
	const invalidateSystemSettings = useCallback(async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: systemsQueryKey }),
			queryClient.invalidateQueries({ queryKey: configFileQueryKey }),
			queryClient.invalidateQueries({ queryKey: iconsQueryKey }),
		]);
	}, [iconsQueryKey, queryClient]);
	const invalidateSystemIconSvgs = useCallback(async () => {
		queryClient.removeQueries({
			queryKey: iconSvgQueriesKey,
			type: "inactive",
		});
		await queryClient.invalidateQueries({ queryKey: iconSvgQueriesKey });
	}, [iconSvgQueriesKey, queryClient]);
	const clearSettingsActionError = () => setSettingsActionError(null);
	const captureSettingsActionError = (error: unknown) => {
		setSettingsActionError(
			error instanceof Error ? error.message : "Settings action failed",
		);
	};

	const updateSystemMutation = useMutation({
		mutationFn: (updates: { nextSystemName?: string; cssPath?: string }) =>
			updateSystem({ systemId, ...updates }),
		onMutate: clearSettingsActionError,
		onError: captureSettingsActionError,
		onSuccess: async (response, updates) => {
			clearSettingsActionError();
			queryClient.setQueryData(
				configFileProjectQueryKey(projectScope),
				response.config,
			);
			await invalidateSystemSettings();
			await syncController.syncSystem(response.systemId);
			if (updates.cssPath !== undefined) {
				queryClient.removeQueries({
					queryKey: storedTokensQueryKey,
					type: "inactive",
				});
				await queryClient.invalidateQueries({ queryKey: storedTokensQueryKey });
			}
		},
	});
	const addIconFolderMutation = useMutation({
		mutationFn: (folderPath: string) =>
			addSystemIconFolder({ systemId, folderPath }),
		onMutate: clearSettingsActionError,
		onError: captureSettingsActionError,
		onSuccess: async (response) => {
			clearSettingsActionError();
			queryClient.setQueryData(iconsQueryKey, response);
			setDraftIconFolderPath("");
			await invalidateSystemIconSvgs();
			await invalidateSystemSettings();
		},
	});
	const removeIconFolderMutation = useMutation({
		mutationFn: (folderPath: string) =>
			removeSystemIconFolder({ systemId, folderPath }),
		onMutate: clearSettingsActionError,
		onError: captureSettingsActionError,
		onSuccess: async (response) => {
			clearSettingsActionError();
			queryClient.setQueryData(iconsQueryKey, response);
			await invalidateSystemIconSvgs();
			await invalidateSystemSettings();
		},
	});
	const reindexIconsMutation = useMutation({
		mutationFn: () => syncSystemIconsMutation(systemId),
		onMutate: clearSettingsActionError,
		onError: captureSettingsActionError,
		onSuccess: async (response) => {
			clearSettingsActionError();
			queryClient.setQueryData(iconsQueryKey, response);
			await invalidateSystemIconSvgs();
			await queryClient.invalidateQueries({ queryKey: iconsQueryKey });
		},
	});
	const settingsError =
		settingsActionError ??
		(iconsQuery.error instanceof Error ? iconsQuery.error.message : null);
	const isMutatingSettings =
		updateSystemMutation.isPending ||
		addIconFolderMutation.isPending ||
		removeIconFolderMutation.isPending ||
		reindexIconsMutation.isPending;
	const settingsActionsDisabled = isMutatingSettings || disconnectDisabled;
	const saveNameDisabled =
		settingsActionsDisabled ||
		draftName.trim().length === 0 ||
		draftName.trim() === systemDisplayName;
	const saveCssPathDisabled =
		settingsActionsDisabled ||
		draftCssPath.trim().length === 0 ||
		draftCssPath.trim() === cssPath;
	const addIconFolderDisabled =
		settingsActionsDisabled || draftIconFolderPath.trim().length === 0;
	const pickerActionsDisabled =
		settingsActionsDisabled || isPickingCssPath || isPickingIconFolder;

	useEffect(() => {
		setDraftName(systemDisplayName);
	}, [systemDisplayName]);

	useEffect(() => {
		setDraftCssPath(cssPath);
	}, [cssPath]);

	useEffect(() => {
		onSettingsPendingChange(isMutatingSettings);
	}, [isMutatingSettings, onSettingsPendingChange]);

	useEffect(() => {
		return () => onSettingsPendingChange(false);
	}, [onSettingsPendingChange]);

	const saveName = () => {
		if (saveNameDisabled) return;
		updateSystemMutation.mutate({ nextSystemName: draftName.trim() });
	};

	const saveCssPath = () => {
		if (saveCssPathDisabled) return;
		updateSystemMutation.mutate({ cssPath: draftCssPath.trim() });
	};

	const pickCssPath = async () => {
		if (!desktopApi || !projectRoot || pickerActionsDisabled) {
			return;
		}

		clearSettingsActionError();
		setIsPickingCssPath(true);
		try {
			const result = await desktopApi.pickCssFile(projectRoot);
			if (!result.canceled) {
				setDraftCssPath(result.relativePath);
			}
		} catch (error) {
			captureSettingsActionError(
				error instanceof Error
					? error
					: new Error("Failed to choose CSS file."),
			);
		} finally {
			setIsPickingCssPath(false);
		}
	};

	const addIconFolder = () => {
		if (addIconFolderDisabled) return;
		addIconFolderMutation.mutate(draftIconFolderPath.trim());
	};

	const pickIconFolder = async () => {
		if (!desktopApi || !projectRoot || pickerActionsDisabled) {
			return;
		}

		clearSettingsActionError();
		setIsPickingIconFolder(true);
		try {
			const result = await desktopApi.pickProjectFolder();
			if (!result.canceled) {
				const relativePath = toProjectRelativePath(result.path, projectRoot);
				if (!relativePath) {
					setSettingsActionError("Choose an icon folder inside this project.");
					return;
				}
				setDraftIconFolderPath(relativePath);
			}
		} catch (error) {
			captureSettingsActionError(
				error instanceof Error
					? error
					: new Error("Failed to choose icon folder."),
			);
		} finally {
			setIsPickingIconFolder(false);
		}
	};

	const reindexIcons = () => {
		if (settingsActionsDisabled) return;
		reindexIconsMutation.mutate();
	};

	const copySystemId = () => {
		const copyText = async () => {
			const desktopApi = getTrickroomDesktopApi();
			if (desktopApi?.clipboard) {
				await desktopApi.clipboard.writeText(systemId);
			} else {
				await navigator.clipboard.writeText(systemId);
			}
		};

		void copyText()
			.then(() => {
				setCopiedSystemId(true);
				if (systemIdCopyTimeoutRef.current) {
					clearTimeout(systemIdCopyTimeoutRef.current);
				}
				systemIdCopyTimeoutRef.current = setTimeout(() => {
					setCopiedSystemId(false);
				}, 1500);
			})
			.catch(() => {
				setCopiedSystemId(false);
			});
	};

	useEffect(() => {
		return () => {
			if (systemIdCopyTimeoutRef.current) {
				clearTimeout(systemIdCopyTimeoutRef.current);
			}
		};
	}, []);

	return (
		<div className="flex flex-col gap-4">
			{settingsError ? (
				<div className="bg-red-500 px-3 py-2 text-xs text-white" role="alert">
					{settingsError}
				</div>
			) : null}

			<SettingsSection title="Identity">
				<div className="flex min-w-0 flex-col gap-1.5">
					<label
						htmlFor="system-settings-name"
						className="text-xs text-slate-500"
					>
						System name
					</label>
					<div className="flex min-w-0 items-center gap-2">
						<Input
							id="system-settings-name"
							variant="form"
							className="min-w-0 flex-1"
							value={draftName}
							onChange={(event) => setDraftName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") saveName();
							}}
							disabled={settingsActionsDisabled}
						/>
						<Button
							variant="outlined"
							className="flex items-center gap-1.5 px-3 py-2"
							onClick={saveName}
							disabled={saveNameDisabled}
						>
							<Save className="size-3.5" aria-hidden="true" />
							{updateSystemMutation.isPending ? "Saving..." : "Save"}
						</Button>
					</div>
					<p className="font-mono text-[10px] text-slate-500">
						Shown in the sidebar and design header.
					</p>
				</div>
				<SettingsReadOnlyField
					label="System ID"
					value={systemId}
					action={
						<Button
							variant="outlined"
							className="shrink-0 bg-slate-50 px-3 py-2"
							aria-label={
								copiedSystemId ? "Copied system ID" : "Copy system ID"
							}
							onClick={copySystemId}
						>
							<Copy
								className={`size-3.5 ${copiedSystemId ? "text-cyan-600" : ""}`}
								aria-hidden="true"
							/>
						</Button>
					}
				/>
			</SettingsSection>

			<SettingsSection title="Token Source">
				<div className="flex min-w-0 flex-col gap-1.5">
					<label
						htmlFor="system-settings-css-path"
						className="text-xs text-slate-500"
					>
						CSS source path
					</label>
					<div className="flex min-w-0 items-stretch gap-2">
						<div className="group flex min-w-0 flex-1 items-stretch inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-within:inset-shadow-cyan-500">
							<Input
								id="system-settings-css-path"
								variant="formEmbedded"
								className="min-w-0 flex-1 font-mono"
								value={draftCssPath}
								onChange={(event) => setDraftCssPath(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") saveCssPath();
								}}
								disabled={settingsActionsDisabled}
							/>
							{desktopApi ? (
								<Button
									type="button"
									variant="block"
									className="shrink-0 inset-shadow-[1px_0_0_0] inset-shadow-slate-200 group-focus-within:inset-shadow-cyan-500 not-disabled:hover:inset-shadow-[0_0_0_1px] not-disabled:active:inset-shadow-[0_0_0_1px] not-disabled:active:inset-shadow-cyan-500"
									disabled={pickerActionsDisabled || !canPickCssPath}
									onClick={pickCssPath}
									title={
										!canPickCssPath ? "Project path unavailable." : undefined
									}
								>
									{isPickingCssPath ? "Browsing" : "Browse"}
								</Button>
							) : null}
						</div>
						<Button
							variant="outlined"
							className="flex items-center gap-1.5 px-3 py-2"
							onClick={saveCssPath}
							disabled={saveCssPathDisabled}
						>
							<Save className="size-3.5" aria-hidden="true" />
							{updateSystemMutation.isPending ? "Saving..." : "Save"}
						</Button>
					</div>
					<p className="font-mono text-[10px] text-slate-500">
						Path watched for @theme blocks and stored overrides.
					</p>
				</div>
			</SettingsSection>

			<SettingsSection title="Icon Folders">
				<div className="flex items-baseline justify-between gap-3">
					<span className="text-sm text-slate-600">
						{iconsQuery.isPending
							? "Loading icon index..."
							: iconsQuery.isError
								? "Icon index unavailable"
								: `${iconCount.toLocaleString()} icons indexed`}
					</span>
					<span className="font-mono text-xs text-slate-500">
						{diagnosticCount} diagnostic{diagnosticCount === 1 ? "" : "s"}
					</span>
				</div>
				<div className="flex items-center justify-between gap-3">
					<p className="font-mono text-[10px] text-slate-500">
						Re-index scans every configured icon folder for this system.
					</p>
					<Button
						variant="outlined"
						className="flex shrink-0 items-center gap-1.5 px-2.5 py-1"
						onClick={reindexIcons}
						disabled={settingsActionsDisabled}
					>
						<RefreshCw className="size-3.5" aria-hidden="true" />
						{reindexIconsMutation.isPending ? "Indexing..." : "Re-index all"}
					</Button>
				</div>
				<div className="flex flex-col">
					{folders.length === 0 ? (
						<p className="px-3 py-3 text-sm text-slate-500">
							No icon folders configured.
						</p>
					) : (
						folders.map((folder) => (
							<div
								key={folder}
								className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-t border-slate-100 px-0 py-2 first:border-t-0"
							>
								<Folder className="size-4 text-slate-500" aria-hidden="true" />
								<span
									className="min-w-0 truncate font-mono text-xs text-slate-800"
									title={folder}
								>
									{folder}
								</span>
								<Button
									variant="outlined"
									className="flex items-center gap-1.5 px-2.5 py-1 text-red-700"
									onClick={() => removeIconFolderMutation.mutate(folder)}
									disabled={settingsActionsDisabled}
								>
									<Trash2 className="size-3.5" aria-hidden="true" />
									Remove
								</Button>
							</div>
						))
					)}
					<div className="flex min-w-0 flex-col gap-1.5 border-t border-dashed border-slate-200 px-0 py-3">
						<label
							htmlFor="system-settings-icon-folder-path"
							className="text-xs text-slate-500"
						>
							Icon folder path
						</label>
						<div className="flex min-w-0 items-stretch gap-2">
							<div className="group flex min-w-0 flex-1 items-stretch inset-shadow-[0_0_0_1px] inset-shadow-slate-200 focus-within:inset-shadow-cyan-500">
								<Input
									id="system-settings-icon-folder-path"
									variant="formEmbedded"
									className="min-w-0 flex-1 font-mono"
									placeholder="src/icons"
									value={draftIconFolderPath}
									onChange={(event) =>
										setDraftIconFolderPath(event.target.value)
									}
									onKeyDown={(event) => {
										if (event.key === "Enter") addIconFolder();
									}}
									disabled={settingsActionsDisabled}
								/>
								{desktopApi ? (
									<Button
										type="button"
										variant="block"
										className="shrink-0 inset-shadow-[1px_0_0_0] inset-shadow-slate-200 group-focus-within:inset-shadow-cyan-500 not-disabled:hover:inset-shadow-[0_0_0_1px] not-disabled:active:inset-shadow-[0_0_0_1px] not-disabled:active:inset-shadow-cyan-500"
										disabled={pickerActionsDisabled || !canPickIconFolder}
										onClick={pickIconFolder}
										title={
											!canPickIconFolder
												? "Project path unavailable."
												: undefined
										}
									>
										{isPickingIconFolder ? "Browsing" : "Browse"}
									</Button>
								) : null}
							</div>
							<Button
								variant="outlined"
								className="px-3 py-2"
								onClick={addIconFolder}
								disabled={addIconFolderDisabled}
							>
								Add
							</Button>
						</div>
					</div>
				</div>
			</SettingsSection>

			<SettingsSection title="Storage & Debug Paths">
				<SettingsReadOnlyField label="System storage" value={storageRoot} />
				<SettingsReadOnlyField
					label="Token snapshot"
					value={tokenStoragePath}
				/>
				<SettingsReadOnlyField label="Icon manifest" value={iconManifestPath} />
				<SettingsReadOnlyField
					label="Asset manifest"
					value={assetManifestPath}
				/>
			</SettingsSection>

			<SettingsSection title="Danger Zone" tone="danger">
				<div className="flex items-center justify-between gap-4">
					<div className="flex min-w-0 flex-col gap-1">
						<span className="text-sm font-medium text-slate-800">
							Disconnect system
						</span>
						<p className="text-xs text-slate-600">
							Removes this system from project config and deletes Trickroom
							system storage for tokens, manifests, assets, and icon indexes.
						</p>
					</div>
					<Button
						variant="outlined"
						flavor="warning"
						className="flex shrink-0 items-center gap-1.5 px-3 py-1.5"
						onClick={onDisconnect}
						disabled={settingsActionsDisabled}
					>
						<Trash2 className="size-3.5" aria-hidden="true" />
						{isDisconnecting ? "Disconnecting..." : "Disconnect..."}
					</Button>
				</div>
			</SettingsSection>
		</div>
	);
}

export function SystemDetailPane({
	systemId,
	result,
	onSelectSystem,
}: {
	systemId: string;
	result: TailwindSyncResult;
	onSelectSystem: (systemId: string | null) => void;
}) {
	const queryClient = useQueryClient();
	const projectScope = useProjectScope();
	const syncController = useTailwindSyncController();
	const systemTarget = syncController.targetsById[systemId];
	const data = result.data;
	const storedTokensQuery = useQuery({
		...storedTailwindTokensQueryOptions(systemId, projectScope),
		enabled: systemId.length > 0,
	});
	const storedDomains = storedTokensQuery.data?.domains;
	const storedOverridesByDomain = useMemo(
		() => getStoredTokenOverridesByDomain(storedDomains),
		[storedDomains],
	);
	const storedOverrides = useMemo(
		() => flattenTokenOverridesByDomain(storedOverridesByDomain),
		[storedOverridesByDomain],
	);
	const reviewRequired = Boolean(
		data?.reviewRequired || storedTokensQuery.data?.reviewRequired,
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
	const unchangedTokens = useMemo(
		() => collectSyncUnchangedTokens(data?.baselineDiffs),
		[data?.baselineDiffs],
	);
	const shouldHaveOverrides = removedTokens.length > 0;
	const suggestedOverridesByDomain = useMemo(
		() => computeSuggestedTokenOverridesByDomain(removedTokens),
		[removedTokens],
	);
	const suggestedOverrides = useMemo(
		() => flattenTokenOverridesByDomain(suggestedOverridesByDomain),
		[suggestedOverridesByDomain],
	);
	const addedTokenSections = useMemo(
		() =>
			groupTokenRowsByDomain(
				addedTokens,
				(token) => ({
					name: token.name,
					value: token.value,
				}),
				{
					getDomainLabel: (domain) => domain,
				},
			),
		[addedTokens],
	);
	const overriddenTokenSections = useMemo(
		() =>
			groupTokenRowsByDomain(
				overriddenTokens,
				(token) => ({
					name: token.name,
					value: token.value,
					valueLabel: (
						<span className="inline-flex min-w-0 items-center gap-1.5">
							<span className="truncate rounded-sm bg-red-50 px-1 text-red-700">
								{token.defaultValue}
							</span>
							<span className="shrink-0 text-slate-400">→</span>
							<span className="truncate rounded-sm bg-green-50 px-1 text-green-700">
								{token.value}
							</span>
						</span>
					),
				}),
				{
					getDomainLabel: (domain) => domain,
				},
			),
		[overriddenTokens],
	);
	const removedTokenSections = useMemo(
		() =>
			groupTokenRowsByDomain(
				removedTokens,
				(token) => ({
					name: token.name,
					value: token.defaultValue,
				}),
				{
					getDomainLabel: (domain) => domain,
				},
			),
		[removedTokens],
	);
	const unchangedTokenSections = useMemo(
		() =>
			groupTokenRowsByDomain(
				unchangedTokens,
				(token) => ({
					name: token.name,
					value: token.value,
				}),
				{
					getDomainLabel: (domain) => domain,
				},
			),
		[unchangedTokens],
	);
	const tokenDiffSections = useMemo<
		Record<TokenDiffSectionTone, TokenDiffSection>
	>(
		() => ({
			added: {
				key: "added",
				label: "Added",
				count: addedTokens.length,
				sections: addedTokenSections,
				emptyMessage: "No added tokens in the latest sync.",
				domainEmptyMessage: "No added tokens in this domain.",
				tone: "added",
			},
			overridden: {
				key: "overridden",
				label: "Overridden",
				count: overriddenTokens.length,
				sections: overriddenTokenSections,
				emptyMessage: "No overridden tokens in the latest sync.",
				domainEmptyMessage: "No overridden tokens in this domain.",
				tone: "overridden",
			},
			removed: {
				key: "removed",
				label: "Removed",
				count: removedTokens.length,
				sections: removedTokenSections,
				emptyMessage: "No removed tokens in the latest sync.",
				domainEmptyMessage: "No removed tokens in this domain.",
				tone: "removed",
			},
			unchanged: {
				key: "unchanged",
				label: "Unchanged",
				count: unchangedTokens.length,
				sections: unchangedTokenSections,
				emptyMessage: "No unchanged tokens in the latest sync.",
				domainEmptyMessage: "No unchanged tokens in this domain.",
				tone: "unchanged",
			},
		}),
		[
			addedTokens.length,
			addedTokenSections,
			overriddenTokens.length,
			overriddenTokenSections,
			removedTokens.length,
			removedTokenSections,
			unchangedTokens.length,
			unchangedTokenSections,
		],
	);
	const reviewTokenDiffSections = useMemo(
		() => [
			tokenDiffSections.added,
			tokenDiffSections.overridden,
			tokenDiffSections.removed,
		],
		[tokenDiffSections],
	);
	const [activeTab, setActiveTab] = useState<SystemTab>("overview");
	const [tokenFilter, setTokenFilter] = useState("");
	const [activeTokenDomains, setActiveTokenDomains] = useState<string[]>([]);
	const [collapsedTokenDomains, setCollapsedTokenDomains] = useState<
		readonly string[]
	>([]);
	const [isSyncedRemovedCollapsed, setIsSyncedRemovedCollapsed] =
		useState(true);
	const [isReviewRemovedCollapsed, setIsReviewRemovedCollapsed] =
		useState(true);
	const [isRenaming, setIsRenaming] = useState(false);
	const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
	const [isSettingsMutationPending, setIsSettingsMutationPending] =
		useState(false);
	const detailViewportRef = useRef<HTMLDivElement>(null);
	const [draftName, setDraftName] = useState(
		systemTarget?.systemName ?? result.data?.systemName ?? systemId,
	);
	const inputRef = useRef<HTMLInputElement>(null);
	const cancelledRef = useRef(false);
	const selectedSystemIdRef = useRef(systemId);
	const syncedTokens = useMemo(() => {
		const storedTokenEntries = storedDomains
			? Object.entries(storedDomains).flatMap(([domain, storage]) =>
					Object.entries(storage.tokens).map(([name, value]) => ({
						name,
						value,
						domain,
					})),
				)
			: undefined;

		return storedTokenEntries ?? data?.tokens;
	}, [data?.tokens, storedDomains]);
	const allSyncedTokenSections = useMemo(
		() =>
			filterAndGroupTokenRowsByDomain(
				syncedTokens,
				(token) => ({
					name: token.name,
					value: token.value,
				}),
				{
					domainOrder: ["color"],
					getDomainLabel: (domain) => domain,
				},
			),
		[syncedTokens],
	);
	const syncedTokenSections = useMemo(
		() =>
			filterAndGroupTokenRowsByDomain(
				syncedTokens,
				(token) => ({
					name: token.name,
					value: token.value,
				}),
				{
					filter: tokenFilter,
					domainFilter: activeTokenDomains,
					domainOrder: ["color"],
					getDomainLabel: (domain) => domain,
				},
			),
		[syncedTokens, tokenFilter, activeTokenDomains],
	);
	const tokenDomainPills = useMemo(
		() =>
			deriveTokenDomainPills({
				sections: allSyncedTokenSections,
				activeDomains: activeTokenDomains,
			}),
		[allSyncedTokenSections, activeTokenDomains],
	);
	const syncedAddedTokenSection = useMemo<TokenDiffSection>(
		() => ({
			key: "added",
			label: "Added",
			count: syncedTokenSections.reduce(
				(count, section) => count + section.rows.length,
				0,
			),
			sections: syncedTokenSections,
			emptyMessage: "No tokens match the current filters.",
			domainEmptyMessage: "No tokens in this domain.",
			tone: "added",
		}),
		[syncedTokenSections],
	);

	const renameMutation = useMutation({
		mutationFn: (nextSystemName: string) =>
			updateSystem({ systemId, nextSystemName }),
		onSuccess: async (response) => {
			queryClient.setQueryData(
				configFileProjectQueryKey(projectScope),
				response.config,
			);
			await queryClient.invalidateQueries({ queryKey: configFileQueryKey });
			await queryClient.invalidateQueries({ queryKey: systemsQueryKey });
			onSelectSystem(response.systemId);
			await syncController.syncSystem(response.systemId);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: () => deleteSystem(systemId),
		onSuccess: async (response) => {
			queryClient.setQueryData(
				configFileProjectQueryKey(projectScope),
				response.config,
			);
			await queryClient.invalidateQueries({ queryKey: configFileQueryKey });
			await queryClient.invalidateQueries({ queryKey: systemsQueryKey });
			setDisconnectDialogOpen(false);
			onSelectSystem(null);
		},
	});

	const saveMutation = useMutation({
		mutationFn: (overridesByDomain: TokenOverridesByDomain) =>
			saveAndConfirmTailwindTokens({
				systemId,
				domains: toTokenSaveDomains(overridesByDomain),
			}),
		onSuccess: async (response) => {
			queryClient.setQueryData(
				storedTailwindTokensQueryKey(systemId, projectScope),
				response,
			);
			await queryClient.invalidateQueries({
				queryKey: storedTailwindTokensQueryKey(systemId, projectScope),
			});
			await syncController.syncSystem(systemId);
		},
	});

	const nextOverridesByDomain = useMemo(
		() =>
			getNextTokenOverridesByDomain({
				reviewRequired,
				suggestedOverrides: suggestedOverridesByDomain,
				storedOverrides: storedOverridesByDomain,
			}),
		[reviewRequired, suggestedOverridesByDomain, storedOverridesByDomain],
	);
	const overridesChanged = tokenOverridesByDomainChanged(
		nextOverridesByDomain,
		storedOverridesByDomain,
	);
	const saveDisabled =
		!data ||
		saveMutation.isPending ||
		storedTokensQuery.isPending ||
		(!overridesChanged && !reviewRequired);

	const handleSave = useCallback(() => {
		if (!data || saveDisabled) {
			return;
		}
		saveMutation.mutate(nextOverridesByDomain);
	}, [data, saveDisabled, saveMutation, nextOverridesByDomain]);

	useHotkey("Mod+S", handleSave, {
		enabled: !saveDisabled,
		preventDefault: true,
	});

	const saveError =
		saveMutation.error instanceof Error ? saveMutation.error.message : null;
	const storedTokensError =
		storedTokensQuery.error instanceof Error
			? storedTokensQuery.error.message
			: null;
	const renameError =
		renameMutation.error instanceof Error ? renameMutation.error.message : null;
	const deleteError =
		deleteMutation.error instanceof Error ? deleteMutation.error.message : null;
	const systemDisplayName =
		data?.systemName ??
		storedTokensQuery.data?.systemName ??
		systemTarget?.systemName ??
		systemId;
	const cssPath =
		data?.cssPath ??
		storedTokensQuery.data?.cssPath ??
		systemTarget?.cssPath ??
		"./src/index.css";
	const cssBasename = getCssBasename(cssPath);
	const syncedAt = data?.syncedAt ?? storedTokensQuery.data?.syncedAt;
	const editedTime = syncedAt ? formatRelativeTime(syncedAt) : "never";
	const syncState = getSyncState(result, reviewRequired);
	const headerSub = [cssBasename, `synced ${editedTime}`].join(" · ");
	const actionDisabled =
		renameMutation.isPending ||
		deleteMutation.isPending ||
		isSettingsMutationPending;
	const tokenCount =
		data?.tokens.length ??
		(storedTokensQuery.data
			? Object.values(storedTokensQuery.data.domains).reduce(
					(total, domain) => total + Object.keys(domain.tokens).length,
					0,
				)
			: null);

	const startRenaming = () => {
		if (actionDisabled) {
			return;
		}

		cancelledRef.current = false;
		setDraftName(systemDisplayName);
		setIsRenaming(true);
	};

	const confirmRename = () => {
		const nextSystemName = draftName.trim();
		setIsRenaming(false);
		if (
			actionDisabled ||
			nextSystemName.length === 0 ||
			nextSystemName === systemDisplayName
		) {
			return;
		}
		renameMutation.mutate(nextSystemName);
	};

	const cancelRename = () => {
		cancelledRef.current = true;
		setIsRenaming(false);
	};

	const handleDelete = () => {
		if (actionDisabled) {
			return;
		}
		deleteMutation.mutate();
	};

	const handleSync = () => {
		void syncController.syncSystem(systemId);
	};
	const handleTokenDomainToggle = useCallback((domain: string) => {
		setActiveTokenDomains((domains) => {
			if (domains.length === 0) {
				return [domain];
			}

			if (domains.includes(domain)) {
				const nextDomains = domains.filter((activeDomain) => {
					return activeDomain !== domain;
				});
				return nextDomains.length === 0 ? [] : nextDomains;
			}

			return [...domains, domain];
		});
	}, []);
	const handleTokenSectionToggle = useCallback((domain: string) => {
		setCollapsedTokenDomains((domains) => {
			if (domains.includes(domain)) {
				return domains.filter((collapsedDomain) => collapsedDomain !== domain);
			}

			return [...domains, domain];
		});
	}, []);

	useHotkey("Enter", confirmRename, {
		enabled: isRenaming,
		ignoreInputs: false,
	});
	useHotkey("Escape", cancelRename, { enabled: isRenaming });
	useEffect(() => {
		if (!isRenaming) {
			return;
		}

		inputRef.current?.focus();
		inputRef.current?.select();
	}, [isRenaming]);
	useEffect(() => {
		if (selectedSystemIdRef.current === systemId) {
			return;
		}

		selectedSystemIdRef.current = systemId;
		setActiveTab("overview");
		setTokenFilter("");
		setActiveTokenDomains([]);
		setCollapsedTokenDomains([]);
		setIsSyncedRemovedCollapsed(true);
		setIsReviewRemovedCollapsed(true);
	}, [systemId]);
	const actionError = renameError ?? deleteError;
	const isSyncing = result.status === "pending";
	const rawTokenDiff: TokenDiff = {
		added: addedTokens.length,
		overridden: overriddenTokens.length,
		removed: removedTokens.length,
	};
	const tokenDiff: TokenDiff = reviewRequired
		? rawTokenDiff
		: { added: 0, overridden: 0, removed: 0 };
	const showSyncedTokenBrowser = syncState === "synced";
	const syncErrorMessage =
		result.error?.message ??
		(storedTokensError
			? `Failed to load token snapshot: ${storedTokensError}`
			: null);
	const syncedTokenCount = allSyncedTokenSections.reduce(
		(count, section) => count + section.rows.length,
		0,
	);
	const filteredSyncedTokenCount = syncedTokenSections.reduce(
		(count, section) => count + section.rows.length,
		0,
	);
	const primaryAction =
		syncState === "review" ? (
			<Button
				variant="blockDark"
				className="flex items-center gap-1.5 bg-slate-950"
				onClick={handleSave}
				disabled={saveDisabled || actionDisabled}
			>
				<Check className="size-4" aria-hidden="true" />
				{saveMutation.isPending ? "Confirming..." : "Confirm review"}
			</Button>
		) : (
			<Button
				variant="blockDark"
				className="flex items-center gap-1.5 bg-slate-950"
				onClick={handleSync}
				disabled={isSyncing || actionDisabled}
			>
				<RefreshCw
					className={`size-4 ${isSyncing ? "text-cyan-300 animate-spin" : ""}`}
					aria-hidden="true"
				/>
				{isSyncing
					? "Syncing..."
					: syncState === "error"
						? "Retry"
						: syncState === "synced"
							? "Re-sync"
							: "Sync"}
			</Button>
		);

	return (
		<Tabs
			value={activeTab}
			onValueChange={(value) => setActiveTab(value as SystemTab)}
			className="flex h-full flex-col gap-0 overflow-hidden bg-slate-50 text-slate-950"
		>
			<SystemDetailHeader
				title={
					isRenaming ? (
						<input
							ref={inputRef}
							className="min-w-0 border-none bg-transparent p-0 text-xl font-medium text-slate-900 outline-none focus-visible:outline-none"
							value={draftName}
							onChange={(event) => setDraftName(event.target.value)}
							onBlur={() => {
								if (!cancelledRef.current) confirmRename();
							}}
							aria-label="System name"
						/>
					) : (
						<button
							type="button"
							className="min-w-0 truncate border-none bg-transparent p-0 text-left text-xl font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"
							onClick={startRenaming}
							disabled={actionDisabled}
						>
							{systemDisplayName}
						</button>
					)
				}
				status={syncState}
				subline={headerSub}
				diff={{
					added: tokenDiff.added,
					overridden: tokenDiff.overridden,
					removed: tokenDiff.removed,
				}}
				errors={
					<>
						{syncErrorMessage ? (
							<p className="text-xs text-red-600">{syncErrorMessage}</p>
						) : null}
						{actionError ? (
							<p className="text-xs text-red-600">{actionError}</p>
						) : null}
					</>
				}
				secondaryAction={
					<OpenSystemEditorAction
						systemId={systemId}
						disabled={actionDisabled}
					/>
				}
				primaryAction={primaryAction}
			/>

			<ScrollArea className="min-h-0 flex-1" viewportRef={detailViewportRef}>
				<div className="flex min-h-full flex-col gap-4 px-10 py-8">
					<SystemDetailTabBar />

					<TabsPanel value="overview">
						<SystemOverviewSubview
							cssPath={cssPath}
							syncedAtLabel={editedTime}
							tokenCount={tokenCount}
							tokenDiff={tokenDiff}
							projectScope={projectScope}
							systemId={systemId}
						/>
					</TabsPanel>
					<TabsPanel value="tokens" className="flex flex-col gap-4">
						{showSyncedTokenBrowser ? (
							<div className="flex flex-col gap-4">
								{removedTokens.length > 0 || storedOverrides.length > 0 ? (
									<TokenDiffSectionCard
										section={tokenDiffSections.removed}
										renderRows={false}
										isCollapsed={isSyncedRemovedCollapsed}
										onToggle={() =>
											setIsSyncedRemovedCollapsed((collapsed) => !collapsed)
										}
									>
										{storedOverrides.length > 0 ? (
											<ColorOverridesBlock
												overrides={storedOverrides}
												description="Confirmed reset declarations added to the synced theme."
											/>
										) : null}
										<CompactTokenSectionList
											sections={removedTokenSections}
											emptyMessage="No removed tokens in the latest sync."
										/>
									</TokenDiffSectionCard>
								) : null}
								{storedTokensQuery.isPending &&
								allSyncedTokenSections.length === 0 ? (
									<div className="border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
										Loading token snapshot...
									</div>
								) : storedTokensError ? (
									<div className="border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-600">
										Failed to load token snapshot: {storedTokensError}
									</div>
								) : allSyncedTokenSections.length > 0 ? (
									<TokenDiffSectionCard
										section={syncedAddedTokenSection}
										renderRows={false}
									>
										<div className="flex flex-col border-t border-slate-100">
											<div className="flex items-center gap-2 px-4 py-3">
												<div className="min-w-0 flex-1">
													<TokenFilterInput
														filter={tokenFilter}
														onFilterChange={setTokenFilter}
														onClear={() => setTokenFilter("")}
													/>
												</div>
												<TokenDomainPills
													pills={tokenDomainPills}
													onToggle={handleTokenDomainToggle}
													onClearAll={() => setActiveTokenDomains([])}
												/>
												{filteredSyncedTokenCount !== syncedTokenCount ? (
													<span className="shrink-0 font-mono text-[10px] text-slate-500">
														{filteredSyncedTokenCount.toLocaleString()} /{" "}
														{syncedTokenCount.toLocaleString()}
													</span>
												) : null}
											</div>
											{syncedTokenSections.length === 0 ? (
												<p className="px-4 py-6 text-sm text-slate-500">
													No tokens match the current filters.
												</p>
											) : (
												syncedTokenSections.map((section) => (
													<TokenDomainSectionList
														key={section.domain}
														section={section}
														emptyMessage="No tokens in this domain."
														isCollapsed={collapsedTokenDomains.includes(
															section.domain,
														)}
														onToggle={() =>
															handleTokenSectionToggle(section.domain)
														}
													/>
												))
											)}
										</div>
									</TokenDiffSectionCard>
								) : (
									<div className="border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
										No stored tokens in this system.
									</div>
								)}
							</div>
						) : isSyncing ? (
							<div className="flex flex-col border border-slate-200 bg-white">
								<div className="flex items-baseline justify-between px-4 py-3">
									<div className="flex items-baseline gap-2">
										<Text variant="subtitle" className="text-slate-900">
											Tokens
										</Text>
										<span className="font-mono text-xs text-slate-500">
											{syncedTokenCount.toLocaleString()}
										</span>
									</div>
									<span className="text-xs text-cyan-700">Syncing</span>
								</div>
								<div className="h-px overflow-hidden bg-cyan-100">
									<div className="h-full w-1/2 animate-pulse bg-cyan-500" />
								</div>
								<p className="px-4 py-6 text-sm text-slate-500">
									Syncing token snapshot...
								</p>
							</div>
						) : syncState === "error" ? (
							<TokenSyncErrorCard message={syncErrorMessage} />
						) : reviewRequired ? (
							<div className="flex flex-col gap-6">
								{reviewTokenDiffSections.map((section) => (
									<TokenDiffSectionCard
										key={section.key}
										section={section}
										isCollapsed={
											section.key === "removed" && isReviewRemovedCollapsed
										}
										onToggle={
											section.key === "removed"
												? () =>
														setIsReviewRemovedCollapsed(
															(collapsed) => !collapsed,
														)
												: undefined
										}
										renderRows={
											section.key !== "added" &&
											!(section.key === "removed" && shouldHaveOverrides)
										}
									>
										{section.key === "added" ? (
											<DenseTokenSectionList
												sections={addedTokenSections}
												emptyMessage="No added tokens in the latest sync."
											/>
										) : section.key === "removed" && shouldHaveOverrides ? (
											<>
												<ColorOverridesBlock
													overrides={suggestedOverrides}
													description="These reset declarations will be saved with the review so the synced theme reflects this system."
												/>
												<CompactTokenSectionList
													sections={removedTokenSections}
													emptyMessage="No removed tokens in the latest sync."
												/>
											</>
										) : null}
									</TokenDiffSectionCard>
								))}
								{saveError ? (
									<div className="bg-red-500 px-3 py-2 text-xs text-white">
										Failed to save overrides: {saveError}
									</div>
								) : null}
							</div>
						) : (
							<div className="border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
								No token snapshot is available yet.
							</div>
						)}
					</TabsPanel>
					<TabsPanel value="settings">
						<SystemSettingsSubview
							cssPath={cssPath}
							projectScope={projectScope}
							systemDisplayName={systemDisplayName}
							systemId={systemId}
							onDisconnect={() => {
								deleteMutation.reset();
								setDisconnectDialogOpen(true);
							}}
							disconnectDisabled={actionDisabled}
							isDisconnecting={deleteMutation.isPending}
							onSettingsPendingChange={setIsSettingsMutationPending}
						/>
					</TabsPanel>
				</div>
			</ScrollArea>
			<ConfirmationDialog
				open={disconnectDialogOpen}
				onOpenChange={(open) => {
					if (!open && !deleteMutation.isPending) {
						setDisconnectDialogOpen(false);
					}
				}}
				title="Disconnect system"
				description={
					<>
						Disconnect &quot;{systemDisplayName}&quot;? This removes the system
						from the project config and deletes its Trickroom system storage.
					</>
				}
				icon={<Trash2 className="size-4" aria-hidden="true" />}
				actionIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
				actionLabel={
					deleteMutation.isPending ? "Disconnecting..." : "Disconnect"
				}
				actionDisabled={deleteMutation.isPending}
				tone="destructive"
				onAction={handleDelete}
			/>
		</Tabs>
	);
}
