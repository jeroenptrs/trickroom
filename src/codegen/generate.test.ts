import { twMerge } from "tailwind-merge";
// biome-ignore lint/style/noRestrictedImports: evaluates generated tv() configs to prove them equivalent to Trickroom's resolver
import { tv } from "tailwind-variants";
import { describe, expect, it } from "vitest";
import type { RecipeTemplateNode } from "../types";
import { flattenClassLayers } from "../utils/class-layers";
import {
	resolveSystemComponentClassLayers,
	resolveSystemComponentVariantValues,
} from "../utils/system-component-resolution";
import { compareSystemComponentVariantAxisKeys } from "../utils/system-component-variant-class-layers";
import {
	createEmptySystemComponentManifest,
	type PublishedSystemComponentVersion,
	SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
	type SystemComponentDraftPayload,
	type SystemComponentManifest,
	type SystemComponentRecord,
	type SystemComponentVariantSchema,
} from "../utils/system-components";
import {
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
} from "../utils/system-components-validation";
import {
	type GeneratedVariantsFile,
	type GenerateVariantsInput,
	generateVariantsFiles,
	parseCodegenHeader,
} from "./generate";
import { hashCodegenSource } from "./header";
import { toCamelCase, toPascalCase } from "./names";

let componentCounter = 0;

const node = (
	path: string,
	className?: string,
	children?: RecipeTemplateNode[],
): RecipeTemplateNode => ({
	path,
	library: "trickroom",
	component: "container",
	...(className === undefined ? {} : { className }),
	...(children === undefined ? {} : { children }),
});

const publishedRecord = (
	slug: string,
	payload: SystemComponentDraftPayload,
	options: { version?: string; draft?: SystemComponentDraftPayload } = {},
): SystemComponentRecord => {
	componentCounter += 1;
	const version = options.version ?? "1";
	return {
		componentId: `cmp_${String(componentCounter).padStart(8, "0")}-0000-4000-8000-000000000000`,
		slug,
		name: slug,
		createdAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
		updatedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
		...(options.draft ? { draft: options.draft } : {}),
		published: {
			currentVersion: version,
			versions: {
				[version]: {
					...payload,
					version,
					publishedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
					templateHash: hashSystemComponentTemplate(payload),
					variantSchemaHash: hashSystemComponentVariantSchema(payload.variants),
				},
			},
		},
	};
};

const draftOnlyRecord = (
	slug: string,
	draft?: SystemComponentDraftPayload,
): SystemComponentRecord => {
	componentCounter += 1;
	return {
		componentId: `cmp_${String(componentCounter).padStart(8, "0")}-0000-4000-8000-000000000000`,
		slug,
		name: slug,
		createdAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
		updatedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
		...(draft ? { draft } : {}),
	};
};

const manifestOf = (
	...records: SystemComponentRecord[]
): SystemComponentManifest => ({
	...createEmptySystemComponentManifest(),
	components: Object.fromEntries(
		records.map((record) => [record.componentId, record]),
	),
});

const generate = (
	records: SystemComponentRecord[],
	options: Omit<GenerateVariantsInput, "manifest" | "systemId"> = {},
) =>
	generateVariantsFiles({
		manifest: manifestOf(...records),
		systemId: "sys_test",
		...options,
	});

const generateOne = (
	record: SystemComponentRecord,
	options: Omit<GenerateVariantsInput, "manifest" | "systemId"> = {},
) => {
	const result = generate([record], options);
	expect(result.diagnostics).toEqual([]);
	expect(result.files).toHaveLength(1);
	return result.files[0];
};

const diagnosticCodes = (
	records: SystemComponentRecord[],
	options: Omit<GenerateVariantsInput, "manifest" | "systemId"> = {},
) => {
	const result = generate(records, options);
	return {
		codes: result.diagnostics.map((diagnostic) => diagnostic.code),
		result,
	};
};

/** Evaluates the generated module text with the real `tv`, no files written. */
const evaluateVariantsFile = (file: GeneratedVariantsFile) => {
	const body = file.contents
		.split("\n")
		.filter(
			(line) =>
				!line.startsWith("//") &&
				!line.startsWith("import ") &&
				!line.startsWith("export type "),
		)
		.join("\n")
		.replace(`export const ${file.exportName} = `, "return ");
	return new Function("tv", body)(tv) as (
		props?: Record<string, unknown>,
	) => string & Record<string, () => string>;
};

// Two axes declared out of layering order whose classes conflict on two parts,
// compounds over both, a boolean axis and a styled default child.
const precedencePayload = (): SystemComponentDraftPayload => ({
	root: node("root", "flex p-0 text-xs", [
		node("light-label", "font-bold text-base"),
		node("icon"),
	]),
	slots: {
		default: {
			name: "default",
			hostPath: "root",
			defaultChildren: [node("placeholder", "opacity-50 p-1")],
		},
	},
	variants: {
		axes: {
			tone: {
				label: "Tone",
				defaultValue: "neutral",
				values: {
					neutral: { classesByPath: { root: "p-8 bg-zinc-100" } },
					brand: {
						classesByPath: {
							root: "p-6 bg-blue-500",
							"light-label": "text-lg",
						},
					},
				},
			},
			size: {
				label: "Size",
				defaultValue: "md",
				values: {
					sm: { classesByPath: { root: "p-2", "light-label": "text-sm" } },
					md: { classesByPath: { root: "p-4" } },
					lg: { classesByPath: { root: "p-5 text-lg" } },
				},
			},
			disabled: {
				label: "Disabled",
				defaultValue: "false",
				values: {
					true: { classesByPath: { root: "opacity-50 p-3" } },
					false: {},
				},
			},
			emphasis: {
				label: "Emphasis",
				values: {
					loud: { classesByPath: { "light-label": "text-xl font-black" } },
					quiet: {},
				},
			},
		},
		compoundVariants: [
			{
				when: { size: "sm", disabled: "false" },
				classesByPath: { root: "p-1", "light-label": "text-xs" },
			},
			{
				when: { tone: ["brand", "neutral"], emphasis: "loud" },
				classesByPath: { root: "bg-red-500" },
			},
			{
				when: { disabled: ["true"], size: "lg" },
				classesByPath: { root: "p-7", icon: "size-6" },
			},
		],
	},
});

