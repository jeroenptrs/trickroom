import type { RecipeTemplateNode } from "../types";
import { compareSystemComponentVariantAxisKeys } from "../utils/system-component-variant-class-layers";
import type {
	SystemComponentDraftPayload,
	SystemComponentRecord,
	SystemComponentVariantAxis,
} from "../utils/system-components";
import {
	axisTypeAliasName,
	isValidIdentifier,
	toCamelCase,
	variantsExportName,
	variantsFileName,
} from "./names";

export type CodegenDiagnosticSeverity = "error" | "warning";

export type CodegenDiagnosticCode =
	| "UNKNOWN_INCLUDE_SLUG"
	| "UNKNOWN_EXCLUDE_SLUG"
	| "UNPUBLISHED_COMPONENT"
	| "MISSING_PUBLISHED_VERSION"
	| "NO_SOURCE_PAYLOAD"
	| "DUPLICATE_FILE_NAME"
	| "DUPLICATE_EXPORT_NAME"
	| "INVALID_EXPORT_NAME"
	| "DUPLICATE_PART_PATH"
	| "PART_KEY_COLLISION"
	| "RESERVED_PART_PATH"
	| "INVALID_PART_IDENTIFIER"
	| "RESERVED_AXIS_NAME"
	| "INVALID_TYPE_ALIAS"
	| "DUPLICATE_TYPE_ALIAS"
	| "UNKNOWN_CLASS_TARGET"
	| "DEFAULT_CHILD_CLASS_TARGET"
	| "INVALID_BOOLEAN_AXIS"
	| "BOOLEAN_AXIS_WITHOUT_DEFAULT"
	| "TEMPLATE_PROPS_CLASS_NAME";

export type CodegenDiagnostic = {
	code: CodegenDiagnosticCode;
	severity: CodegenDiagnosticSeverity;
	message: string;
	slug?: string;
	componentId?: string;
	path?: string;
};

/** A variant value or compound condition as emitted: booleans for boolean axes. */
export type CodegenConditionValue = string | boolean;

/** Classes keyed by slot key; in flat shape the only key is `root`. */
export type CodegenSlotClasses = Array<[slotKey: string, className: string]>;

export type CodegenSlot = {
	key: string;
	path: string;
	className: string;
};

export type CodegenAxis = {
	key: string;
	typeAlias: string;
	boolean: boolean;
	values: Array<{ key: string; classes: CodegenSlotClasses }>;
};

export type CodegenCompound = {
	when: Array<
		[axisKey: string, value: CodegenConditionValue | CodegenConditionValue[]]
	>;
	classes: CodegenSlotClasses;
};

export type CodegenComponentModel = {
	componentId: string;
	slug: string;
	fileName: string;
	exportName: string;
	shape: "flat" | "slots";
	/** Slot order: root, template walk order, then default children in slot order. */
	slots: CodegenSlot[];
	/** Axes in Trickroom's layering order. */
	axes: CodegenAxis[];
	compounds: CodegenCompound[];
	defaults: Array<[axisKey: string, value: CodegenConditionValue]>;
};

export type CodegenSelectionInput = {
	components: readonly SystemComponentRecord[];
	source: "published" | "draft";
	include?: readonly string[];
	exclude?: readonly string[];
};

export type SelectedComponent = {
	record: SystemComponentRecord;
	payload: SystemComponentDraftPayload;
	/** The published version the payload comes from, null for a draft. */
	publishedVersion: string | null;
};

const RESERVED_AXIS_NAMES = new Set(["class", "className", "slots", "base"]);
const ROOT_SLOT_KEY = "root";

const describeSlugs = (slugs: readonly string[]) =>
	slugs.map((slug) => `"${slug}"`).join(", ");

