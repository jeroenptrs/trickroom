import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useMemo } from "react";
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
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
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
			<select
				id={`component-variant-${axisKey}`}
				className="w-full border-none bg-slate-200/60 px-1 py-0.5 text-xs text-slate-950 inset-shadow-[0_0_0_1px_transparent] focus:outline-none focus:inset-shadow-[0_0_0_1px_#67e8f9]"
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
			</select>
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
		<ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-amber-200 bg-amber-50/80 p-2 text-[11px] text-amber-900">
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
}) {
	const variantAxes = version?.variants?.axes ?? {};
	const canUpdate = isAttachedComponentStaleStatus(status);
	const designRevision = useDesignRevision();
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
		if (!version || overrideCount === 0) return;
		const confirmed = window.confirm(
			`Reset all overrides for "${componentName}"? This removes all className, text, icon, asset, and prop overrides on this instance.`,
		);
		if (!confirmed) return;
		resetSystemComponentOverrides(rootElementId, version);
	};

	const handleDetach = () => {
		const confirmed = window.confirm(
			`Detach "${componentName}"? This keeps the layers but removes component protection from the whole instance.`,
		);
		if (!confirmed) {
			return;
		}
		detachSystemComponent(rootElementId, version ?? undefined);
	};

	const handleUpdate = () => {
		if (
			!systemId ||
			!componentRecord ||
			!version ||
			!currentVersion ||
			updateBlocked
		) {
			return;
		}

		const reviewCount = reviewDiagnostics.length;
		const confirmMessage =
			reviewCount > 0
				? `Update "${componentName}" to version ${currentVersion.version}? ${reviewCount} migration note${reviewCount === 1 ? "" : "s"} may affect authored content.`
				: `Update "${componentName}" to version ${currentVersion.version}? Structure and settings will be preserved where possible.`;
		if (!window.confirm(confirmMessage)) {
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
					<ComponentStatusMessage status={status} instance={instance} />
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
								onClick={handleUpdate}
							>
								Update component
							</Button>
						) : null}
						{overrideCount > 0 ? (
							<Button
								type="button"
								variant="outlined"
								className="w-fit px-2 py-1 text-xs"
								onClick={handleResetOverrides}
							>
								Reset overrides
							</Button>
						) : null}
						<Button
							type="button"
							variant="outlined"
							className="w-fit px-2 py-1 text-xs"
							onClick={handleDetach}
						>
							Detach component
						</Button>
					</div>
				</div>
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
		return (
			<div className="px-3 py-3 text-xs text-slate-500">
				Loading component metadata…
			</div>
		);
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
		/>
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