// Flat: root-only classes, with conflicting axes and a boolean compound.
const flatPayload = (): SystemComponentDraftPayload => ({
	root: node("root", "inline-flex px-2", [node("label")]),
	variants: {
		axes: {
			variant: {
				label: "Variant",
				defaultValue: "primary",
				values: {
					primary: { classesByPath: { root: "bg-blue-500 px-4" } },
					ghost: { classesByPath: { root: "bg-transparent" } },
				},
			},
			iconOnly: {
				label: "Icon only",
				defaultValue: "false",
				values: { false: {}, true: {} },
			},
			density: {
				label: "Density",
				defaultValue: "compact",
				values: {
					compact: { classesByPath: { root: "px-1 h-6" } },
					comfy: { classesByPath: { root: "h-10" } },
				},
			},
		},
		compoundVariants: [
			{
				when: { iconOnly: "true", density: "compact" },
				classesByPath: { root: "size-6 px-0" },
			},
			{ when: { iconOnly: "false" }, classesByPath: { root: "gap-2" } },
		],
	},
});

const variantSelections = (
	variants: SystemComponentVariantSchema | undefined,
) => {
	let selections: Array<Record<string, string>> = [{}];
	for (const [axisKey, axis] of Object.entries(variants?.axes ?? {})) {
		selections = selections.flatMap((selection) => [
			selection,
			...Object.keys(axis.values).map((valueKey) => ({
				...selection,
				[axisKey]: valueKey,
			})),
		]);
	}
	return selections;
};

const collectNodes = (payload: SystemComponentDraftPayload) => {
	const nodes = new Map<
		string,
		{ node: RecipeTemplateNode; isDefaultChild: boolean }
	>();
	const visit = (current: RecipeTemplateNode, isDefaultChild: boolean) => {
		nodes.set(current.path, { node: current, isDefaultChild });
		for (const child of current.children ?? []) {
			visit(child, isDefaultChild);
		}
	};
	visit(payload.root, false);
	for (const slot of Object.values(payload.slots ?? {})) {
		for (const child of slot.defaultChildren ?? []) {
			visit(child, true);
		}
	}
	return nodes;
};

/** Trickroom's own class output for `path`, merged like tailwind-variants merges. */
const trickroomClassName = (
	version: PublishedSystemComponentVersion,
	path: string,
	selection: Record<string, string>,
) => {
	const entry = collectNodes(version).get(path);
	if (!entry) {
		throw new Error(`No node at ${path}`);
	}
	if (entry.isDefaultChild) {
		return twMerge(entry.node.className ?? "");
	}
	const resolved = resolveSystemComponentVariantValues(
		version.variants,
		selection,
	);
	return twMerge(
		flattenClassLayers(
			resolveSystemComponentClassLayers(
				version,
				path,
				entry.node.className,
				resolved,
			),
		) ?? "",
	);
};

const expectEquivalentToTrickroom = (
	record: SystemComponentRecord,
	shape: "auto" | "slots",
) => {
	const file = generateOne(record, { shape });
	const variants = evaluateVariantsFile(file);
	const version = record.published?.versions[record.published.currentVersion];
	if (!version) {
		throw new Error("Expected a published fixture");
	}
	const booleanAxes = new Set(
		file.model.axes.filter((axis) => axis.boolean).map((axis) => axis.key),
	);
	const allPaths = [...collectNodes(version).keys()];
	let comparisons = 0;
	for (const selection of variantSelections(version.variants)) {
		const props = Object.fromEntries(
			Object.entries(selection).map(([axisKey, value]) => [
				axisKey,
				booleanAxes.has(axisKey) ? value === "true" : value,
			]),
		);
		const output = variants(props);
		for (const path of allPaths) {
			const slot = file.model.slots.find((entry) => entry.path === path);
			const generated = !slot
				? ""
				: file.shape === "flat"
					? output
					: output[slot.key]();
			expect(twMerge(generated), `${path} ${JSON.stringify(selection)}`).toBe(
				trickroomClassName(version, path, selection),
			);
			comparisons += 1;
		}
	}
	return { file, comparisons };
};

