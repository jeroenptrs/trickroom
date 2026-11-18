import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
	type ComponentDraftStyleTarget,
	focusCompoundInDraft,
	removeCompoundVariantByWhen,
	useComponentDraftStyleTarget,
	useComponentDraftVariants,
} from "../../stores/component-draft-store";
import {
	type AuthoredCompoundListEntry,
	listAuthoredCompounds,
} from "../../utils/system-component-compound-shape";
import { compoundWhenSignature } from "../../utils/system-component-compound-signature";
import { ConfirmationDialog } from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Text } from "../ui/text";
import { Tooltip } from "../ui/tooltip";

function toFocusableCompoundWhen(
	when: Record<string, string | string[]>,
): Record<string, string> | null {
	const result: Record<string, string> = {};
	for (const [axisKey, value] of Object.entries(when)) {
		if (Array.isArray(value)) {
			return null;
		}
		const trimmedValue = value.trim();
		if (!trimmedValue) {
			return null;
		}
		result[axisKey] = trimmedValue;
	}
	return Object.keys(result).length >= 2 ? result : null;
}

function getActiveCompoundSignature(styleTarget: ComponentDraftStyleTarget) {
	if (
		styleTarget.activeTab.kind !== "compound" ||
		styleTarget.compoundAxes.length < 2
	) {
		return null;
	}

	const when: Record<string, string> = {};
	for (const axisKey of styleTarget.compoundAxes) {
		const valueKey = styleTarget.axisValues[axisKey];
		if (!valueKey) {
			return null;
		}
		when[axisKey] = valueKey;
	}

	return compoundWhenSignature(when);
}

export function AuthoredCompoundsList({ onMutate }: { onMutate?: () => void }) {
	const variants = useComponentDraftVariants();
	const styleTarget = useComponentDraftStyleTarget();
	const entries = useMemo(() => listAuthoredCompounds(variants), [variants]);
	const activeSignature = getActiveCompoundSignature(styleTarget);

	// The draft has no undo, and a compound holds painted classes, so
	// removing one asks first.
	const [pendingDelete, setPendingDelete] =
		useState<AuthoredCompoundListEntry | null>(null);
	const handleDelete = (entry: AuthoredCompoundListEntry) => {
		removeCompoundVariantByWhen(entry.when);
		onMutate?.();
	};

	const handleFocus = (entry: AuthoredCompoundListEntry) => {
		const when = toFocusableCompoundWhen(entry.when);
		if (!when) {
			return;
		}
		focusCompoundInDraft(when);
	};

	if (entries.length === 0) {
		return null;
	}

	return (
		<section className="flex flex-col gap-2 border-b border-slate-200 pb-3">
			<div className="flex flex-col gap-1">
				<Text variant="group-label" render={<p />}>
					Compound variants
				</Text>
				<Text variant="meta" render={<p />}>
					Select one to edit its classes.
				</Text>
			</div>
			<ul className="flex flex-col gap-1">
				{entries.map((entry) => {
					const isActive = entry.signature === activeSignature;
					if (entry.isAdvanced) {
						return (
							<li key={entry.signature}>
								<Card
									edge="border"
									tone="warning"
									className="flex items-start justify-between gap-2 px-2 py-1.5"
								>
									<div className="min-w-0 flex-1">
										<p
											className="truncate text-sm text-slate-900"
											title={entry.label}
										>
											{entry.label || "Advanced compound variant"}
										</p>
										<p className="mt-0.5 text-[11px] text-amber-800">
											Advanced shape: {entry.advancedDiagnostic}
										</p>
									</div>
									<RemoveCompoundButton
										label={entry.label}
										onClick={() => setPendingDelete(entry)}
									/>
								</Card>
							</li>
						);
					}

					return (
						<li key={entry.signature}>
							<div
								className={`flex items-stretch border ${
									isActive
										? "border-cyan-300 bg-cyan-50"
										: "border-slate-200 bg-white"
								}`}
							>
								<button
									type="button"
									className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"
									title={entry.label}
									aria-pressed={isActive}
									onClick={() => handleFocus(entry)}
								>
									{entry.label || "Compound variant"}
								</button>
								<RemoveCompoundButton
									label={entry.label}
									onClick={() => setPendingDelete(entry)}
								/>
							</div>
						</li>
					);
				})}
			</ul>
			<ConfirmationDialog
				open={pendingDelete !== null}
				onOpenChange={(open) => {
					if (!open) setPendingDelete(null);
				}}
				tone="destructive"
				title={
					pendingDelete?.label
						? `Remove compound variant ${pendingDelete.label}`
						: "Remove compound variant"
				}
				description="Its classes are removed with it. This can't be undone."
				icon={<Trash2 className="size-4" aria-hidden="true" />}
				actionLabel="Remove compound variant"
				onAction={() => {
					if (pendingDelete) handleDelete(pendingDelete);
					setPendingDelete(null);
				}}
			/>
		</section>
	);
}

function RemoveCompoundButton({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) {
	return (
		<Tooltip content="Remove compound variant">
			<Button
				type="button"
				variant="block"
				flavor="danger"
				className="shrink-0 px-2 py-1"
				aria-label={
					label ? `Remove compound variant ${label}` : "Remove compound variant"
				}
				onClick={onClick}
			>
				<Trash2 className="size-3.5" aria-hidden="true" />
			</Button>
		</Tooltip>
	);
}
