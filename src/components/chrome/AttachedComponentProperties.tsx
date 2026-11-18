import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { RefreshCw, RotateCcw, Unlink } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { systemComponentQueryOptions } from "../../queries/system-components";
import {
	designStore,
	detachSystemComponent,
	resetSystemComponentOverrides,
	serializeDesign,
	setSystemComponentVariantValue,
	updateSystemComponentInstance,
	useDesignRevision,
	useDesignSystemId,
} from "../../stores/design-store";
import {
	isSystemComponentInstanceMigrationUpdateBlocked,
	previewSystemComponentInstanceMigration,
	SystemComponentInstanceMigrationError,
} from "../../utils/system-component-instance-migration";
import type { SystemComponentMigrationDiagnostic } from "../../utils/system-component-migration";
import type { SystemComponentInstanceMetadata } from "../../utils/system-component-ownership";
import type {
	PublishedSystemComponentVersion,
	SystemComponentRecord,
	SystemComponentVariantAxis,
} from "../../utils/system-components";
import { useProjectScope } from "../contexts";
import { useClassMergeContext } from "../stage/class-merge-context";
import { Alert } from "../ui/alert";
import { ConfirmationDialog } from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import {
	type AttachedComponentInspection,
	type AttachedComponentVersionStatus,
	attachedComponentVersionStatusLabel,
	getAttachedComponentInspection,
	getAttachedComponentVersionStatus,
	getCurrentPublishedVersionForInstance,
	getPublishedVersionForInstance,
	isAttachedComponentStaleStatus,
} from "./attached-component-inspector";
import { getSystemComponentEditorPath } from "./ExtractSystemComponentDialog";
import { errorReason, RetryError } from "./RetryError";

type AttachedComponentPropertiesProps = {
	inspection: AttachedComponentInspection;
};

const unsetVariantAxisValue = "__trickroom_unset_variant_axis__";

const VARIANT_SEGMENT_THRESHOLD = 4;

function VariantAxisControl({
	rootElementId,
	version,
	axisKey,
	axis,
	currentValue,
}: {
	rootElementId: string;
	version: PublishedSystemComponentVersion;
	axisKey: string;
	axis: SystemComponentVariantAxis;
	currentValue: string | undefined;
}) {
	const options = Object.entries(axis.values);
	const onChange = (next: string | null) =>
		setSystemComponentVariantValue(rootElementId, version, axisKey, next);

	if (options.length <= VARIANT_SEGMENT_THRESHOLD) {
		return (
			<div className="flex flex-col gap-1 text-xs">
				<span className="font-semibold">{axis.label}</span>
				<div className="flex flex-row">
					{options.map(([valueKey, value]) => (
						<Button
							key={valueKey}
							variant="block"
							isSelected={currentValue === valueKey}
							className="min-w-0 flex-1 px-2 py-1 text-xs"
							onClick={() => onChange(valueKey)}
						>
							{value.label ?? valueKey}
						</Button>
					))}
				</div>
			</div>
		);
	}

	const selectValue = currentValue ?? unsetVariantAxisValue;
	return (
		<div className="flex flex-col gap-1 text-xs">
			<label className="font-semibold" htmlFor={`component-variant-${axisKey}`}>
				{axis.label}
			</label>
			<Select
				id={`component-variant-${axisKey}`}
				value={selectValue}
				onChange={(event) =>
					onChange(
						event.currentTarget.value === unsetVariantAxisValue
							? null
							: event.currentTarget.value,
					)
				}
			>
				<option value={unsetVariantAxisValue}>Unselected</option>
				{options.map(([valueKey, value]) => (
					<option key={valueKey} value={valueKey}>
						{value.label ?? valueKey}
					</option>
				))}
			</Select>
		</div>
	);
}

