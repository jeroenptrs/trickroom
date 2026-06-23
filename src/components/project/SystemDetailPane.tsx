import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, RefreshCw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { getTrickroomDesktopApi } from "../../desktop-api";
import type { TailwindSyncResult } from "../../hooks/useTailwindSyncController";
import {
	configFileProjectQueryKey,
	configFileQueryKey,
	configFileQueryOptions,
	updateProjectDefaultSystem,
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
import { Alert } from "../ui/alert";
import { ConfirmationDialog } from "../ui/alert-dialog";
import { Button } from "../ui/button";
import Checkbox from "../ui/checkbox";
import { CopyButton } from "../ui/copy-button";
import { DetailSection, DetailSectionRow } from "../ui/detail-section";
import { EditableTitle } from "../ui/editable-title";
import { Input } from "../ui/input";
import { InputGroup, InputGroupButton } from "../ui/input-group";
import { MetricCard } from "../ui/metric-card";
import { PaneHeader } from "../ui/pane-header";
import { ReadOnlyField } from "../ui/readonly-field";
import { ScrollArea } from "../ui/scroll-area";
import { Text } from "../ui/text";
import { MemoryNotesButton } from "./memory/MemoryNotesButton";
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
			variant="filled"
			className="flex items-center gap-1.5"
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
			textClassName: "font-medium text-emerald-700",
		},
		{
			key: "overridden",
			width: (diff.overridden / total) * 100,
			className: "bg-amber-500",
			label: `~${diff.overridden}`,
			textClassName: "font-medium text-amber-700",
		},
		{
			key: "removed",
			width: (diff.removed / total) * 100,
			className: "bg-rose-500",
			label: `-${diff.removed}`,
			textClassName: "font-medium text-rose-700",
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
			<div className="flex items-center gap-1.5">
				{segments.map((segment) => (
					<Text key={segment.key} className={segment.textClassName}>
						{segment.label}
					</Text>
				))}
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

	const tokenValue =
		tokenCount === null ? "Not synced" : tokenCount.toLocaleString();

	return (
		<div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
			<MetricCard
				label="Tokens"
				value={tokenValue}
				detail="Stored token records"
				footer={<TokenDiffMiniBar diff={tokenDiff} />}
			/>
			<MetricCard
				label="Assets"
				value={
					assetsQuery.isPending
						? "..."
						: assetsQuery.isError
							? "Error"
							: assets.length.toLocaleString()
				}
				detail={
					assetsQuery.isPending
						? "Loading assets"
						: assetsQuery.isError
							? "Failed to load assets"
							: "Indexed asset images"
				}
			/>
			<MetricCard label="Icons" value={iconLabel} detail={iconDetail} />
			<MetricCard label="Used By" value={usedByCount} detail={usedByDetail} />
			<MetricCard
				label="Last Sync"
				value={syncedAtLabel}
				detail={getCssBasename(cssPath)}
			/>
			<MetricCard
				label="System ID"
				value={systemId}
				detail="Project config key"
				mono
				action={
					<CopyButton value={systemId} subject="system ID" className="p-2" />
				}
			/>
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
	const configQuery = useQuery(configFileQueryOptions(projectScope));
	const isDefaultSystem = configQuery.data?.defaultSystemId === systemId;
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
	const updateDefaultSystemMutation = useMutation({
		mutationFn: (nextIsDefault: boolean) =>
			updateProjectDefaultSystem(nextIsDefault ? systemId : null),
		onMutate: clearSettingsActionError,
		onError: captureSettingsActionError,
		onSuccess: async (config) => {
			clearSettingsActionError();
			queryClient.setQueryData(configFileProjectQueryKey(projectScope), config);
			await queryClient.invalidateQueries({ queryKey: configFileQueryKey });
			await queryClient.invalidateQueries({ queryKey: systemsQueryKey });
		},
	});
	const settingsError =
		settingsActionError ??
		(updateDefaultSystemMutation.error instanceof Error
			? updateDefaultSystemMutation.error.message
			: null);
	const isMutatingSettings =
		updateSystemMutation.isPending || updateDefaultSystemMutation.isPending;
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

	return (
		<div className="flex flex-col gap-4">
			{settingsError ? (
				<Alert variant="panel" tone="danger">
					{settingsError}
				</Alert>
			) : null}

			<DetailSection title="Identity">
				<div className="flex min-w-0 flex-col gap-1.5">
					<label htmlFor="system-settings-name">
						<Text variant="label" tone="foreground">
							System name
						</Text>
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
							className="flex items-center gap-1.5"
							onClick={saveName}
							disabled={saveNameDisabled}
						>
							<Save className="size-3.5" aria-hidden="true" />
							{updateSystemMutation.isPending ? "Saving..." : "Save"}
						</Button>
					</div>
					<Text tone="muted" className="text-[11px]">
						Shown in the sidebar and design header.
					</Text>
				</div>
				<ReadOnlyField
					label="System ID"
					value={systemId}
					action={
						<CopyButton
							value={systemId}
							subject="system ID"
							className="px-3 py-2"
						/>
					}
				/>
			</DetailSection>

			<DetailSection title="Project Default">
				<label
					htmlFor="system-settings-default"
					className="flex items-start gap-3"
				>
					<Checkbox
						id="system-settings-default"
						checked={isDefaultSystem}
						onCheckedChange={(checked) => {
							if (checked === isDefaultSystem) {
								return;
							}
							updateDefaultSystemMutation.mutate(checked === true);
						}}
						disabled={settingsActionsDisabled}
					/>
					<span className="flex min-w-0 flex-col gap-0.5">
						<Text variant="label" tone="foreground">
							Default system for new designs
						</Text>
						<Text tone="muted" className="text-[11px]">
							New designs automatically link to this system. Only one system can
							be default per project.
						</Text>
					</span>
				</label>
			</DetailSection>

			<DetailSection title="Token Source">
				<div className="flex min-w-0 flex-col gap-1.5">
					<label htmlFor="system-settings-css-path">
						<Text variant="label" tone="foreground">
							CSS source path
						</Text>
					</label>
					<div className="flex min-w-0 items-stretch gap-2">
						<InputGroup className="min-w-0 flex-1">
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
								<InputGroupButton
									disabled={pickerActionsDisabled || !canPickCssPath}
									onClick={pickCssPath}
									title={
										!canPickCssPath ? "Project path unavailable." : undefined
									}
								>
									{isPickingCssPath ? "Browsing" : "Browse"}
								</InputGroupButton>
							) : null}
						</InputGroup>
						<Button
							variant="outlined"
							className="flex items-center gap-1.5"
							onClick={saveCssPath}
							disabled={saveCssPathDisabled}
						>
							<Save className="size-3.5" aria-hidden="true" />
							{updateSystemMutation.isPending ? "Saving..." : "Save"}
						</Button>
					</div>
					<Text tone="muted" className="text-[11px]">
						Path watched for @theme blocks and stored overrides.
					</Text>
				</div>
			</DetailSection>

			<DetailSection title="Storage & Debug Paths">
				<ReadOnlyField label="System storage" value={storageRoot} />
				<ReadOnlyField label="Token snapshot" value={tokenStoragePath} />
				<ReadOnlyField label="Icon manifest" value={iconManifestPath} />
				<ReadOnlyField label="Asset manifest" value={assetManifestPath} />
			</DetailSection>

			<DetailSection title="Danger Zone" tone="danger">
				<DetailSectionRow
					title="Disconnect system"
					description="Removes this system from project config and deletes Trickroom system storage for tokens, manifests, assets, and icon indexes."
					action={
						<Button
							variant="outlined"
							flavor="warning"
							className="flex shrink-0 items-center gap-1.5"
							onClick={onDisconnect}
							disabled={settingsActionsDisabled}
						>
							<Trash2 className="size-3.5" aria-hidden="true" />
							{isDisconnecting ? "Disconnecting..." : "Disconnect..."}
						</Button>
					}
				/>
			</DetailSection>
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
	const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
	const [isSettingsMutationPending, setIsSettingsMutationPending] =
		useState(false);
	const detailViewportRef = useRef<HTMLDivElement>(null);

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

	const renameSystem = (nextSystemName: string) => {
		if (actionDisabled) {
			return;
		}
		renameMutation.mutate(nextSystemName);
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
				variant="filled"
				className="flex items-center gap-1.5"
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
				<MemoryNotesButton
					scope={{ kind: "system", systemId }}
					projectScope={projectScope}
					title={systemDisplayName}
					subtitle={systemId}
					disabled={actionDisabled}
				/>
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
			<PaneHeader
				banner={
					isSyncing ? (
						<div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-cyan-100/70">
							<div className="h-full w-full animate-pulse bg-cyan-500" />
						</div>
					) : null
				}
				eyebrow={
					<Text variant="eyebrow" className="text-amber-700">
						System
					</Text>
				}
				title={
					<>
						<EditableTitle
							value={systemDisplayName}
							aria-label="System name"
							disabled={actionDisabled}
							onRename={renameSystem}
						/>
						<SystemStatusBadge state={syncState} />
					</>
				}
				meta={
					<>
						<Text
							tone="faint"
							className="min-w-0 truncate font-mono text-[11px]"
						>
							{headerSub}
						</Text>
						<SystemDiffChips
							added={tokenDiff.added}
							overridden={tokenDiff.overridden}
							removed={tokenDiff.removed}
						/>
					</>
				}
				errors={
					<>
						{syncErrorMessage ? (
							<Text tone="danger" className="text-xs">
								{syncErrorMessage}
							</Text>
						) : null}
						{actionError ? (
							<Text tone="danger" className="text-xs">
								{actionError}
							</Text>
						) : null}
						{saveError ? (
							<Text tone="danger" className="text-xs">
								Failed to save overrides: {saveError}
							</Text>
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
