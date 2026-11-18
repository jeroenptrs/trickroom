import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, RefreshCw, Save, Trash2 } from "lucide-react";
import {
	type ComponentProps,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router";
import type { TailwindSyncResult } from "../../hooks/useTailwindSyncController";
import {
	configFileProjectQueryKey,
	configFileQueryKey,
	configFileQueryOptions,
	updateProjectDefaultSystem,
} from "../../queries/config-file";
import type { ProjectQueryScope } from "../../queries/project-scope";
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
	type TailwindTokenDomain,
	type TailwindTokenDomainDiffs,
} from "../../utils/tailwind-token-domains";
import {
	getStoredBaselineDiffs,
	getTokenReviewCounts,
} from "../../utils/tailwind-token-review";
import { useProjectScope, useTailwindSyncController } from "../contexts";
import { Alert } from "../ui/alert";
import { ConfirmationDialog } from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import { DetailSection, DetailSectionRow } from "../ui/detail-section";
import { EditableTitle } from "../ui/editable-title";
import { Input } from "../ui/input";
import { InputGroup } from "../ui/input-group";
import { MetricCard } from "../ui/metric-card";
import { PaneHeader } from "../ui/pane-header";
import { ReadOnlyField } from "../ui/readonly-field";
import { ScrollArea } from "../ui/scroll-area";
import { Switch } from "../ui/switch";
import { Text } from "../ui/text";
import { MemoryNotesButton } from "./memory/MemoryNotesButton";
import { formatRelativeTime, pluralize } from "./project-view-utils";
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

/** A metric card's state from its query: a skeleton, or an error with a retry. */
function getMetricState(
	query: {
		isPending: boolean;
		isError: boolean;
		error: unknown;
		refetch: () => unknown;
	},
	errorLabel: string,
): ComponentProps<typeof MetricCard>["state"] {
	if (query.isPending) {
		return { status: "loading" };
	}
	if (query.isError) {
		const reason = query.error instanceof Error ? query.error.message : null;
		return {
			status: "error",
			message: reason ? `${errorLabel}: ${reason}` : errorLabel,
			onRetry: () => void query.refetch(),
		};
	}
	return { status: "ready" };
}