function ComponentStatusMessage({
	status,
	instance,
}: {
	status: AttachedComponentVersionStatus;
	instance: SystemComponentInstanceMetadata;
}) {
	switch (status) {
		case "current":
			return null;
		case "stale-version":
		case "stale-template":
		case "stale-variants":
		case "stale-both":
			return (
				<Alert variant="inline" tone="warning">
					This attached component does not match the current published
					component. Review the migration notes below, then update when ready.
				</Alert>
			);
		case "missing-component":
			return (
				<Alert variant="inline" tone="danger">
					This instance references component {instance.componentId}, but that
					component is not available in the current design system. Reconnect the
					system component or detach this instance before editing its structure.
				</Alert>
			);
		case "missing-version":
			return (
				<Alert variant="inline" tone="danger">
					This instance references version {instance.version}, but that
					published version is not available. Restore the version, update the
					instance when migration is available, or detach it.
				</Alert>
			);
		case "unknown":
			return (
				<Alert variant="inline" tone="danger">
					Published component metadata could not be loaded. Check the linked
					design system, or detach this instance if you need to edit it now.
				</Alert>
			);
	}
}

function MigrationDiagnosticsList({
	diagnostics,
}: {
	diagnostics: SystemComponentMigrationDiagnostic[];
}) {
	if (diagnostics.length === 0) {
		return null;
	}

	return (
		<ul className="flex max-h-40 flex-col gap-1 overflow-y-auto border border-amber-200 bg-amber-50/80 p-2 text-[11px] text-amber-900">
			{diagnostics.map((diagnostic, index) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: migration diagnostics are an ephemeral, render-only list with no stable id (codes may repeat).
					key={`${diagnostic.code}-${index}`}
				>
					{diagnostic.message}
				</li>
			))}
		</ul>
	);
}