export function selectCodegenComponents({
	components,
	source,
	include,
	exclude,
}: CodegenSelectionInput): {
	selected: SelectedComponent[];
	diagnostics: CodegenDiagnostic[];
} {
	const diagnostics: CodegenDiagnostic[] = [];
	const knownSlugs = new Set(components.map((record) => record.slug));
	const unknownIncludes = (include ?? []).filter(
		(slug) => !knownSlugs.has(slug),
	);
	const unknownExcludes = (exclude ?? []).filter(
		(slug) => !knownSlugs.has(slug),
	);
	if (unknownIncludes.length > 0) {
		diagnostics.push({
			code: "UNKNOWN_INCLUDE_SLUG",
			severity: "error",
			message: `codegen include names unknown component slugs: ${describeSlugs(unknownIncludes)}. Use exact component slugs from the system.`,
		});
	}
	if (unknownExcludes.length > 0) {
		diagnostics.push({
			code: "UNKNOWN_EXCLUDE_SLUG",
			severity: "error",
			message: `codegen exclude names unknown component slugs: ${describeSlugs(unknownExcludes)}. Use exact component slugs from the system.`,
		});
	}

	const includeSet = include === undefined ? null : new Set(include);
	const excludeSet = new Set(exclude ?? []);
	const selected: SelectedComponent[] = [];
	for (const record of components) {
		if (includeSet && !includeSet.has(record.slug)) {
			continue;
		}
		if (excludeSet.has(record.slug)) {
			continue;
		}

		const context = { slug: record.slug, componentId: record.componentId };
		const published = record.published;
		const publishedPayload = published?.versions[published.currentVersion];
		if (published && !publishedPayload) {
			diagnostics.push({
				code: "MISSING_PUBLISHED_VERSION",
				severity: "error",
				message: `Component "${record.slug}" points at current version "${published.currentVersion}", which is not in its published versions. Republish the component.`,
				...context,
			});
			continue;
		}

		if (source === "draft" && record.draft) {
			selected.push({ record, payload: record.draft, publishedVersion: null });
			continue;
		}
		if (publishedPayload && published) {
			selected.push({
				record,
				payload: publishedPayload,
				publishedVersion: published.currentVersion,
			});
			continue;
		}

		if (source === "draft") {
			diagnostics.push({
				code: "NO_SOURCE_PAYLOAD",
				severity: includeSet ? "error" : "warning",
				message: `Component "${record.slug}" has neither a draft nor a published version; skipped.`,
				...context,
			});
		} else if (includeSet) {
			diagnostics.push({
				code: "UNPUBLISHED_COMPONENT",
				severity: "error",
				message: `Component "${record.slug}" is named in codegen include but has no published version. Publish it, generate from drafts, or remove it from include.`,
				...context,
			});
		}
	}

	return { selected, diagnostics };
}

type CollectedPart = {
	path: string;
	node: RecipeTemplateNode;
	isRoot: boolean;
	fromDefaultChildren: boolean;
};

const collectParts = (payload: SystemComponentDraftPayload) => {
	const parts: CollectedPart[] = [];
	const visit = (
		node: RecipeTemplateNode,
		fromDefaultChildren: boolean,
		isRoot: boolean,
	) => {
		parts.push({ path: node.path, node, isRoot, fromDefaultChildren });
		for (const child of node.children ?? []) {
			visit(child, fromDefaultChildren, false);
		}
	};
	visit(payload.root, false, true);
	for (const slot of Object.values(payload.slots ?? {})) {
		for (const child of slot.defaultChildren ?? []) {
			visit(child, true, false);
		}
	}
	return parts;
};

const trimmedClass = (value: string | undefined) => value?.trim() ?? "";

type AxisKind =
	| { kind: "enum" }
	| { kind: "boolean" }
	| { kind: "invalid-boolean"; reason: string };

const classifyAxis = (axis: SystemComponentVariantAxis): AxisKind => {
	const keys = Object.keys(axis.values);
	const booleanKeys = keys.filter((key) => key === "true" || key === "false");
	if (booleanKeys.length === 0) {
		return { kind: "enum" };
	}
	if (booleanKeys.length === 2 && keys.length === 2) {
		return { kind: "boolean" };
	}
	return {
		kind: "invalid-boolean",
		reason:
			booleanKeys.length === 1
				? `has "${booleanKeys[0]}" without "${booleanKeys[0] === "true" ? "false" : "true"}"`
				: "mixes true/false with other values",
	};
};

const toConditionValue = (value: string, isBoolean: boolean) =>
	isBoolean ? value === "true" : value;