describe("generateVariantsFiles", () => {
	describe("equivalence with Trickroom's resolver", () => {
		it("matches every variant combination of a multi-part component", () => {
			const { file, comparisons } = expectEquivalentToTrickroom(
				publishedRecord("precedence-card", precedencePayload()),
				"auto",
			);
			expect(file.shape).toBe("slots");
			// 3 * 4 * 3 * 3 selections (each axis set or omitted) over 4 nodes.
			expect(comparisons).toBe(108 * 4);
		});

		it("matches every variant combination of a flat component", () => {
			const { file } = expectEquivalentToTrickroom(
				publishedRecord("flat-button", flatPayload()),
				"auto",
			);
			expect(file.shape).toBe("flat");
		});

		it("matches when a flat component is forced into slots", () => {
			const { file } = expectEquivalentToTrickroom(
				publishedRecord("flat-button", flatPayload()),
				"slots",
			);
			expect(file.shape).toBe("slots");
		});

		it("would diverge if axes were emitted in manifest order", () => {
			const file = generateOne(
				publishedRecord("precedence-card", precedencePayload()),
			);
			const manifestOrder = file.contents.replace(
				/\t\tsize: \{[\s\S]*?\n\t\t\},\n(\t\ttone: \{[\s\S]*?\n\t\t\},\n)/u,
				(match, tone: string) => `${tone}${match.slice(0, -tone.length)}`,
			);
			expect(manifestOrder).not.toBe(file.contents);
			const reordered = evaluateVariantsFile({
				...file,
				contents: manifestOrder,
			});
			const original = evaluateVariantsFile(file);
			const props = { tone: "brand", size: "sm", disabled: true };
			expect(twMerge(original(props).root())).toContain("p-6");
			expect(twMerge(reordered(props).root())).not.toBe(
				twMerge(original(props).root()),
			);
		});

		it("orders axes with the resolver's comparator", () => {
			const file = generateOne(
				publishedRecord("precedence-card", precedencePayload()),
			);
			const axisKeys = Object.keys(precedencePayload().variants?.axes ?? {});
			expect(file.model.axes.map((axis) => axis.key)).toEqual(
				[...axisKeys].sort(compareSystemComponentVariantAxisKeys),
			);
			expect(file.model.axes.map((axis) => axis.key)).toEqual(
				Object.keys(
					resolveSystemComponentVariantValues(precedencePayload().variants, {
						emphasis: "loud",
					}),
				),
			);
		});
	});

	describe("shape", () => {
		it("emits the flat form when only root carries classes", () => {
			const file = generateOne(publishedRecord("flat-button", flatPayload()));
			expect(file.shape).toBe("flat");
			const [comment, header] = file.contents.split("\n");
			expect(comment).toBe("// Generated by Trickroom. Do not edit.");
			expect(header).toBe(
				`// trickroom-codegen: {"version":1,"systemId":"sys_test","componentId":"${file.header.componentId}","slug":"flat-button","source":"published","publishedVersion":"1","templateHash":"${file.header.templateHash}","variantSchemaHash":"${file.header.variantSchemaHash}","sourceHash":"${file.header.sourceHash}"}`,
			);
			expect(
				file.contents.split("\n").slice(2).join("\n"),
			).toMatchInlineSnapshot(`
				"
				import { tv } from "./tv";

				export const flatButtonVariants = tv({
					base: "inline-flex px-2",
					variants: {
						density: {
							compact: "px-1 h-6",
							comfy: "h-10",
						},
						iconOnly: {
							false: "",
							true: "",
						},
						variant: {
							primary: "bg-blue-500 px-4",
							ghost: "bg-transparent",
						},
					},
					compoundVariants: [
						{
							iconOnly: true,
							density: "compact",
							class: "size-6 px-0",
						},
						{
							iconOnly: false,
							class: "gap-2",
						},
					],
					defaultVariants: {
						density: "compact",
						iconOnly: false,
						variant: "primary",
					},
				});

				export type FlatButtonDensity = "compact" | "comfy";
				export type FlatButtonIconOnly = boolean;
				export type FlatButtonVariant = "primary" | "ghost";
				"
			`);
		});

		it("emits the slotted form when a non-root part carries classes", () => {
			const file = generateOne(
				publishedRecord("precedence-card", precedencePayload()),
				{ tvImport: "@/lib/tv" },
			);
			expect(file.shape).toBe("slots");
			expect(
				file.contents.split("\n").slice(2).join("\n"),
			).toMatchInlineSnapshot(`
				"
				import { tv } from "@/lib/tv";

				export const precedenceCardVariants = tv({
					slots: {
						root: "flex p-0 text-xs",
						lightLabel: "font-bold text-base",
						icon: "",
						placeholder: "opacity-50 p-1",
					},
					variants: {
						disabled: {
							true: {
								root: "opacity-50 p-3",
							},
							false: {},
						},
						emphasis: {
							loud: {
								lightLabel: "text-xl font-black",
							},
							quiet: {},
						},
						size: {
							sm: {
								root: "p-2",
								lightLabel: "text-sm",
							},
							md: {
								root: "p-4",
							},
							lg: {
								root: "p-5 text-lg",
							},
						},
						tone: {
							neutral: {
								root: "p-8 bg-zinc-100",
							},
							brand: {
								root: "p-6 bg-blue-500",
								lightLabel: "text-lg",
							},
						},
					},
					compoundVariants: [
						{
							size: "sm",
							disabled: false,
							class: {
								root: "p-1",
								lightLabel: "text-xs",
							},
						},
						{
							tone: ["brand", "neutral"],
							emphasis: "loud",
							class: {
								root: "bg-red-500",
							},
						},
						{
							disabled: [true],
							size: "lg",
							class: {
								root: "p-7",
								icon: "size-6",
							},
						},
					],
					defaultVariants: {
						disabled: false,
						size: "md",
						tone: "neutral",
					},
				});

				export type PrecedenceCardDisabled = boolean;
				export type PrecedenceCardEmphasis = "loud" | "quiet";
				export type PrecedenceCardSize = "sm" | "md" | "lg";
				export type PrecedenceCardTone = "neutral" | "brand";
				"
			`);
		});

		it("switches to slots when only a default child is styled", () => {
			const file = generateOne(
				publishedRecord("with-placeholder", {
					root: node("root", "flex"),
					slots: {
						body: {
							name: "body",
							hostPath: "root",
							defaultChildren: [
								node("empty-state", "", [node("hint", "text-muted")]),
							],
						},
					},
				}),
			);
			expect(file.shape).toBe("slots");
			expect(file.model.slots.map((slot) => slot.key)).toEqual([
				"root",
				"hint",
			]);
		});

		it("emits an empty tv() for a component with no classes", () => {
			const file = generateOne(
				publishedRecord("bare", { root: node("root", "  ", [node("child")]) }),
			);
			expect(file.shape).toBe("flat");
			expect(file.contents).toContain("export const bareVariants = tv({});\n");
			expect(file.contents.endsWith("tv({});\n")).toBe(true);
			// tailwind-variants returns undefined when no class applies.
			expect(evaluateVariantsFile(file)()).toBeUndefined();
		});

		it("keeps axes without classes in a component with no classes", () => {
			const file = generateOne(
				publishedRecord("bare", {
					root: node("root"),
					variants: {
						axes: {
							open: {
								label: "Open",
								defaultValue: "true",
								values: { true: {}, false: {} },
							},
						},
					},
				}),
				{ shape: "slots" },
			);
			expect(file.contents).toContain(
				'\tslots: {\n\t\troot: "",\n\t},\n\tvariants: {\n\t\topen: {\n\t\t\ttrue: {},\n\t\t\tfalse: {},\n\t\t},\n\t},\n\tdefaultVariants: {\n\t\topen: true,\n\t},',
			);
		});

		it("names the root slot root whatever its path", () => {
			const file = generateOne(
				publishedRecord("card", {
					root: node("card-shell", "border", [node("card_title", "font-bold")]),
				}),
			);
			expect(file.model.slots).toEqual([
				{ key: "root", path: "card-shell", className: "border" },
				{ key: "cardTitle", path: "card_title", className: "font-bold" },
			]);
		});
	});

	describe("axes and values", () => {
		it("keeps value order and verbatim, trimmed class strings", () => {
			const file = generateOne(
				publishedRecord("chip", {
					root: node("root"),
					variants: {
						axes: {
							size: {
								label: "Size",
								defaultValue: "z",
								values: {
									z: { classesByPath: { root: "  p-2 p-2   m-1 " } },
									a: { classesByPath: { root: "p-4" } },
								},
							},
						},
					},
				}),
			);
			expect(file.contents).toContain(
				'\t\t\tz: "p-2 p-2   m-1",\n\t\t\ta: "p-4",',
			);
			expect(file.contents).toContain('export type ChipSize = "z" | "a";');
		});

		it("omits defaults for an optional axis and quotes non-identifier keys", () => {
			const file = generateOne(
				publishedRecord("title-text", {
					root: node("root", "font-bold"),
					variants: {
						axes: {
							variant: {
								label: "Variant",
								values: {
									"2xl": { classesByPath: { root: "text-2xl" } },
									"display-sm": { classesByPath: { root: "text-sm" } },
								},
							},
						},
					},
				}),
			);
			expect(file.contents).not.toContain("defaultVariants");
			expect(file.contents).not.toContain("compoundVariants");
			expect(file.contents).toContain(
				'\t\t\t"2xl": "text-2xl",\n\t\t\t"display-sm": "text-sm",',
			);
			expect(evaluateVariantsFile(file)()).toBe("font-bold");
		});

		it("prefers schema defaultValues over an axis defaultValue", () => {
			const file = generateOne(
				publishedRecord("chip", {
					root: node("root", "flex"),
					variants: {
						axes: {
							size: {
								label: "Size",
								defaultValue: "sm",
								values: { sm: {}, lg: {} },
							},
						},
						defaultValues: { size: "lg" },
					},
				}),
			);
			expect(file.model.defaults).toEqual([["size", "lg"]]);
		});

		it("emits booleans in defaults and scalar and array compound conditions", () => {
			const file = generateOne(
				publishedRecord("precedence-card", precedencePayload()),
			);
			expect(file.model.defaults).toContainEqual(["disabled", false]);
			expect(file.model.compounds.map((compound) => compound.when)).toEqual([
				[
					["size", "sm"],
					["disabled", false],
				],
				[
					["tone", ["brand", "neutral"]],
					["emphasis", "loud"],
				],
				[
					["disabled", [true]],
					["size", "lg"],
				],
			]);
		});
	});

	describe("diagnostics", () => {
		const expectError = (
			record: SystemComponentRecord,
			code: string,
			path?: string,
		) => {
			const { result } = diagnosticCodes([
				record,
				publishedRecord("ok", flatPayload()),
			]);
			expect(result.files).toEqual([]);
			const diagnostic = result.diagnostics.find(
				(entry) => entry.code === code,
			);
			expect(diagnostic, JSON.stringify(result.diagnostics)).toMatchObject({
				severity: "error",
				slug: record.slug,
				componentId: record.componentId,
				...(path === undefined ? {} : { path }),
			});
			expect(diagnostic?.message).toContain(`"${record.slug}"`);
		};

		it("rejects a boolean axis without a default", () => {
			expectError(
				publishedRecord("toggle", {
					root: node("root"),
					variants: {
						axes: { on: { label: "On", values: { true: {}, false: {} } } },
					},
				}),
				"BOOLEAN_AXIS_WITHOUT_DEFAULT",
			);
		});

		it("rejects half-boolean and mixed boolean axes", () => {
			expectError(
				publishedRecord("toggle", {
					root: node("root"),
					variants: {
						axes: {
							on: { label: "On", defaultValue: "true", values: { true: {} } },
						},
					},
				}),
				"INVALID_BOOLEAN_AXIS",
			);
			expectError(
				publishedRecord("toggle", {
					root: node("root"),
					variants: {
						axes: {
							on: {
								label: "On",
								defaultValue: "true",
								values: { true: {}, false: {}, mixed: {} },
							},
						},
					},
				}),
				"INVALID_BOOLEAN_AXIS",
			);
		});

		it("rejects reserved axis names", () => {
			for (const axisKey of ["class", "className", "slots", "base"]) {
				expectError(
					publishedRecord("chip", {
						root: node("root"),
						variants: {
							axes: {
								[axisKey]: {
									label: axisKey,
									defaultValue: "a",
									values: { a: {} },
								},
							},
						},
					}),
					"RESERVED_AXIS_NAME",
				);
			}
		});

		it("rejects duplicate paths across the template and default children", () => {
			expectError(
				publishedRecord("card", {
					root: node("root", "flex", [node("body")]),
					slots: {
						main: {
							name: "main",
							hostPath: "body",
							defaultChildren: [node("body")],
						},
					},
				}),
				"DUPLICATE_PART_PATH",
				"body",
			);
		});

		it("rejects styled paths that collide after camelCase", () => {
			expectError(
				publishedRecord("card", {
					root: node("root", "", [
						node("item-text", "a"),
						node("itemText", "b"),
					]),
				}),
				"PART_KEY_COLLISION",
				"itemText",
			);
		});

		it("rejects a styled part path of base and invalid identifiers", () => {
			expectError(
				publishedRecord("card", {
					root: node("root", "", [node("base", "p-1")]),
				}),
				"RESERVED_PART_PATH",
				"base",
			);
			expectError(
				publishedRecord("card", {
					root: node("root", "", [node("1st-cell", "p-1")]),
				}),
				"INVALID_PART_IDENTIFIER",
				"1st-cell",
			);
		});

		it("rejects class targets that name no part or a default child", () => {
			expectError(
				publishedRecord("card", {
					root: node("root"),
					variants: {
						axes: {
							size: {
								label: "Size",
								defaultValue: "sm",
								values: { sm: { classesByPath: { ghost: "p-1" } } },
							},
						},
					},
				}),
				"UNKNOWN_CLASS_TARGET",
				"ghost",
			);
			expectError(
				publishedRecord("card", {
					root: node("root"),
					slots: {
						main: {
							name: "main",
							hostPath: "root",
							defaultChildren: [node("hint")],
						},
					},
					variants: {
						axes: {
							size: { label: "Size", defaultValue: "sm", values: { sm: {} } },
						},
						compoundVariants: [
							{ when: { size: "sm" }, classesByPath: { hint: "p-1" } },
						],
					},
				}),
				"DEFAULT_CHILD_CLASS_TARGET",
				"hint",
			);
		});

		it("rejects a template node with props.className", () => {
			expectError(
				publishedRecord("card", {
					root: { ...node("root"), props: { className: "p-2" } },
				}),
				"TEMPLATE_PROPS_CLASS_NAME",
				"root",
			);
		});

		it("rejects slugs that do not produce a valid export name", () => {
			expectError(
				publishedRecord("2-col", { root: node("root") }),
				"INVALID_EXPORT_NAME",
			);
		});

		it("rejects axes that produce the same type name", () => {
			expectError(
				publishedRecord("chip", {
					root: node("root"),
					variants: {
						axes: {
							"icon-only": { label: "a", defaultValue: "a", values: { a: {} } },
							iconOnly: { label: "b", defaultValue: "a", values: { a: {} } },
						},
					},
				}),
				"DUPLICATE_TYPE_ALIAS",
			);
		});

		it("rejects duplicate file and export names across the selection", () => {
			const first = publishedRecord("chip", { root: node("root") });
			const second = publishedRecord("chip", { root: node("root") });
			const { codes, result } = diagnosticCodes([first, second]);
			expect(codes).toEqual(["DUPLICATE_FILE_NAME", "DUPLICATE_EXPORT_NAME"]);
			expect(result.files).toEqual([]);

			const fixedName = diagnosticCodes(
				[
					publishedRecord("chip", { root: node("root") }),
					publishedRecord("tag", { root: node("root") }),
				],
				{ fileName: "variants.ts" },
			);
			expect(fixedName.codes).toEqual(["DUPLICATE_FILE_NAME"]);
		});

		it("rejects a published state without its current version", () => {
			const record = publishedRecord("chip", { root: node("root") });
			if (record.published) {
				record.published.currentVersion = "9";
			}
			expectError(record, "MISSING_PUBLISHED_VERSION");
		});
	});

	describe("selection", () => {
		const records = () => [
			publishedRecord("alpha", { root: node("root") }),
			publishedRecord("beta", { root: node("root") }),
			draftOnlyRecord("gamma", { root: node("root", "draft-only") }),
			draftOnlyRecord("delta"),
		];
		const slugs = (files: GeneratedVariantsFile[]) =>
			files.map((file) => file.header.slug);

		it("generates every published component by default and skips the rest silently", () => {
			const result = generate(records());
			expect(result.diagnostics).toEqual([]);
			expect(slugs(result.files)).toEqual(["alpha", "beta"]);
		});

		it("applies include and exclude by exact slug, exclude winning", () => {
			expect(slugs(generate(records(), { include: ["beta"] }).files)).toEqual([
				"beta",
			]);
			expect(slugs(generate(records(), { exclude: ["alpha"] }).files)).toEqual([
				"beta",
			]);
			expect(
				slugs(
					generate(records(), {
						include: ["alpha", "beta"],
						exclude: ["alpha"],
					}).files,
				),
			).toEqual(["beta"]);
		});

		it("rejects unknown include and exclude slugs", () => {
			expect(diagnosticCodes(records(), { include: ["alph"] }).codes).toEqual([
				"UNKNOWN_INCLUDE_SLUG",
			]);
			const unknownExclude = diagnosticCodes(records(), { exclude: ["zeta"] });
			expect(unknownExclude.codes).toEqual(["UNKNOWN_EXCLUDE_SLUG"]);
			expect(unknownExclude.result.files).toEqual([]);
		});

		it("rejects an included unpublished component", () => {
			const { codes, result } = diagnosticCodes(records(), {
				include: ["gamma"],
			});
			expect(codes).toEqual(["UNPUBLISHED_COMPONENT"]);
			expect(result.diagnostics[0]).toMatchObject({
				slug: "gamma",
				severity: "error",
			});
		});

		it("uses drafts first with a draft source and warns about empty components", () => {
			const draft = { root: node("root", "from-draft") };
			const withDraft = publishedRecord(
				"alpha",
				{ root: node("root", "published") },
				{ draft },
			);
			const result = generate([withDraft, ...records().slice(1)], {
				source: "draft",
			});
			expect(result.diagnostics).toEqual([
				expect.objectContaining({
					code: "NO_SOURCE_PAYLOAD",
					severity: "warning",
					slug: "delta",
				}),
			]);
			expect(slugs(result.files)).toEqual(["alpha", "beta", "gamma"]);
			const [alpha, beta] = result.files;
			expect(alpha.contents).toContain('base: "from-draft"');
			expect(alpha.header).toMatchObject({
				source: "draft",
				publishedVersion: null,
				templateHash: hashSystemComponentTemplate(draft),
				variantSchemaHash: hashSystemComponentVariantSchema(undefined),
			});
			expect(beta.header).toMatchObject({
				source: "published",
				publishedVersion: "1",
			});

			expect(
				diagnosticCodes(records(), { source: "draft", include: ["delta"] })
					.result.diagnostics[0],
			).toMatchObject({ code: "NO_SOURCE_PAYLOAD", severity: "error" });
		});

		it("substitutes the slug into the file name pattern", () => {
			const result = generate(records(), {
				fileName: "{slug}/{slug}.styles.ts",
			});
			expect(result.files.map((file) => file.fileName)).toEqual([
				"alpha/alpha.styles.ts",
				"beta/beta.styles.ts",
			]);
			expect(result.files.map((file) => file.exportName)).toEqual([
				"alphaVariants",
				"betaVariants",
			]);
		});
	});

	describe("header", () => {
		it("round-trips through parseCodegenHeader", () => {
			const file = generateOne(
				publishedRecord("chip", flatPayload(), { version: "5" }),
			);
			expect(parseCodegenHeader(file.contents)).toEqual(file.header);
			expect(file.header).toMatchObject({
				version: 1,
				systemId: "sys_test",
				slug: "chip",
				source: "published",
				publishedVersion: "5",
				templateHash: hashSystemComponentTemplate(flatPayload()),
				variantSchemaHash: hashSystemComponentVariantSchema(
					flatPayload().variants,
				),
			});
			expect(
				parseCodegenHeader(file.contents.replaceAll("\n", "\r\n")),
			).toEqual(file.header);
		});

		it("returns null for files without a valid header", () => {
			const file = generateOne(publishedRecord("chip", flatPayload()));
			const [, second] = file.contents.split("\n");
			expect(parseCodegenHeader("export const x = 1;\n")).toBeNull();
			expect(
				parseCodegenHeader(file.contents.split("\n").slice(1).join("\n")),
			).toBeNull();
			expect(
				parseCodegenHeader(
					file.contents.replace(second, `${second.slice(0, -1)}`),
				),
			).toBeNull();
			expect(
				parseCodegenHeader(file.contents.replace('"version":1', '"version":2')),
			).toBeNull();
			expect(
				parseCodegenHeader(
					file.contents.replace(/"sourceHash":"[^"]+"/u, '"sourceHash":1'),
				),
			).toBeNull();
		});

		it("is byte-stable for the same input", () => {
			const record = publishedRecord("chip", precedencePayload());
			expect(generateOne(record).contents).toBe(generateOne(record).contents);
		});

		it("changes publishedVersion but not sourceHash on a republish without class changes", () => {
			const first = generateOne(
				publishedRecord("chip", flatPayload(), { version: "1" }),
			);
			const second = generateOne(
				publishedRecord("chip", flatPayload(), { version: "2" }),
			);
			expect(second.header.publishedVersion).toBe("2");
			expect(second.header.sourceHash).toBe(first.header.sourceHash);
		});
	});

	describe("sourceHash", () => {
		it("is stable under key reordering", () => {
			const payload = precedencePayload();
			const reversed = (value: unknown): unknown => {
				if (Array.isArray(value)) {
					return value.map(reversed);
				}
				if (value && typeof value === "object") {
					return Object.fromEntries(
						Object.entries(value)
							.reverse()
							.map(([key, entry]) => [key, reversed(entry)]),
					);
				}
				return value;
			};
			expect(
				hashCodegenSource(reversed(payload) as SystemComponentDraftPayload),
			).toBe(hashCodegenSource(payload));
		});

		it("ignores timestamps, labels and history", () => {
			const payload = precedencePayload();
			const record = publishedRecord("chip", payload);
			const relabelled = structuredClone(payload);
			const axes = relabelled.variants?.axes ?? {};
			axes.tone.label = "Colour";
			axes.tone.values.brand.label = "Brand!";
			if (relabelled.slots) {
				relabelled.slots.default.label = "Content";
				relabelled.slots.default.history = [{ fromVersion: "1" }];
			}
			const retimed = publishedRecord("chip", relabelled);
			retimed.updatedAt = "2026-10-05T00:00:00.000Z";
			const version = retimed.published?.versions["1"];
			if (version) {
				version.publishedAt = "2026-10-05T00:00:00.000Z";
			}
			expect(generateOne(retimed).header.sourceHash).toBe(
				generateOne(record).header.sourceHash,
			);
		});

		it("changes when classes, paths or compounds change", () => {
			const base = hashCodegenSource(precedencePayload());
			const classChange = precedencePayload();
			classChange.root.className = "flex p-0";
			const compoundChange = precedencePayload();
			compoundChange.variants?.compoundVariants?.reverse();
			// A part path named "label" must survive label stripping.
			const labelPath = precedencePayload();
			labelPath.root.children = [
				node("label", "font-bold text-base"),
				node("icon"),
			];
			for (const changed of [classChange, compoundChange, labelPath]) {
				expect(hashCodegenSource(changed)).not.toBe(base);
			}
		});
	});
});