function AttachedComponentRootControls({
	rootElementId,
	instance,
	version,
	currentVersion,
	status,
	componentName,
	systemId,
	componentRecord,
	onOpen,
	loadError,
}: {
	rootElementId: string;
	instance: SystemComponentInstanceMetadata;
	version: PublishedSystemComponentVersion | null;
	currentVersion: PublishedSystemComponentVersion | null;
	status: AttachedComponentVersionStatus;
	componentName: string;
	systemId: string | null;
	componentRecord: SystemComponentRecord | undefined;
	onOpen: (() => void) | null;
	/** The component request failed: what to show, with its retry. */
	loadError: {
		reason: string | undefined;
		retrying: boolean;
		onRetry: () => void;
	} | null;
}) {
	const [confirm, setConfirm] = useState<"reset" | "detach" | "update" | null>(
		null,
	);
	const variantAxes = version?.variants?.axes ?? {};
	const canUpdate = isAttachedComponentStaleStatus(status);
	const designRevision = useDesignRevision();
	// Detached layers keep exactly the classes the canvas renders them with.
	const classSource = useClassMergeContext().source;
	// biome-ignore lint/correctness/useExhaustiveDependencies: designRevision and instance.overrides are intentional recompute triggers — the memo reads live design state via serializeDesign(), which is not otherwise reactive.
	const migrationPreview = useMemo(() => {
		if (
			!canUpdate ||
			!systemId ||
			!componentRecord ||
			!version ||
			!currentVersion
		) {
			return null;
		}

		try {
			return previewSystemComponentInstanceMigration(
				serializeDesign().boards,
				rootElementId,
				{
					systemId,
					componentId: instance.componentId,
					record: componentRecord,
					sourceVersion: version,
					targetVersion: currentVersion,
				},
			);
		} catch {
			return null;
		}
	}, [
		canUpdate,
		componentRecord,
		currentVersion,
		designRevision,
		instance.componentId,
		instance.overrides,
		rootElementId,
		systemId,
		version,
	]);
	const reviewDiagnostics = useMemo(() => {
		if (!migrationPreview) {
			return [];
		}
		const seen = new Set<string>();
		return [
			...migrationPreview.classification.diagnostics,
			...migrationPreview.migrationDiagnostics,
		].filter((diagnostic) => {
			const key = `${diagnostic.code}:${diagnostic.message}`;
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			return (
				diagnostic.severity === "review" || diagnostic.severity === "warning"
			);
		});
	}, [migrationPreview]);
	const updateBlocked =
		isSystemComponentInstanceMigrationUpdateBlocked(migrationPreview);
	const overrideCount = Object.keys(instance.overrides).length;

	const handleOpen = onOpen ?? null;

	const handleResetOverrides = () => {
		setConfirm(null);
		if (!version || overrideCount === 0) return;
		resetSystemComponentOverrides(rootElementId, version);
	};

	const handleDetach = () => {
		setConfirm(null);
		detachSystemComponent(rootElementId, version ?? undefined, classSource);
	};

	const reviewCount = reviewDiagnostics.length;
	const handleUpdate = () => {
		setConfirm(null);
		if (
			!systemId ||
			!componentRecord ||
			!version ||
			!currentVersion ||
			updateBlocked
		) {
			return;
		}

		try {
			updateSystemComponentInstance(rootElementId, {
				systemId,
				componentId: instance.componentId,
				record: componentRecord,
				sourceVersion: version,
				targetVersion: currentVersion,
			});
			toast.success(`Updated ${componentName}.`);
		} catch (error) {
			const message =
				error instanceof SystemComponentInstanceMigrationError ||
				error instanceof Error
					? error.message
					: "Failed to update component.";
			toast.error(message);
		}
	};

	return (
		<>
			<section className="flex flex-col">
				<div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-slate-700">
					<span>Component</span>
					{handleOpen ? (
						<button
							type="button"
							className="text-[11px] font-normal text-cyan-700 hover:text-cyan-900"
							onClick={handleOpen}
						>
							Open
						</button>
					) : null}
				</div>
				<div className="flex flex-col gap-2 px-3 pb-3 text-xs text-slate-600">
					<div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
						<span className="font-semibold text-slate-700">Name</span>
						<span className="truncate">{componentName}</span>
						<span className="font-semibold text-slate-700">Version</span>
						<span>{instance.version}</span>
						<span className="font-semibold text-slate-700">Status</span>
						<span>{attachedComponentVersionStatusLabel(status)}</span>
						{currentVersion && currentVersion.version !== instance.version ? (
							<>
								<span className="font-semibold text-slate-700">Latest</span>
								<span>{currentVersion.version}</span>
							</>
						) : null}
						{overrideCount > 0 ? (
							<>
								<span className="font-semibold text-slate-700">Modified</span>
								<span>
									{overrideCount} target{overrideCount === 1 ? "" : "s"}
								</span>
							</>
						) : null}
					</div>
					{loadError ? (
						<RetryError
							message={`Could not load ${componentName}`}
							reason={loadError.reason}
							retrying={loadError.retrying}
							onRetry={loadError.onRetry}
						/>
					) : (
						<ComponentStatusMessage status={status} instance={instance} />
					)}
					{reviewDiagnostics.length > 0 ? (
						<MigrationDiagnosticsList diagnostics={reviewDiagnostics} />
					) : null}
					{migrationPreview?.blockMessage ? (
						<p className="text-[11px] text-red-700" role="alert">
							{migrationPreview.blockMessage}
						</p>
					) : null}
					<div className="flex flex-wrap gap-2">
						{canUpdate ? (
							<Button
								type="button"
								variant="outlined"
								className="w-fit px-2 py-1 text-xs"
								disabled={updateBlocked}
								onClick={() => setConfirm("update")}
							>
								Update component
							</Button>
						) : null}
						{overrideCount > 0 ? (
							<Button
								type="button"
								variant="outlined"
								className="w-fit px-2 py-1 text-xs"
								onClick={() => setConfirm("reset")}
							>
								Reset overrides
							</Button>
						) : null}
						<Button
							type="button"
							variant="outlined"
							className="w-fit px-2 py-1 text-xs"
							onClick={() => setConfirm("detach")}
						>
							Detach component
						</Button>
					</div>
				</div>
				<ConfirmationDialog
					open={confirm === "update"}
					onOpenChange={(open) => {
						if (!open) setConfirm(null);
					}}
					title={`Update ${componentName} to version ${currentVersion?.version ?? ""}`}
					description={
						reviewCount > 0
							? `${reviewCount} migration ${reviewCount === 1 ? "note needs" : "notes need"} review.`
							: "Structure and settings are kept where they still fit."
					}
					icon={<RefreshCw className="size-4" aria-hidden="true" />}
					actionLabel="Update instance"
					onAction={handleUpdate}
				/>
				<ConfirmationDialog
					open={confirm === "reset"}
					onOpenChange={(open) => {
						if (!open) setConfirm(null);
					}}
					tone="destructive"
					title="Reset overrides"
					description="Removes every class, text, icon, asset, and property override on this instance. This can't be undone."
					icon={<RotateCcw className="size-4" aria-hidden="true" />}
					actionLabel="Reset overrides"
					onAction={handleResetOverrides}
				/>
				<ConfirmationDialog
					open={confirm === "detach"}
					onOpenChange={(open) => {
						if (!open) setConfirm(null);
					}}
					tone="destructive"
					title={`Detach ${componentName}`}
					description="The layers stay. They no longer update with the component. This can't be undone."
					icon={<Unlink className="size-4" aria-hidden="true" />}
					actionLabel="Detach instance"
					onAction={handleDetach}
				/>
			</section>
			{version && Object.keys(variantAxes).length > 0 ? (
				<section className="flex flex-col">
					<div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-slate-700">
						Variants
					</div>
					<div className="flex flex-col gap-2 px-3 pb-3">
						{Object.entries(variantAxes).map(([axisKey, axis]) => (
							<VariantAxisControl
								key={axisKey}
								rootElementId={rootElementId}
								version={version}
								axisKey={axisKey}
								axis={axis}
								currentValue={
									instance.variantValues[axisKey] ??
									version?.variants?.defaultValues?.[axisKey] ??
									axis.defaultValue
								}
							/>
						))}
					</div>
				</section>
			) : null}
		</>
	);
}

