import { useQuery } from "@tanstack/react-query";
import {
	type MemoryQueryScope,
	referenceTargetsQueryOptions,
} from "../../../queries/memory";
import type { ProjectQueryScope } from "../../../queries/project-scope";
import type { MemoryReferenceType } from "../../../utils/memory-references";
import { Text } from "../../ui/text";
import {
	type ActiveReferenceTrigger,
	filterReferenceTypes,
	formatMemoryReferenceToken,
	MEMORY_REFERENCE_TYPE_LABELS,
} from "./memory-reference-editor";

export function MemoryReferenceSuggest({
	trigger,
	scope,
	projectScope,
	onPickType,
	onPickTarget,
}: {
	trigger: ActiveReferenceTrigger;
	scope: MemoryQueryScope;
	projectScope?: ProjectQueryScope;
	onPickType: (type: MemoryReferenceType) => void;
	onPickTarget: (type: MemoryReferenceType, id: string) => void;
}) {
	if (trigger.kind === "types") {
		const types = filterReferenceTypes(trigger.filter);
		return (
			<div
				className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto border border-slate-200 bg-white py-1 shadow-lg"
				role="listbox"
				aria-label="Reference type"
			>
				{types.length === 0 ? (
					<Text className="px-2.5 py-2 text-xs text-slate-500">
						No matching reference types.
					</Text>
				) : (
					types.map((type) => (
						<button
							key={type}
							type="button"
							role="option"
							className="flex w-full cursor-pointer flex-col items-start px-2.5 py-1.5 text-left hover:bg-cyan-50"
							onMouseDown={(event) => {
								event.preventDefault();
								onPickType(type);
							}}
						>
							<Text className="text-xs font-medium text-slate-900">
								{MEMORY_REFERENCE_TYPE_LABELS[type]}
							</Text>
							<Text tone="faint" className="font-mono text-[10px]">
								{`{{${type}:…}}`}
							</Text>
						</button>
					))
				)}
			</div>
		);
	}

	return (
		<MemoryReferenceTargetSuggest
			trigger={trigger}
			scope={scope}
			projectScope={projectScope}
			onPickTarget={onPickTarget}
		/>
	);
}

function MemoryReferenceTargetSuggest({
	trigger,
	scope,
	projectScope,
	onPickTarget,
}: {
	trigger: Extract<ActiveReferenceTrigger, { kind: "targets" }>;
	scope: MemoryQueryScope;
	projectScope?: ProjectQueryScope;
	onPickTarget: (type: MemoryReferenceType, id: string) => void;
}) {
	const targetsQuery = useQuery(
		referenceTargetsQueryOptions(
			scope,
			trigger.type,
			trigger.query,
			projectScope,
		),
	);
	const targets = targetsQuery.data?.targets ?? [];

	return (
		<div
			className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto border border-slate-200 bg-white py-1 shadow-lg"
			role="listbox"
			aria-label={`${MEMORY_REFERENCE_TYPE_LABELS[trigger.type]} targets`}
		>
			{targetsQuery.isPending ? (
				<Text className="px-2.5 py-2 text-xs text-slate-500">Loading…</Text>
			) : targets.length === 0 ? (
				<Text className="px-2.5 py-2 text-xs text-slate-500">
					No matching targets.
				</Text>
			) : (
				targets.map((target) => (
					<button
						key={target.id}
						type="button"
						role="option"
						className="flex w-full cursor-pointer flex-col items-start px-2.5 py-1.5 text-left hover:bg-cyan-50"
						onMouseDown={(event) => {
							event.preventDefault();
							onPickTarget(trigger.type, target.id);
						}}
					>
						<Text className="text-xs font-medium text-slate-900">
							{target.label}
						</Text>
						<Text tone="faint" className="font-mono text-[10px]">
							{formatMemoryReferenceToken(trigger.type, target.id)}
						</Text>
					</button>
				))
			)}
		</div>
	);
}
