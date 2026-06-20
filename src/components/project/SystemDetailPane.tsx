import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowUpRight,
	Check,
	Copy,
	RefreshCw,
	Save,
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
import { systemAssetsQueryOptions } from "../../queries/system-assets";
import { systemIconsQueryOptions } from "../../queries/system-icons";
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
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Text } from "../ui/text";
import { formatRelativeTime } from "./project-view-utils";
import { SystemDiffChips } from "./SystemDiffChips";
import {
	SystemStatusBadge,
	type SystemStatusBadgeState,
} from "./SystemStatusBadge";

function getCssBasename(cssPath: string) {
	return cssPath.split(/[\\/]/).pop() || cssPath;
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

export const getSystemEditorPath = (
	systemId: string,
	options?: { tab?: string },
) => {
	const path = `/system/${encodeURIComponent(systemId)}`;
	return options?.tab ? `${path}?tab=${encodeURIComponent(options.tab)}` : path;
};

export function OpenSystemEditorAction({
	systemId,
	disabled,
	reviewRequired = false,
}: {
	systemId: string;
	disabled?: boolean;
	reviewRequired?: boolean;
}) {
	const navigate = useNavigate();

	return (
		<Button
			type="button"
			variant="blockDark"
			className="flex items-center gap-1.5 bg-slate-950"
			onClick={() =>
				navigate(
					getSystemEditorPath(
						systemId,
						reviewRequired ? { tab: "tokens" } : undefined,
					),
				)
			}
			disabled={disabled}
		>
			<ArrowUpRight className="size-4" aria-hidden="true" />
			Open system
		</Button>
	);
}

type TokenDiff = {
	added: number;
	overridden: number;
	removed: number;
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

function SystemDetailHeader({
	title,
	status,
	subline,
	diff,
	actions,
	errors,
}: {
	title: ReactNode;
	status: SystemStatusBadgeState;
	subline: string;
	diff: TokenDiff;
	actions?: ReactNode;
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
				{actions ? (
					<div className="flex shrink-0 items-center gap-2">{actions}</div>
				) : null}
			</div>
		</header>
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
	const [settingsActionError, setSettingsActionError] = useState<string | null>(
		null,
	);
	const [isPickingCssPath, setIsPickingCssPath] = useState(false);
	const [copiedSystemId, setCopiedSystemId] = useState(false);
	const systemIdCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const projectRoot = sessionQuery.data?.activeProject?.projectRoot ?? "";
	const canPickCssPath = Boolean(desktopApi) && Boolean(projectRoot);
	const storageRoot = `.trickroom/systems/${systemId}`;
	const tokenStoragePath = `${storageRoot}/tokens.json`;
	const iconManifestPath = `${storageRoot}/icons.json`;
	const assetManifestPath = `${storageRoot}/assets.json`;
	const storedTokensQueryKey = storedTailwindTokensQueryKey(
		systemId,
		projectScope,
	);
	const invalidateSystemSettings = useCallback(async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: systemsQueryKey }),
			queryClient.invalidateQueries({ queryKey: configFileQueryKey }),
		]);
	}, [queryClient]);
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
	const settingsError = settingsActionError;
	const isMutatingSettings = updateSystemMutation.isPending;
	const settingsActionsDisabled = isMutatingSettings || disconnectDisabled;
	const saveNameDisabled =
		settingsActionsDisabled ||
		draftName.trim().length === 0 ||
		draftName.trim() === systemDisplayName;
	const saveCssPathDisabled =
		settingsActionsDisabled ||
		draftCssPath.trim().length === 0 ||
		draftCssPath.trim() === cssPath;
	const pickerActionsDisabled = settingsActionsDisabled || isPickingCssPath;

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
	const suggestedOverridesByDomain = useMemo(
		() => computeSuggestedTokenOverridesByDomain(removedTokens),
		[removedTokens],
	);
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
	const syncErrorMessage =
		result.error?.message ??
		(storedTokensError
			? `Failed to load token snapshot: ${storedTokensError}`
			: null);
	const syncActionLabel = isSyncing
		? "Syncing system"
		: syncState === "error"
			? "Retry system sync"
			: syncState === "synced"
				? "Re-sync system"
				: "Sync system";
	const reviewAction =
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
		) : null;
	const headerActions = (
		<>
			{reviewAction}
			<div className="flex shrink-0 items-center">
				<OpenSystemEditorAction
					systemId={systemId}
					disabled={actionDisabled}
					reviewRequired={reviewRequired}
				/>
				<Button
					variant="block"
					className="p-2.5"
					onClick={handleSync}
					disabled={isSyncing || actionDisabled}
					aria-label={syncActionLabel}
					title={syncActionLabel}
				>
					<RefreshCw
						className={`size-4 ${isSyncing ? "text-cyan-500 animate-spin" : ""}`}
						aria-hidden="true"
					/>
				</Button>
			</div>
		</>
	);

	return (
		<div className="flex h-full flex-col gap-0 overflow-hidden bg-slate-50 text-slate-950">
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
						{saveError ? (
							<p className="text-xs text-red-600">
								Failed to save overrides: {saveError}
							</p>
						) : null}
					</>
				}
				actions={headerActions}
			/>

			<ScrollArea className="min-h-0 flex-1" viewportRef={detailViewportRef}>
				<div className="flex min-h-full flex-col gap-6 px-10 py-8">
					<SystemOverviewSubview
						cssPath={cssPath}
						syncedAtLabel={editedTime}
						tokenCount={tokenCount}
						tokenDiff={tokenDiff}
						projectScope={projectScope}
						systemId={systemId}
					/>
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
		</div>
	);
}
