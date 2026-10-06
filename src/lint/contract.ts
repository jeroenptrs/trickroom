import {
	DEFAULT_CODEGEN_FILE_NAME,
	DEFAULT_CODEGEN_SHAPE,
	DEFAULT_CODEGEN_TV_IMPORT,
	type ResolvedCodegenConfig,
} from "../codegen/config";
import {
	buildCodegenComponentModel,
	type CodegenConditionValue,
	type CodegenSlotClasses,
	selectCodegenComponents,
} from "../codegen/model";
import { variantsExportName, variantsFileName } from "../codegen/names";
import { buildResolvedTokenContext } from "../utils/resolved-tailwind-domain-tokens";
import { sha256Hex } from "../utils/sha256";
import { collectDesignOnlyPaths } from "../utils/system-component-design-only";
import { stableStringify } from "../utils/system-component-template-hash";
import { compareSystemComponentVariantAxisKeys } from "../utils/system-component-variant-class-layers";
import type {
	SystemComponentDraftPayload,
	SystemComponentManifest,
	SystemComponentRecord,
} from "../utils/system-components";
import {
	TAILWIND_TOKEN_DOMAINS,
	type TailwindTokenDomain,
} from "../utils/tailwind-token-domains";
import type { TailwindTokenStorage } from "../utils/tailwind-token-store";

/**
 * The system contract: everything a lint rule may check a codebase or a
 * design against, as plain data. It is built from the system manifest, the
 * component manifest and the token snapshot, never from a store, so it can
 * be serialised, hashed and handed to another process. Rules read it; the
 * filesystem adapter (`run-lint.ts`) builds it. Documented in docs/lint.md.
 */

export const SYSTEM_CONTRACT_VERSION = 1;

export type SystemContractSlot = {
	key: string;
	path: string;
	className: string;
};

export type SystemContractAxisValue = {
	key: string;
	/** Classes the value adds, per slot key. */
	classes: CodegenSlotClasses;
};

export type SystemContractAxis = {
	key: string;
	typeAlias: string;
	boolean: boolean;
	values: SystemContractAxisValue[];
	/** As emitted in `defaultVariants`; null when the axis has no default. */
	default: CodegenConditionValue | null;
	/** True when a caller has to pass the axis: no default, not boolean. */
	required: boolean;
};

export type SystemContractCompound = {
	when: Array<
		[axisKey: string, value: CodegenConditionValue | CodegenConditionValue[]]
	>;
	classes: CodegenSlotClasses;
};

/** The variant axes of one published version, as design instances record values. */
export type SystemContractVersion = {
	version: string;
	/** In codegen's axis order; values in schema order. */
	axes: Array<{ key: string; values: string[] }>;
};

/**
 * One class entry of the current published version's variants: a value of
 * an axis (`axis`, `value`) or a compound variant (`compound`, 0-based),
 * and the template path it adds classes to.
 */
export type SystemContractClassTarget = {
	axis: string | null;
	value: string | null;
	compound: number | null;
	path: string;
};

export type SystemContractComponent = {
	componentId: string;
	slug: string;
	name: string;
	/** The current published version; null when the component has none. */
	publishedVersion: string | null;
	/** Output file name from the codegen pattern (relative to `outDir`). */
	fileName: string;
	exportName: string;
	/** Null when the component is unpublished or its codegen model is invalid. */
	shape: "flat" | "slots" | null;
	slots: SystemContractSlot[];
	axes: SystemContractAxis[];
	compounds: SystemContractCompound[];
	/** Template paths marked design-only, descendants included. */
	designOnlyPaths: string[];
	/**
	 * Every published version with its variant axes, sorted by version, read
	 * from the schema rather than the codegen model so design-only and
	 * invalid components keep theirs. Design instances pinned to an older
	 * version are checked against the version they use.
	 */
	versions: SystemContractVersion[];
	/** Variant and compound class entries of the current published version. */
	classTargets: SystemContractClassTarget[];
	codegen: {
		/** Selected by the codegen include/exclude lists and has a valid model. */
		selected: boolean;
		/** Codegen diagnostics for this component, as messages. */
		issues: string[];
	};
};

export type SystemContractTokens = {
	/** Resolved token names per domain (defaults minus removed, plus added). */
	domains: Record<TailwindTokenDomain, string[]>;
	/** Custom `@utility` roots the system CSS defines. */
	customUtilities: Array<{ root: string; kind: "functional" | "static" }>;
	/** Null when the system has no stored token snapshot. */
	snapshot: { syncedAt: string; reviewRequired: boolean } | null;
};

