import { Trash2 } from "lucide-react";
import { useMemo } from "react";
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
import { Button } from "../ui/button";

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
			<div>
				<p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
					Authored compounds
				</p>
				<p className="mt-1 text-[11px] text-slate-500">
					Compounds with painted classes appear here. Select a row to edit them
					with the Compound style target on the right.
				</p>
			</div>
			<ul className="flex flex-col gap-1">
				{entries.map((entry) => {
					const isActive = entry.signature === activeSignature;
					if (entry.isAdvanced) {
						return (
							<li
								key={entry.signature}
								className="flex items-start justify-between gap-2 border border-amber-200 bg-amber-50 px-2 py-1.5"
							>
								<div className="min-w-0 flex-1">
									<p
										className="truncate text-sm text-slate-900"
										title={entry.label}
									>
										{entry.label || "Advanced compound"}
									</p>
									<p className="mt-0.5 text-[11px] text-amber-800">
										Advanced shape: {entry.advancedDiagnostic}
									</p>
								</div>
								<Button
									type="button"
									variant="block"
									flavor="warning"
									className="shrink-0 px-2 py-1"
									title="Remove compound"
									onClick={() => handleDelete(entry)}
								>
									<Trash2 className="size-3.5" aria-hidden="true" />
								</Button>
							</li>
						);
					}

					return (
						<li key={entry.signature}>
							<div
								className={`flex items-center justify-between gap-2 border px-2 py-1.5 ${
									isActive
										? "border-cyan-300 bg-cyan-50"
										: "border-slate-200 bg-white"
								}`}
							>
								<button
									type="button"
									className="min-w-0 flex-1 truncate text-left text-sm text-slate-900 hover:text-cyan-800"
									title={entry.label}
									onClick={() => handleFocus(entry)}
								>
									{entry.label || "Compound"}
								</button>
								<Button
									type="button"
									variant="block"
									flavor="warning"
									className="shrink-0 px-2 py-1"
									title="Remove compound"
									onClick={() => handleDelete(entry)}
								>
									<Trash2 className="size-3.5" aria-hidden="true" />
								</Button>
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