describe("design-only nodes", () => {
	const designOnly = (
		templateNode: RecipeTemplateNode,
	): RecipeTemplateNode => ({
		...templateNode,
		designOnly: true,
	});

	// A styled label, a design-only guide with a styled child, a slot whose
	// default children include a design-only hint, and a slot hosted inside
	// the guide.
	const annotatedPayload = (): SystemComponentDraftPayload => ({
		root: node("root", "flex gap-2", [
			node("label", "font-bold"),
			designOnly(
				node("guide", "border border-dashed", [
					node("guide-label", "text-xs text-red-500"),
				]),
			),
		]),
		slots: {
			main: {
				name: "main",
				hostPath: "root",
				defaultChildren: [
					node("placeholder", "opacity-50"),
					designOnly(node("hint", "italic")),
				],
			},
			notes: {
				name: "notes",
				hostPath: "guide-label",
				defaultChildren: [node("note", "text-[10px]")],
			},
		},
		variants: {
			axes: {
				size: {
					label: "Size",
					defaultValue: "sm",
					values: {
						sm: { classesByPath: { root: "p-1", label: "text-sm" } },
						lg: { classesByPath: { root: "p-4" } },
					},
				},
			},
		},
	});

	it("skips a design-only node, its subtree and slots hosted inside it", () => {
		const file = generateOne(publishedRecord("field", annotatedPayload()));
		expect(file.model.slots.map((slot) => slot.path)).toEqual([
			"root",
			"label",
			"placeholder",
		]);
		for (const skipped of [
			"guide",
			"border-dashed",
			"text-red-500",
			"italic",
		]) {
			expect(file.contents).not.toContain(skipped);
		}
		expect(file.contents).not.toContain("text-[10px]");
	});

	it("does not let a styled design-only node force the slots shape", () => {
		const file = generateOne(
			publishedRecord("chip", {
				root: node("root", "inline-flex", [
					designOnly(node("ruler", "border-t", [node("tick", "w-px")])),
				]),
			}),
		);
		expect(file.shape).toBe("flat");
		expect(file.model.slots.map((slot) => slot.path)).toEqual(["root"]);
	});

	it("rejects variant and compound classes that target a design-only subtree", () => {
		const variantTarget = annotatedPayload();
		const sm = variantTarget.variants?.axes.size.values.sm;
		if (sm) {
			sm.classesByPath = { root: "p-1", "guide-label": "text-sm" };
		}
		const compoundTarget = annotatedPayload();
		if (compoundTarget.variants) {
			compoundTarget.variants.axes.tone = {
				label: "Tone",
				defaultValue: "neutral",
				values: { neutral: {}, brand: {} },
			};
			compoundTarget.variants.compoundVariants = [
				{
					when: { size: "lg", tone: "brand" },
					classesByPath: { guide: "p-2" },
				},
			];
		}
		const defaultChildTarget = annotatedPayload();
		const lg = defaultChildTarget.variants?.axes.size.values.lg;
		if (lg) {
			lg.classesByPath = { hint: "p-2", note: "p-3", ghost: "p-4" };
		}

		for (const [payload, path] of [
			[variantTarget, "guide-label"],
			[compoundTarget, "guide"],
		] as const) {
			const record = publishedRecord("field", payload);
			const result = generate([record]);
			expect(result.files).toEqual([]);
			expect(result.diagnostics).toEqual([
				expect.objectContaining({
					code: "DESIGN_ONLY_CLASS_TARGET",
					severity: "error",
					slug: "field",
					componentId: record.componentId,
					path,
				}),
			]);
		}

		const { codes } = diagnosticCodes([
			publishedRecord("field", defaultChildTarget),
		]);
		expect(codes).toEqual([
			"DESIGN_ONLY_CLASS_TARGET",
			"DESIGN_ONLY_CLASS_TARGET",
			"UNKNOWN_CLASS_TARGET",
		]);
	});

	it("skips a component whose root is design-only with a warning", () => {
		const annotation = publishedRecord("annotation", {
			root: designOnly(node("root", "bg-yellow-100")),
		});
		const result = generate([annotation, publishedRecord("ok", flatPayload())]);
		expect(result.files.map((file) => file.header.slug)).toEqual(["ok"]);
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				code: "DESIGN_ONLY_COMPONENT",
				severity: "warning",
				slug: "annotation",
				path: "root",
			}),
		]);
	});

	it("still rejects class targets when the root is design-only", () => {
		const record = publishedRecord("annotation", {
			root: designOnly(node("root", "bg-yellow-100", [node("pin", "size-2")])),
			variants: {
				axes: {
					tone: {
						label: "Tone",
						defaultValue: "warm",
						values: {
							warm: { classesByPath: { pin: "bg-red-500" } },
							cool: {},
						},
					},
					size: {
						label: "Size",
						defaultValue: "sm",
						values: { sm: {}, lg: {} },
					},
				},
				compoundVariants: [
					{
						when: { tone: "cool", size: "lg" },
						classesByPath: { root: "p-4", ghost: "p-1" },
					},
				],
			},
		});
		const result = generate([record, publishedRecord("ok", flatPayload())]);
		expect(result.files).toEqual([]);
		expect(
			result.diagnostics.map(({ code, severity, path }) => ({
				code,
				severity,
				path,
			})),
		).toEqual([
			{ code: "DESIGN_ONLY_CLASS_TARGET", severity: "error", path: "pin" },
			{ code: "DESIGN_ONLY_CLASS_TARGET", severity: "error", path: "root" },
			{ code: "UNKNOWN_CLASS_TARGET", severity: "error", path: "ghost" },
			{ code: "DESIGN_ONLY_COMPONENT", severity: "warning", path: "root" },
		]);
	});

	describe("sourceHash", () => {
		it("is unchanged for components without design-only nodes", () => {
			// Computed before design-only nodes existed: existing generated files
			// must not turn stale.
			expect(hashCodegenSource(precedencePayload())).toBe(
				"sha256:2b016a7cc641736378a0b6db374bc88e22be25c5a9d047ee73ff1cbe242fbb9d",
			);
			const explicitFalse = precedencePayload();
			explicitFalse.root.designOnly = false;
			expect(hashCodegenSource(explicitFalse)).toBe(
				hashCodegenSource(precedencePayload()),
			);
		});

		it("ignores edits inside a design-only subtree", () => {
			const base = annotatedPayload();
			const edited = annotatedPayload();
			const guide = edited.root.children?.[1];
			if (guide) {
				guide.className = "border-2 border-solid";
				guide.children = [
					node("guide-label", "text-lg"),
					node("guide-extra", "underline"),
				];
			}
			const main = edited.slots?.main.defaultChildren?.[1];
			if (main) {
				main.className = "not-italic";
			}
			if (edited.slots) {
				edited.slots.notes.defaultChildren = [];
				edited.slots.notes.name = "renamed";
			}
			expect(hashCodegenSource(edited)).toBe(hashCodegenSource(base));
			expect(
				generateOne(publishedRecord("field", edited)).header.sourceHash,
			).toBe(generateOne(publishedRecord("field", base)).header.sourceHash);
		});

		it("changes when a node that contributes to codegen becomes design-only", () => {
			const base = annotatedPayload();
			const toggled = annotatedPayload();
			const label = toggled.root.children?.[0];
			if (label) {
				label.designOnly = true;
			}
			const sm = toggled.variants?.axes.size.values.sm;
			if (sm) {
				sm.classesByPath = { root: "p-1" };
			}
			expect(hashCodegenSource(toggled)).not.toBe(hashCodegenSource(base));
		});
	});
});

describe("codegen names", () => {
	it("converts paths and slugs rule-based", () => {
		expect(toCamelCase("light-label")).toBe("lightLabel");
		expect(toCamelCase("itemText")).toBe("itemText");
		expect(toCamelCase("item_text-x")).toBe("itemTextX");
		expect(toPascalCase("otp-field-input")).toBe("OtpFieldInput");
		expect(toPascalCase("iconOnly")).toBe("IconOnly");
	});
});