export type SystemContract = {
	version: typeof SYSTEM_CONTRACT_VERSION;
	system: { id: string; name: string; cssPath: string | null };
	codegen: {
		configured: boolean;
		/** Relative to the project root, `/` separators; null when unconfigured. */
		outDir: string | null;
		fileName: string;
		tvImport: string;
		shape: "auto" | "slots";
	};
	/** Sorted by slug. */
	components: SystemContractComponent[];
	tokens: SystemContractTokens;
	/** `sha256:` over every other field, so a report can name what it checked. */
	hash: string;
};

export type BuildSystemContractInput = {
	system: { id: string; name: string; cssPath?: string | null };
	manifest: SystemComponentManifest;
	tokens: TailwindTokenStorage | null;
	codegen: ResolvedCodegenConfig;
};

const compareSlugs = (
	left: SystemComponentRecord,
	right: SystemComponentRecord,
) => (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0);

const compareVersions = (left: string, right: string) =>
	left.localeCompare(right, "en", { numeric: true });

const buildVersions = (
	record: SystemComponentRecord,
): SystemContractVersion[] =>
	Object.entries(record.published?.versions ?? {})
		.sort(([left], [right]) => compareVersions(left, right))
		.map(([version, payload]) => ({
			version,
			axes: Object.entries(payload.variants?.axes ?? {})
				.sort(([left], [right]) =>
					compareSystemComponentVariantAxisKeys(left, right),
				)
				.map(([key, axis]) => ({ key, values: Object.keys(axis.values) })),
		}));

const buildClassTargets = (
	payload: SystemComponentDraftPayload,
): SystemContractClassTarget[] => {
	const targets: SystemContractClassTarget[] = [];
	for (const [axis, entry] of Object.entries(payload.variants?.axes ?? {}).sort(
		([left], [right]) => compareSystemComponentVariantAxisKeys(left, right),
	)) {
		for (const [value, valueEntry] of Object.entries(entry.values)) {
			for (const path of Object.keys(valueEntry.classesByPath ?? {})) {
				targets.push({ axis, value, compound: null, path });
			}
		}
	}
	(payload.variants?.compoundVariants ?? []).forEach((compound, index) => {
		for (const path of Object.keys(compound.classesByPath)) {
			targets.push({ axis: null, value: null, compound: index, path });
		}
	});
	return targets;
};

const buildComponent = (
	record: SystemComponentRecord,
	options: {
		fileNamePattern: string;
		shape: "auto" | "slots";
		selectedIds: ReadonlySet<string>;
		selectionIssues: readonly string[];
	},
): SystemContractComponent => {
	const published = record.published;
	const payload = published?.versions[published.currentVersion] ?? null;
	const base = {
		componentId: record.componentId,
		slug: record.slug,
		name: record.name,
		publishedVersion: payload ? (published?.currentVersion ?? null) : null,
		fileName: variantsFileName(options.fileNamePattern, record.slug),
		exportName: variantsExportName(record.slug),
	};
	if (!payload) {
		return {
			...base,
			shape: null,
			slots: [],
			axes: [],
			compounds: [],
			designOnlyPaths: [],
			versions: [],
			classTargets: [],
			codegen: { selected: false, issues: [...options.selectionIssues] },
		};
	}

	const built = buildCodegenComponentModel({
		record,
		payload,
		fileNamePattern: options.fileNamePattern,
		shape: options.shape,
	});
	const issues = [
		...options.selectionIssues,
		...built.diagnostics.map((diagnostic) => diagnostic.message),
	];
	const designOnlyPaths = [...collectDesignOnlyPaths(payload)].sort();
	const versions = buildVersions(record);
	const classTargets = buildClassTargets(payload);
	if (!built.model) {
		return {
			...base,
			shape: null,
			slots: [],
			axes: [],
			compounds: [],
			designOnlyPaths,
			versions,
			classTargets,
			codegen: { selected: false, issues },
		};
	}

	const defaults = new Map(built.model.defaults);
	return {
		...base,
		shape: built.model.shape,
		slots: built.model.slots.map((slot) => ({ ...slot })),
		axes: built.model.axes.map((axis) => {
			const defaultValue = defaults.get(axis.key) ?? null;
			return {
				key: axis.key,
				typeAlias: axis.typeAlias,
				boolean: axis.boolean,
				values: axis.values.map((value) => ({
					key: value.key,
					classes: value.classes.map(([slot, className]) => [slot, className]),
				})),
				default: defaultValue,
				required: defaultValue === null && !axis.boolean,
			};
		}),
		compounds: built.model.compounds.map((compound) => ({
			when: compound.when.map(([axisKey, value]) => [
				axisKey,
				Array.isArray(value) ? [...value] : value,
			]),
			classes: compound.classes.map(([slot, className]) => [slot, className]),
		})),
		designOnlyPaths,
		versions,
		classTargets,
		codegen: {
			selected: options.selectedIds.has(record.componentId),
			issues,
		},
	};
};