function AttachedComponentOwnedContext({
	inspection,
	componentName,
}: {
	inspection: Extract<AttachedComponentInspection, { kind: "owned-internal" }>;
	componentName: string;
}) {
	return (
		<section className="flex flex-col">
			<div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-slate-700">
				Attached component
			</div>
			<div className="flex flex-col gap-2 px-3 pb-3 text-xs text-slate-600">
				<p>
					This layer is owned by <strong>{componentName}</strong> v
					{inspection.instance.version}. Structural edits are locked; published
					editable fields appear in their normal tabs.
				</p>
				<div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
					<span className="font-semibold text-slate-700">Template path</span>
					<span className="font-mono text-[11px]">
						{inspection.templatePath}
					</span>
					{inspection.slotName ? (
						<>
							<span className="font-semibold text-slate-700">Slot</span>
							<span>{inspection.slotName}</span>
						</>
					) : null}
				</div>
			</div>
		</section>
	);
}

export function AttachedComponentProperties({
	inspection,
}: AttachedComponentPropertiesProps) {
	const navigate = useNavigate();
	const systemId = useDesignSystemId();
	const projectScope = useProjectScope();
	const rootEntity = useSelector(designStore, (state) =>
		inspection.kind === "root"
			? (state.entitiesById[inspection.rootElementId] ?? null)
			: null,
	);

	const componentId =
		inspection.kind === "root" || inspection.kind === "owned-internal"
			? inspection.instance.componentId
			: inspection.kind === "slot-content"
				? inspection.slot.componentId
				: null;

	const componentQuery = useQuery({
		...systemComponentQueryOptions(
			systemId ?? "",
			componentId ?? "",
			projectScope,
		),
		enabled: Boolean(systemId && componentId),
	});

	const publishedVersion = useMemo(() => {
		if (inspection.kind !== "root" && inspection.kind !== "owned-internal") {
			return null;
		}
		return getPublishedVersionForInstance(
			componentQuery.data?.record,
			inspection.instance.version,
		);
	}, [componentQuery.data?.record, inspection]);
	const currentPublishedVersion = useMemo(() => {
		if (inspection.kind !== "root" && inspection.kind !== "owned-internal") {
			return null;
		}
		return (
			getCurrentPublishedVersionForInstance(componentQuery.data?.record) ??
			publishedVersion
		);
	}, [componentQuery.data?.record, inspection, publishedVersion]);
	const rootVersionStatus = useMemo<AttachedComponentVersionStatus>(() => {
		if (inspection.kind !== "root") {
			return "unknown";
		}
		if (!componentQuery.data?.record) {
			return componentQuery.isError ? "missing-component" : "unknown";
		}
		if (!publishedVersion) {
			return "missing-version";
		}
		if (!rootEntity) {
			return "unknown";
		}
		return getAttachedComponentVersionStatus(
			rootEntity.props,
			publishedVersion,
			componentQuery.data.record.published?.currentVersion,
		);
	}, [
		componentQuery.data?.record,
		componentQuery.isError,
		inspection,
		publishedVersion,
		rootEntity,
	]);

	if (inspection.kind === "none") {
		return null;
	}

	const componentName =
		componentQuery.data?.record.name ??
		(inspection.kind === "slot-content"
			? inspection.slot.componentId
			: inspection.instance.componentId);

	if (componentQuery.isPending && systemId && componentId) {
		return <AttachedComponentSkeleton />;
	}

	if (inspection.kind === "owned-internal") {
		return (
			<AttachedComponentOwnedContext
				inspection={inspection}
				componentName={componentName}
			/>
		);
	}

	if (inspection.kind === "slot-content") {
		return (
			<section className="flex flex-col">
				<div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-slate-700">
					Attached component
				</div>
				<div className="px-3 pb-3 text-xs text-slate-600">
					<p>
						This layer sits inside the{" "}
						<strong>{inspection.slot.slotName}</strong> slot of{" "}
						<strong>{componentName}</strong>. Slot content remains editable;
						component structure does not.
					</p>
				</div>
			</section>
		);
	}

	const onOpen = systemId
		? () =>
				navigate(
					getSystemComponentEditorPath(
						systemId,
						inspection.instance.componentId,
					),
				)
		: null;

	return (
		<AttachedComponentRootControls
			rootElementId={inspection.rootElementId}
			instance={inspection.instance}
			version={publishedVersion}
			currentVersion={currentPublishedVersion}
			status={rootVersionStatus}
			componentName={componentName}
			systemId={systemId}
			componentRecord={componentQuery.data?.record}
			onOpen={onOpen}
			loadError={
				componentQuery.isError
					? {
							reason: errorReason(componentQuery.error),
							retrying: componentQuery.isFetching,
							onRetry: () => void componentQuery.refetch(),
						}
					: null
			}
		/>
	);
}

/** The Component section while its metadata loads. */
function AttachedComponentSkeleton() {
	return (
		<section className="flex flex-col" aria-busy="true">
			<div className="px-3 py-2">
				<Skeleton className="h-3 w-20" />
			</div>
			<div className="flex flex-col gap-2 px-3 pb-3">
				{[0, 1, 2, 3].map((row) => (
					<div key={row} className="flex gap-2">
						<Skeleton className="h-3 w-14" />
						<Skeleton className="h-3 w-24" />
					</div>
				))}
				<div className="flex gap-2">
					<Skeleton className="h-6 w-28" />
					<Skeleton className="h-6 w-32" />
				</div>
			</div>
		</section>
	);
}

export function useAttachedComponentInspection() {
	const selectedElement = useSelector(designStore, (state) =>
		state.selectedId ? (state.entitiesById[state.selectedId] ?? null) : null,
	);

	return useSelector(designStore, (state) =>
		getAttachedComponentInspection(state.entitiesById, selectedElement),
	);
}