export function buildCodegenComponentModel({
	record,
	payload,
	fileNamePattern,
	shape,
}: {
	record: SystemComponentRecord;
	payload: SystemComponentDraftPayload;
	fileNamePattern: string;
	shape: "auto" | "slots";
}): { model: CodegenComponentModel | null; diagnostics: CodegenDiagnostic[] } {
	const diagnostics: CodegenDiagnostic[] = [];
	const slug = record.slug;
	const report = (
		code: CodegenDiagnosticCode,
		message: string,
		path?: string,
	) => {
		diagnostics.push({
			code,
			severity: "error",
			message: `Component "${slug}": ${message}`,
			slug,
			componentId: record.componentId,
			...(path === undefined ? {} : { path }),
		});
	};

	const exportName = variantsExportName(slug);
	if (!isValidIdentifier(exportName)) {
		report(
			"INVALID_EXPORT_NAME",
			`slug produces export name "${exportName}", which is not a valid identifier. Rename the slug so it starts with a letter.`,
		);
	}

	const parts = collectParts(payload);
	const partsByPath = new Map<string, CollectedPart>();
	for (const part of parts) {
		if (partsByPath.has(part.path)) {
			report(
				"DUPLICATE_PART_PATH",
				`template path "${part.path}" appears more than once across the template and slot default children. Give every node a unique path.`,
				part.path,
			);
			continue;
		}
		partsByPath.set(part.path, part);
		if (typeof part.node.props?.className === "string") {
			report(
				"TEMPLATE_PROPS_CLASS_NAME",
				`template node "${part.path}" sets props.className, which Trickroom only uses as a fallback when no system classes exist and tv() cannot express. Move it to the node's className.`,
				part.path,
			);
		}
	}

	const axes = Object.entries(payload.variants?.axes ?? {}).sort(
		([left], [right]) => compareSystemComponentVariantAxisKeys(left, right),
	);
	const compounds = payload.variants?.compoundVariants ?? [];

	// Which parts carry classes, and from where.
	const styledPaths = new Set<string>();
	const checkTarget = (pathValue: string, className: string, where: string) => {
		const part = partsByPath.get(pathValue);
		if (!part) {
			report(
				"UNKNOWN_CLASS_TARGET",
				`${where} has classes for path "${pathValue}", which is not a node in the template. Remove the entry or retarget it.`,
				pathValue,
			);
			return;
		}
		if (part.fromDefaultChildren) {
			report(
				"DEFAULT_CHILD_CLASS_TARGET",
				`${where} has classes for slot default child "${pathValue}"; Trickroom renders default children with their static className only. Move the classes to a template node.`,
				pathValue,
			);
			return;
		}
		if (className.length > 0) {
			styledPaths.add(pathValue);
		}
	};
	for (const part of partsByPath.values()) {
		if (trimmedClass(part.node.className).length > 0) {
			styledPaths.add(part.path);
		}
	}
	for (const [axisKey, axis] of axes) {
		for (const [valueKey, value] of Object.entries(axis.values)) {
			for (const [pathValue, className] of Object.entries(
				value.classesByPath ?? {},
			)) {
				checkTarget(
					pathValue,
					trimmedClass(className),
					`variant "${axisKey}=${valueKey}"`,
				);
			}
		}
	}
	compounds.forEach((compound, index) => {
		for (const [pathValue, className] of Object.entries(
			compound.classesByPath,
		)) {
			checkTarget(
				pathValue,
				trimmedClass(className),
				`compound variant ${index + 1}`,
			);
		}
	});

	const rootPath = payload.root.path;
	const slotted =
		shape === "slots" ||
		[...styledPaths].some((pathValue) => pathValue !== rootPath);

	// Slot keys: root is always `root`; other styled parts use camelCase paths.
	const slots: CodegenSlot[] = [];
	const slotKeyByPath = new Map<string, string>();
	const pathBySlotKey = new Map<string, string>();
	for (const part of partsByPath.values()) {
		if (!part.isRoot && !(slotted && styledPaths.has(part.path))) {
			continue;
		}
		const key = part.isRoot ? ROOT_SLOT_KEY : toCamelCase(part.path);
		if (!part.isRoot) {
			if (part.path === "base" || key === "base") {
				report(
					"RESERVED_PART_PATH",
					`path "${part.path}" maps to slot key "base", which tailwind-variants reserves. Rename the node path.`,
					part.path,
				);
				continue;
			}
			if (!isValidIdentifier(key)) {
				report(
					"INVALID_PART_IDENTIFIER",
					`path "${part.path}" converts to slot key "${key}", which is not a valid identifier. Rename the node path (letters, digits, "-" or "_", starting with a letter).`,
					part.path,
				);
				continue;
			}
		}
		const existing = pathBySlotKey.get(key);
		if (existing !== undefined) {
			report(
				"PART_KEY_COLLISION",
				`paths "${existing}" and "${part.path}" both map to slot key "${key}". Rename one of the node paths.`,
				part.path,
			);
			continue;
		}
		pathBySlotKey.set(key, part.path);
		slotKeyByPath.set(part.path, key);
		slots.push({
			key,
			path: part.path,
			className: trimmedClass(part.node.className),
		});
	}

	const slotClasses = (classesByPath: Record<string, string> | undefined) =>
		slots.flatMap(({ key, path: pathValue }): CodegenSlotClasses => {
			const className = trimmedClass(classesByPath?.[pathValue]);
			return className.length > 0 ? [[key, className]] : [];
		});

	const booleanAxes = new Set<string>();
	const typeAliases = new Map<string, string>();
	const modelAxes: CodegenAxis[] = [];
	const defaults: CodegenComponentModel["defaults"] = [];
	for (const [axisKey, axis] of axes) {
		if (RESERVED_AXIS_NAMES.has(axisKey)) {
			report(
				"RESERVED_AXIS_NAME",
				`variant axis "${axisKey}" collides with a tailwind-variants option. Rename the axis.`,
			);
		}

		const typeAlias = axisTypeAliasName(slug, axisKey);
		const aliasOwner = typeAliases.get(typeAlias);
		if (!isValidIdentifier(typeAlias)) {
			report(
				"INVALID_TYPE_ALIAS",
				`variant axis "${axisKey}" produces type name "${typeAlias}", which is not a valid identifier. Rename the axis.`,
			);
		} else if (aliasOwner !== undefined) {
			report(
				"DUPLICATE_TYPE_ALIAS",
				`variant axes "${aliasOwner}" and "${axisKey}" both produce type name "${typeAlias}". Rename one of the axes.`,
			);
		}
		typeAliases.set(typeAlias, axisKey);

		const kind = classifyAxis(axis);
		const defaultValue =
			payload.variants?.defaultValues?.[axisKey] ?? axis.defaultValue;
		if (kind.kind === "invalid-boolean") {
			report(
				"INVALID_BOOLEAN_AXIS",
				`variant axis "${axisKey}" ${kind.reason}. A boolean axis needs exactly the values "true" and "false"; otherwise rename those values.`,
			);
		} else if (kind.kind === "boolean") {
			booleanAxes.add(axisKey);
			if (defaultValue === undefined) {
				report(
					"BOOLEAN_AXIS_WITHOUT_DEFAULT",
					`boolean variant axis "${axisKey}" has no default. tailwind-variants treats it as false while Trickroom leaves it unset; set a default value.`,
				);
			}
		}

		const isBoolean = kind.kind === "boolean";
		modelAxes.push({
			key: axisKey,
			typeAlias,
			boolean: isBoolean,
			values: Object.entries(axis.values).map(([valueKey, value]) => ({
				key: valueKey,
				classes: slotClasses(value.classesByPath),
			})),
		});
		if (defaultValue !== undefined) {
			defaults.push([axisKey, toConditionValue(defaultValue, isBoolean)]);
		}
	}

	const modelCompounds: CodegenCompound[] = compounds.map((compound) => ({
		when: Object.entries(compound.when).map(([axisKey, expected]) => {
			const isBoolean = booleanAxes.has(axisKey);
			return [
				axisKey,
				Array.isArray(expected)
					? expected.map((value) => toConditionValue(value, isBoolean))
					: toConditionValue(expected, isBoolean),
			];
		}),
		classes: slotClasses(compound.classesByPath),
	}));

	if (diagnostics.length > 0) {
		return { model: null, diagnostics };
	}

	return {
		model: {
			componentId: record.componentId,
			slug,
			fileName: variantsFileName(fileNamePattern, slug),
			exportName,
			shape: slotted ? "slots" : "flat",
			slots,
			axes: modelAxes,
			compounds: modelCompounds,
			defaults,
		},
		diagnostics,
	};
}