function SystemOverviewSubview({
	syncedAtLabel,
	tokenCount,
	projectScope,
	systemId,
}: {
	syncedAtLabel: string;
	tokenCount: number | null;
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
	const usedByCount = (usedByQuery.data?.usedByCount ?? 0).toLocaleString();
	// One fact under the count: the diagnostics when there are any, else the
	// folder the icons come from.
	const iconDetail =
		iconDiagnosticCount > 0
			? `${iconDiagnosticCount} ${pluralize(iconDiagnosticCount, "diagnostic")}`
			: (iconSampleRow ?? "No icon folders");

	const tokenValue =
		tokenCount === null ? "Not synced" : tokenCount.toLocaleString();

	return (
		<div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
			<MetricCard label="Tokens" value={tokenValue} />
			<MetricCard
				label="Assets"
				value={assets.length.toLocaleString()}
				state={getMetricState(assetsQuery, "Could not load assets")}
			/>
			<MetricCard
				label="Icons"
				value={iconCount.toLocaleString()}
				detail={iconDetail}
				state={getMetricState(iconFoldersQuery, "Could not load icons")}
			/>
			<MetricCard
				label="Used by"
				value={`${usedByCount} ${pluralize(usedByQuery.data?.usedByCount ?? 0, "design")}`}
				state={getMetricState(usedByQuery, "Could not load usage")}
			/>
			<MetricCard label="Last sync" value={syncedAtLabel} />
		</div>
	);
}

function SystemSettingsSubview({
	cssPath,
	projectScope,
	systemId,
	onRemove,
	removeDisabled,
	isRemoving,
	onSettingsPendingChange,
}: {
	cssPath: string;
	projectScope?: ProjectQueryScope;
	systemId: string;
	onRemove: () => void;
	removeDisabled: boolean;
	isRemoving: boolean;
	onSettingsPendingChange: (isPending: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const syncController = useTailwindSyncController();
	const [draftCssPath, setDraftCssPath] = useState(cssPath);
	const [settingsActionError, setSettingsActionError] = useState<string | null>(
		null,
	);
	const storageRoot = `.trickroom/systems/${systemId}`;
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
			error instanceof Error
				? `Could not save the system settings: ${error.message}`
				: "Could not save the system settings.",
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
	const settingsActionsDisabled = isMutatingSettings || removeDisabled;
	const saveCssPathDisabled =
		settingsActionsDisabled ||
		draftCssPath.trim().length === 0 ||
		draftCssPath.trim() === cssPath;

	useEffect(() => {
		setDraftCssPath(cssPath);
	}, [cssPath]);

	useEffect(() => {
		onSettingsPendingChange(isMutatingSettings);
	}, [isMutatingSettings, onSettingsPendingChange]);

	useEffect(() => {
		return () => onSettingsPendingChange(false);
	}, [onSettingsPendingChange]);

	const saveCssPath = () => {
		if (saveCssPathDisabled) return;
		updateSystemMutation.mutate({ cssPath: draftCssPath.trim() });
	};

	return (
		<div className="flex flex-col gap-4">
			{settingsError ? (
				<Alert variant="panel" tone="danger">
					{settingsError}
				</Alert>
			) : null}

			<DetailSection title="Details">
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
				<ReadOnlyField label="Storage" value={storageRoot} />
			</DetailSection>

			<DetailSection title="Project default">
				{/* Applies at once, so it is a switch, not a checkbox. */}
				<label
					htmlFor="system-settings-default"
					className="flex items-start justify-between gap-3"
				>
					<span className="flex min-w-0 flex-col gap-0.5">
						<Text variant="label" tone="foreground">
							Default system for new designs
						</Text>
						<Text tone="muted" className="text-[11px]">
							New designs automatically link to this system. Only one system can
							be default per project.
						</Text>
					</span>
					<Switch
						id="system-settings-default"
						checked={isDefaultSystem}
						onCheckedChange={(checked) => {
							if (checked === isDefaultSystem) {
								return;
							}
							updateDefaultSystemMutation.mutate(checked);
						}}
						disabled={settingsActionsDisabled}
					/>
				</label>
			</DetailSection>

			<DetailSection title="CSS file">
				<div className="flex min-w-0 flex-col gap-1.5">
					<label htmlFor="system-settings-css-path">
						<Text variant="label" tone="foreground">
							Path
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
						</InputGroup>
						<Button
							variant="outlined"
							className="flex items-center gap-1.5"
							onClick={saveCssPath}
							disabled={saveCssPathDisabled}
						>
							<Save className="size-3.5" aria-hidden="true" />
							{updateSystemMutation.isPending ? "Saving…" : "Save"}
						</Button>
					</div>
					<Text tone="muted" className="text-[11px]">
						Relative to the project folder. Trickroom reads the @theme tokens in
						this file.
					</Text>
				</div>
			</DetailSection>

			<DetailSection title="Danger zone" tone="danger">
				<DetailSectionRow
					title="Remove system"
					description="Trickroom stops reading this CSS file and deletes the stored tokens, assets, and icons. The CSS file stays on disk."
					action={
						<Button
							variant="outlined"
							flavor="danger"
							className="flex shrink-0 items-center gap-1.5"
							onClick={onRemove}
							disabled={settingsActionsDisabled}
						>
							<Trash2 className="size-3.5" aria-hidden="true" />
							{isRemoving ? "Removing…" : "Remove…"}
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
	// The latest sync response wins over the stored snapshot, which the sync
	// controller refreshes after each sync.
	const reviewRequired =
		data?.reviewRequired ?? storedTokensQuery.data?.reviewRequired ?? false;
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
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
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
			setRemoveDialogOpen(false);
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

	// The remove error shows inside the dialog, not behind its backdrop.
	const actionError = renameError
		? `Could not rename the system: ${renameError}`
		: null;
	const isSyncing = result.status === "pending";
	// A review counts the changes since the last confirmed one; a first review
	// (nothing confirmed yet), the full theme diff against Tailwind.
	const reviewCounts = getTokenReviewCounts({
		reviewChanges: data
			? data.reviewChanges
			: storedTokensQuery.data?.reviewChanges,
		baselineDiffs: data?.baselineDiffs ?? getStoredBaselineDiffs(storedDomains),
	});
	const rawTokenDiff: TokenDiff = {
		added: reviewCounts.added,
		overridden: reviewCounts.changed,
		removed: reviewCounts.removed,
	};
	const tokenDiff: TokenDiff = reviewRequired
		? rawTokenDiff
		: { added: 0, overridden: 0, removed: 0 };
	const syncErrorMessage = result.error?.message
		? `Could not sync tokens: ${result.error.message}`
		: storedTokensError
			? `Could not load stored tokens: ${storedTokensError}`
			: null;
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
				{saveMutation.isPending ? "Confirming…" : "Confirm review"}
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
				title={
					<>
						<EditableTitle
							value={systemDisplayName}
							aria-label="System name"
							disabled={actionDisabled}
							onRename={renameSystem}
						/>
						{/* No badge at rest: a word only when the state is abnormal. */}
						{syncState === "synced" ? null : (
							<SystemStatusBadge state={syncState} />
						)}
					</>
				}
				meta={
					<SystemDiffChips
						added={tokenDiff.added}
						overridden={tokenDiff.overridden}
						overriddenLabel={
							reviewCounts.sinceLastReview ? "changed" : undefined
						}
						removed={tokenDiff.removed}
					/>
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
								Could not confirm the review: {saveError}
							</Text>
						) : null}
					</>
				}
				actions={headerActions}
			/>

			<ScrollArea className="min-h-0 flex-1" viewportRef={detailViewportRef}>
				<div className="flex min-h-full flex-col gap-6 px-10 py-8">
					<SystemOverviewSubview
						syncedAtLabel={editedTime}
						tokenCount={tokenCount}
						projectScope={projectScope}
						systemId={systemId}
					/>
					<SystemSettingsSubview
						cssPath={cssPath}
						projectScope={projectScope}
						systemId={systemId}
						onRemove={() => {
							deleteMutation.reset();
							setRemoveDialogOpen(true);
						}}
						removeDisabled={actionDisabled}
						isRemoving={deleteMutation.isPending}
						onSettingsPendingChange={setIsSettingsMutationPending}
					/>
				</div>
			</ScrollArea>
			<ConfirmationDialog
				open={removeDialogOpen}
				onOpenChange={(open) => {
					if (!open && !deleteMutation.isPending) {
						setRemoveDialogOpen(false);
					}
				}}
				title="Remove system"
				description={
					<>
						Trickroom stops reading tokens from {cssBasename} and deletes the
						stored tokens, assets, and icons for &quot;{systemDisplayName}
						&quot;. The CSS file stays on disk. This can't be undone.
					</>
				}
				icon={<Trash2 className="size-4" aria-hidden="true" />}
				actionIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
				actionLabel={deleteMutation.isPending ? "Removing…" : "Remove system"}
				actionDisabled={deleteMutation.isPending}
				tone="destructive"
				onAction={handleDelete}
				error={
					deleteError
						? `Could not remove ${systemDisplayName}: ${deleteError}`
						: null
				}
			/>
		</div>
	);
}
