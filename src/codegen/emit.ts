import { type CodegenHeader, formatCodegenHeader } from "./header";
import type {
	CodegenComponentModel,
	CodegenConditionValue,
	CodegenSlotClasses,
} from "./model";
import { formatObjectKey } from "./names";

const INDENT = "\t";

const formatString = (value: string) => JSON.stringify(value);

const formatCondition = (
	value: CodegenConditionValue | CodegenConditionValue[],
): string =>
	Array.isArray(value)
		? `[${value.map((entry) => formatCondition(entry)).join(", ")}]`
		: typeof value === "boolean"
			? String(value)
			: formatString(value);

/** Lines of an object literal: `{}` when empty, one property per line otherwise. */
const formatObject = (
	entries: ReadonlyArray<[key: string, value: string | string[]]>,
	indent: string,
): string[] => {
	if (entries.length === 0) {
		return ["{}"];
	}
	const inner = indent + INDENT;
	const lines = ["{"];
	for (const [key, value] of entries) {
		const valueLines = typeof value === "string" ? [value] : value;
		lines.push(`${inner}${formatObjectKey(key)}: ${valueLines[0]}`);
		lines.push(...valueLines.slice(1));
		lines[lines.length - 1] += ",";
	}
	lines.push(`${indent}}`);
	return lines;
};

const formatArray = (items: ReadonlyArray<string[]>, indent: string) => {
	const inner = indent + INDENT;
	const lines = ["["];
	for (const item of items) {
		lines.push(`${inner}${item[0]}`, ...item.slice(1));
		lines[lines.length - 1] += ",";
	}
	lines.push(`${indent}]`);
	return lines;
};

const formatClasses = (
	model: CodegenComponentModel,
	classes: CodegenSlotClasses,
	indent: string,
): string | string[] =>
	model.shape === "flat"
		? formatString(classes[0]?.[1] ?? "")
		: formatObject(
				classes.map(([key, className]) => [key, formatString(className)]),
				indent,
			);

const formatConfig = (model: CodegenComponentModel): string[] => {
	const top = INDENT;
	const entries: Array<[string, string | string[]]> = [];

	if (model.shape === "flat") {
		const base = model.slots[0]?.className ?? "";
		if (base.length > 0) {
			entries.push(["base", formatString(base)]);
		}
	} else {
		entries.push([
			"slots",
			formatObject(
				model.slots.map(({ key, className }) => [key, formatString(className)]),
				top,
			),
		]);
	}

	if (model.axes.length > 0) {
		const axisIndent = top + INDENT;
		const valueIndent = axisIndent + INDENT;
		entries.push([
			"variants",
			formatObject(
				model.axes.map((axis) => [
					axis.key,
					formatObject(
						axis.values.map((value) => [
							value.key,
							formatClasses(model, value.classes, valueIndent),
						]),
						axisIndent,
					),
				]),
				top,
			),
		]);
	}

	if (model.compounds.length > 0) {
		const compoundIndent = top + INDENT;
		entries.push([
			"compoundVariants",
			formatArray(
				model.compounds.map((compound) =>
					formatObject(
						[
							...compound.when.map(([axisKey, value]): [string, string] => [
								axisKey,
								formatCondition(value),
							]),
							[
								"class",
								formatClasses(model, compound.classes, compoundIndent + INDENT),
							],
						],
						compoundIndent,
					),
				),
				top,
			),
		]);
	}

	if (model.defaults.length > 0) {
		entries.push([
			"defaultVariants",
			formatObject(
				model.defaults.map(([axisKey, value]) => [
					axisKey,
					formatCondition(value),
				]),
				top,
			),
		]);
	}

	return formatObject(entries, "");
};

const formatTypeAliases = (model: CodegenComponentModel) =>
	model.axes.map((axis) => {
		const type = axis.boolean
			? "boolean"
			: axis.values.length === 0
				? "never"
				: axis.values.map((value) => formatString(value.key)).join(" | ");
		return `export type ${axis.typeAlias} = ${type};`;
	});

export function renderVariantsFile({
	model,
	header,
	tvImport,
}: {
	model: CodegenComponentModel;
	header: CodegenHeader;
	tvImport: string;
}): string {
	const config = formatConfig(model);
	const typeAliases = formatTypeAliases(model);
	return [
		formatCodegenHeader(header),
		"",
		`import { tv } from ${formatString(tvImport)};`,
		"",
		...(config.length === 1
			? [`export const ${model.exportName} = tv(${config[0]});`]
			: [
					`export const ${model.exportName} = tv(${config[0]}`,
					...config.slice(1, -1),
					`${config[config.length - 1]});`,
				]),
		...(typeAliases.length > 0 ? ["", ...typeAliases] : []),
		"",
	].join("\n");
}
