import { compoundWhenSignature } from "./system-component-compound-signature";
import type {
	SystemComponentVariantAxis,
	SystemComponentVariantSchema,
} from "./system-components";

export type CompoundWhenShapeReason =
	| "empty_when"
	| "array_value"
	| "insufficient_conditions"
	| "unknown_axis"
	| "unknown_value";

export type CompoundWhenShapeKind = "normal" | "advanced";

export type CompoundWhenShapeClassification = {
	kind: CompoundWhenShapeKind;
	reasons: CompoundWhenShapeReason[];
	validSingleValueConditionCount: number;
};

const pushReason = (
	reasons: CompoundWhenShapeReason[],
	reason: CompoundWhenShapeReason,
) => {
	if (!reasons.includes(reason)) {
		reasons.push(reason);
	}
};

export function classifyCompoundWhenShape(
	when: Record<string, string | string[]>,
	axes: Record<string, SystemComponentVariantAxis> = {},
): CompoundWhenShapeClassification {
	const reasons: CompoundWhenShapeReason[] = [];
	const entries = Object.entries(when);

	if (entries.length === 0) {
		pushReason(reasons, "empty_when");
	}

	let validSingleValueConditionCount = 0;

	for (const [axisKey, value] of entries) {
		const trimmedAxis = axisKey.trim();
		if (Array.isArray(value)) {
			pushReason(reasons, "array_value");
			if (!Object.hasOwn(axes, trimmedAxis)) {
				pushReason(reasons, "unknown_axis");
			} else {
				for (const entry of value) {
					if (!Object.hasOwn(axes[trimmedAxis]?.values ?? {}, entry)) {
						pushReason(reasons, "unknown_value");
					}
				}
			}
			continue;
		}

		const trimmedValue = value.trim();
		if (!trimmedAxis || !trimmedValue) {
			continue;
		}

		if (!Object.hasOwn(axes, trimmedAxis)) {
			pushReason(reasons, "unknown_axis");
			continue;
		}
		if (!Object.hasOwn(axes[trimmedAxis]?.values ?? {}, trimmedValue)) {
			pushReason(reasons, "unknown_value");
			continue;
		}
		validSingleValueConditionCount += 1;
	}

	if (validSingleValueConditionCount < 2) {
		pushReason(reasons, "insufficient_conditions");
	}

	const kind: CompoundWhenShapeKind =
		reasons.length === 0 ? "normal" : "advanced";

	return {
		kind,
		reasons,
		validSingleValueConditionCount,
	};
}

export function isAdvancedCompoundWhen(
	when: Record<string, string | string[]>,
	axes: Record<string, SystemComponentVariantAxis> = {},
): boolean {
	return classifyCompoundWhenShape(when, axes).kind === "advanced";
}

const compoundWhenShapeReasonLabels: Record<CompoundWhenShapeReason, string> = {
	empty_when: "empty when",
	array_value: "array value",
	insufficient_conditions: "needs at least two conditions",
	unknown_axis: "unknown axis",
	unknown_value: "unknown value",
};

export function formatAdvancedCompoundShapeDiagnostic(
	reasons: CompoundWhenShapeReason[],
): string {
	return reasons
		.map((reason) => compoundWhenShapeReasonLabels[reason])
		.join("; ");
}

export function describeCompoundWhen(
	when: Record<string, string | string[]>,
	axes: Record<string, SystemComponentVariantAxis> = {},
): string {
	const parts = Object.entries(when).flatMap(([axisKey, value]) => {
		const axis = axes[axisKey];
		const axisLabel = axis?.label?.trim() || axisKey;
		if (Array.isArray(value)) {
			const valueLabels = value
				.map((entry) => axis?.values[entry]?.label?.trim() || entry)
				.join(", ");
			return valueLabels ? [`${axisLabel}: ${valueLabels}`] : [];
		}

		const trimmedValue = value.trim();
		if (!trimmedValue) {
			return [];
		}
		const valueLabel =
			axis?.values[trimmedValue]?.label?.trim() || trimmedValue;
		return [`${axisLabel}: ${valueLabel}`];
	});

	return parts.join(" · ");
}

export type AuthoredCompoundListEntry = {
	when: Record<string, string | string[]>;
	signature: string;
	isAdvanced: boolean;
	label: string;
	advancedDiagnostic?: string;
};

export function listAuthoredCompounds(
	variants: SystemComponentVariantSchema | null | undefined,
): AuthoredCompoundListEntry[] {
	const axes = variants?.axes ?? {};

	return (variants?.compoundVariants ?? [])
		.filter((compound) => Object.keys(compound.classesByPath).length > 0)
		.map((compound) => {
			const classification = classifyCompoundWhenShape(compound.when, axes);
			const isAdvanced = classification.kind === "advanced";
			return {
				when: compound.when,
				signature: compoundWhenSignature(compound.when),
				isAdvanced,
				label: describeCompoundWhen(compound.when, axes),
				...(isAdvanced
					? {
							advancedDiagnostic: formatAdvancedCompoundShapeDiagnostic(
								classification.reasons,
							),
						}
					: {}),
			};
		});
}

export function findDuplicateCompoundWhenSignatures(
	compounds: ReadonlyArray<{ when: Record<string, string | string[]> }>,
): string[] {
	const counts = new Map<string, number>();
	for (const compound of compounds) {
		const signature = compoundWhenSignature(compound.when);
		counts.set(signature, (counts.get(signature) ?? 0) + 1);
	}
	return [...counts.entries()]
		.filter(([, count]) => count > 1)
		.map(([signature]) => signature);
}