const buildTokens = (
	tokens: TailwindTokenStorage | null,
): SystemContractTokens => {
	const domains = {} as Record<TailwindTokenDomain, string[]>;
	if (!tokens) {
		for (const domain of TAILWIND_TOKEN_DOMAINS) {
			domains[domain] = [];
		}
		return { domains, customUtilities: [], snapshot: null };
	}
	const resolved = buildResolvedTokenContext(tokens);
	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		domains[domain] = [...resolved[domain]].sort();
	}
	return {
		domains,
		customUtilities: [...tokens.customUtilities]
			.map((utility) => ({ root: utility.root, kind: utility.kind }))
			.sort((left, right) => left.root.localeCompare(right.root)),
		snapshot: {
			syncedAt: tokens.metadata.syncedAt,
			reviewRequired: tokens.metadata.reviewRequired,
		},
	};
};

export const hashSystemContract = (
	contract: Omit<SystemContract, "hash">,
): string => `sha256:${sha256Hex(stableStringify(contract))}`;

/**
 * The contract of one system. Components always come from their published
 * version (drafts are not linted). The codegen model (slots, axes, shape)
 * is built with `src/codegen/model.ts`, so a rule sees exactly what the
 * generated file contains; without a `codegen` block the defaults apply
 * (`{slug}.variants.ts`, shape auto) and `codegen.configured` is false.
 */
export function buildSystemContract(
	input: BuildSystemContractInput,
): SystemContract {
	const codegen = input.codegen;
	const configured = codegen.status === "configured";
	const fileNamePattern = configured
		? codegen.fileName
		: DEFAULT_CODEGEN_FILE_NAME;
	const shape = configured ? codegen.shape : DEFAULT_CODEGEN_SHAPE;
	const records = Object.values(input.manifest.components).sort(compareSlugs);

	const selection = selectCodegenComponents({
		components: records,
		source: "published",
		include: configured ? (codegen.include ?? undefined) : undefined,
		exclude: configured ? codegen.exclude : undefined,
	});
	const selectedIds = new Set(
		selection.selected.map((entry) => entry.record.componentId),
	);
	const issuesByComponent = new Map<string, string[]>();
	const globalIssues: string[] = [];
	for (const diagnostic of selection.diagnostics) {
		if (diagnostic.componentId) {
			const list = issuesByComponent.get(diagnostic.componentId) ?? [];
			list.push(diagnostic.message);
			issuesByComponent.set(diagnostic.componentId, list);
		} else {
			globalIssues.push(diagnostic.message);
		}
	}

	const contract: Omit<SystemContract, "hash"> = {
		version: SYSTEM_CONTRACT_VERSION,
		system: {
			id: input.system.id,
			name: input.system.name,
			cssPath: input.system.cssPath ?? null,
		},
		codegen: {
			configured,
			outDir: configured ? codegen.outDir.split("\\").join("/") : null,
			fileName: fileNamePattern,
			tvImport: configured ? codegen.tvImport : DEFAULT_CODEGEN_TV_IMPORT,
			shape,
		},
		components: records.map((record) =>
			buildComponent(record, {
				fileNamePattern,
				shape,
				selectedIds,
				selectionIssues: [
					...globalIssues,
					...(issuesByComponent.get(record.componentId) ?? []),
				],
			}),
		),
		tokens: buildTokens(input.tokens),
	};
	return { ...contract, hash: hashSystemContract(contract) };
}

export const findContractComponent = (
	contract: SystemContract,
	ref: { slug?: string; componentId?: string },
): SystemContractComponent | null =>
	contract.components.find(
		(component) =>
			(ref.componentId !== undefined &&
				component.componentId === ref.componentId) ||
			(ref.slug !== undefined && component.slug === ref.slug),
	) ?? null;
