import {
	buildPropertyModel,
	clearSpacing,
	type ModelOptions,
	type PropertyEntry,
	type SpacingProperty,
	type SpacingValue,
	serialize,
	setSpacing,
} from "../../../utils/tailwind-classname";

const DEFAULT_MODE = "";
const DEFAULT_VARIANT = "";

export function getSpacingEntry(
	className: string,
	options: ModelOptions,
	property: SpacingProperty,
): PropertyEntry | undefined {
	const model = buildPropertyModel(className, options);
	const entry =
		model.byMode[DEFAULT_MODE]?.byProperty[property]?.[DEFAULT_VARIANT];
	return entry?.intent.kind === "spacing" ? entry : undefined;
}

export function applySpacingChange(
	className: string,
	options: ModelOptions,
	mutation: {
		property: SpacingProperty;
		value: SpacingValue;
		negative?: boolean;
		variants?: string[];
	},
): string {
	const model = buildPropertyModel(className, options);
	const next = setSpacing(
		model,
		{
			property: mutation.property,
			value: mutation.value,
			negative: mutation.negative,
			variants: mutation.variants,
		},
		options,
	);
	return serialize(next);
}

export function applySpacingClear(
	className: string,
	options: ModelOptions,
	property: SpacingProperty,
	variants: string[] = [],
): string {
	const model = buildPropertyModel(className, options);
	const next = clearSpacing(model, property, options, { variants });
	return serialize(next);
}

export function formatSpacingInputValue(
	entry: PropertyEntry | undefined,
): string {
	if (!entry || entry.intent.kind !== "spacing") {
		return "";
	}

	const prefix = entry.intent.negative ? "-" : "";
	const { value } = entry.intent;
	switch (value.kind) {
		case "scale":
			return `${prefix}${value.value}`;
		case "keyword":
			return value.keyword;
		case "arbitrary":
			return `${prefix}${value.value}`;
		case "custom-property":
			return `${prefix}${value.value}`;
	}
}

export function parseSpacingInputValue(
	input: string,
	property: SpacingProperty,
): { value: SpacingValue; negative: boolean } | null {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return null;
	}

	let negative = false;
	let rawValue = trimmed;
	if (isMarginProperty(property) && rawValue.startsWith("-")) {
		negative = true;
		rawValue = rawValue.slice(1);
	}

	if (rawValue.length === 0) {
		return null;
	}

	if (rawValue === "auto") {
		return isMarginProperty(property)
			? { value: { kind: "keyword", keyword: "auto" }, negative: false }
			: null;
	}

	if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
		return { value: { kind: "arbitrary", value: rawValue }, negative };
	}

	if (rawValue.startsWith("(") && rawValue.endsWith(")")) {
		return { value: { kind: "custom-property", value: rawValue }, negative };
	}

	if (rawValue.startsWith("--")) {
		return { value: { kind: "custom-property", value: rawValue }, negative };
	}

	return { value: { kind: "scale", value: rawValue }, negative };
}

export function isMarginProperty(property: SpacingProperty): boolean {
	return property === "margin" || property.startsWith("margin-");
}
