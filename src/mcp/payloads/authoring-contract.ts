import { createHash } from "node:crypto";
import {
	getControlDefinitions,
	getRegistryRecipes,
	type RegistryId,
	resolveRegistryComponent,
	SYSTEM_PROP_KEYS,
} from "../../libraries/registry";
import type { RecipeDefinition } from "../../types";
import { readAssetManifest } from "../../utils/asset-manifest-service";
import {
	assetIdProp,
	iconIdProp,
} from "../../utils/design-resource-references";
import {
	findDesignSystem,
	listDesignSystems,
} from "../../utils/design-system-store";
import { readIconManifest } from "../../utils/icon-manifest-service";
import {
	readDomainTokensReadonly,
	type TailwindTokenStorage,
} from "../../utils/tailwind-token-store";
import {
	assertCanReadDesignFile,
	getMcpPolicy,
	isComponentAllowed,
	type McpPolicy,
} from "../governance";
import { BOARD_GUIDANCE } from "../guidance";
import type { TrickroomMcpServerContext } from "../server-types";
import { getDesignSystemPayload } from "./design-system";
import { getGovernanceSummary, getProjectReference } from "./project";
import {
	describeRecipeComponentRef,
	describeRecipeControls,
	getAllowedChildrenMetadata,
	getComponentIds,
	getCompositionMetadata,
	getRegistryIds,
	getRegistryOrThrow,
	isRecipeAllowed,
	throwUnknownRegistryComponent,
} from "./registry";

const summarizeComponentCompactForAuthoringContract = (
	library: RegistryId,
	component: string,
) => {
	const registry = getRegistryOrThrow(library);
	if (!Object.hasOwn(registry, component)) {
		throwUnknownRegistryComponent(library, component);
	}

	const definition = registry[component as keyof typeof registry];

	return {
		library,
		component,
		label: definition.label,
		role: definition.role,
		inspectTool: "describeRegistryComponent",
	};
};

const summarizeComponentForAuthoringContract = (
	library: RegistryId,
	component: string,
) => {
	const registry = getRegistryOrThrow(library);
	if (!Object.hasOwn(registry, component)) {
		throwUnknownRegistryComponent(library, component);
	}

	const definition = registry[component as keyof typeof registry];
	const role = definition.role;
	const controls = getControlDefinitions(definition);

	const componentSummary = {
		library,
		component,
		label: definition.label,
		role,
		writableProps: [
			"className",
			"data-trickroom-name",
			...controls.map((control) => control.prop),
		],
		controls: controls.map((control) => ({
			name: control.prop,
			valueType: control.valueType,
			input: control.input,
		})),
		inspectTool: "describeRegistryComponent",
	};

	if (library !== "trickroom") {
		return componentSummary;
	}

	return {
		...componentSummary,
		allowedChildren: getAllowedChildrenMetadata(role),
		composition: getCompositionMetadata(role),
		content:
			role === "text"
				? {
						kind: "text",
						storage: "children",
						updateTool: "updateElementText",
					}
				: role === "leaf"
					? {
							kind: "none",
							storage: "children",
							serializedChildren: [],
						}
					: {
							kind: "children",
							storage: "children",
						},
	};
};

const createCatalogHash = (value: unknown) =>
	`sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

type AuthoringContractRecipeMode = "summary" | "none";
type AuthoringContractRegistryComponentMode = "summary" | "full" | "none";

type AuthoringContractOptions = {
	designFileId?: string;
	includeExamples?: boolean;
	includeRecipes?: AuthoringContractRecipeMode;
	includeResources?: boolean;
	includeRegistryComponents?: AuthoringContractRegistryComponentMode;
};

const AUTHORING_CONTRACT_PLACEHOLDER_DESIGN_FILE_ID =
	"00000000-0000-4000-8000-000000000001";
const AUTHORING_CONTRACT_PLACEHOLDER_REVISION =
	"sha256:0000000000000000000000000000000000000000000000000000000000000000";

const authoringContractWriteContext = {
	designFileId: AUTHORING_CONTRACT_PLACEHOLDER_DESIGN_FILE_ID,
	expectedRevision: AUTHORING_CONTRACT_PLACEHOLDER_REVISION,
} as const;

const AUTHORING_CONTRACT_EXAMPLES = [
	{
		tool: "addElement",
		description: "Add one text node under a branch parent.",
		arguments: {
			...authoringContractWriteContext,
			parentId: "board",
			index: 0,
			library: "trickroom",
			component: "text",
			name: "Caption",
			text: "Hello",
			className: "text-sm text-slate-700",
		},
	},
	{
		tool: "addRecipe",
		description: "Insert a supported composed recipe instance.",
		arguments: {
			...authoringContractWriteContext,
			parentId: "board",
			index: 0,
			library: "base-ui",
			recipe: "avatar.default",
		},
	},
	{
		tool: "addSubtree",
		description: "Insert a small generated subtree with tempIds.",
		arguments: {
			...authoringContractWriteContext,
			parentId: "board",
			index: 0,
			subtree: {
				library: "trickroom",
				component: "container",
				name: "Card",
				className: "rounded-lg border p-4",
				children: [
					{
						tempId: "title",
						library: "trickroom",
						component: "text",
						name: "Title",
						text: "Card title",
					},
				],
			},
		},
	},
	{
		tool: "updateElementProps",
		description: "Reference a canonical system asset on trickroom/asset.",
		arguments: {
			...authoringContractWriteContext,
			elementId: "hero-image",
			props: {
				[assetIdProp]: "ast_hero-shot",
				alt: "Product interface",
			},
		},
	},
	{
		tool: "updateElementProps",
		description: "Reference a canonical system icon on trickroom/icon.",
		arguments: {
			...authoringContractWriteContext,
			elementId: "menu-trigger-icon",
			props: {
				[iconIdProp]: "lucide-static/search",
			},
		},
	},
	{
		tool: "updateRecipeControl",
		description: "Update a declared recipe control by instance/path/prop.",
		arguments: {
			...authoringContractWriteContext,
			instanceId: "recipe-instance-id",
			path: "positioner",
			prop: "align",
			value: "end",
		},
	},
	{
		tool: "addSystemComponent",
		description:
			"Place a published system component instance. systemId comes from the linked design system manifest; componentId is the published component. Omit version for the current version. Set initial variant axes via variantValues; override slotted/text targets via overrides keyed by the component's override target id.",
		arguments: {
			...authoringContractWriteContext,
			parentId: "board",
			index: 0,
			systemId: "core",
			componentId: "button",
			variantValues: { size: "md", tone: "primary" },
			overrides: {
				label: { text: "Save changes" },
			},
		},
	},
	{
		tool: "updateSystemComponentInstance",
		description:
			"Update an attached system component instance in place. variantValues merges axis changes (omit unchanged axes); unsetVariantAxes clears axes back to schema defaults; overrides replaces the full override map. To change a component-owned prop that is not an exposed override target, edit the component itself or detachSystemComponent first.",
		arguments: {
			...authoringContractWriteContext,
			rootElementId: "system-component-root-id",
			variantValues: { tone: "secondary" },
			overrides: {
				label: { text: "Cancel" },
			},
		},
	},
	{
		tool: "applyDesignOperations",
		description:
			'Commit an ordered batch atomically. Responses are compact by default: newRevision, per-step created ids, error issues, warningCount, and likely-typo warnings (unknown utilities/tokens) on touched elements. Escalate per call via response: includeWarnings (all warnings in scope; warningScope:"file" widens it), includeTokenDiagnostics for the custom-utility catalog, includeStepDetails for full step summaries.',
		arguments: {
			...authoringContractWriteContext,
			operations: [
				{
					operation: "updateElementProps",
					parameters: { elementId: "board", className: "p-6 gap-4" },
				},
			],
			response: { includeWarnings: true },
		},
	},
	{
		tool: "applyDesignOperations",
		description:
			"Insert a dialog recipe and fill its slots in one batch. $step:0:slot:<slotName> resolves to the slot host the recipe in step 0 created; $step:1:tempId:<tempId> resolves to a node an earlier addSubtree created.",
		arguments: {
			...authoringContractWriteContext,
			operations: [
				{
					operation: "addRecipe",
					parameters: {
						parentId: "board",
						index: 0,
						library: "base-ui",
						recipe: "dialog.default",
					},
				},
				{
					operation: "addSubtree",
					parameters: {
						parentId: "$step:0:slot:content",
						index: 0,
						subtree: {
							tempId: "body",
							library: "trickroom",
							component: "container",
							className: "flex flex-col gap-4 p-6",
							children: [
								{
									tempId: "heading",
									library: "trickroom",
									component: "text",
									text: "Delete project?",
								},
							],
						},
					},
				},
				{
					operation: "updateElementProps",
					parameters: {
						elementId: "$step:1:tempId:heading",
						className: "text-lg font-semibold",
					},
				},
			],
		},
	},
] as const;

const summarizeRecipeForContract = (
	library: RegistryId,
	recipe: RecipeDefinition,
) => {
	const localRecipe = recipe.id.startsWith(`${library}/`)
		? recipe.id.slice(library.length + 1)
		: recipe.id;
	const rootResolution = resolveRegistryComponent(
		recipe.root.library,
		recipe.root.component,
	);

	return {
		library,
		recipe: recipe.id,
		localRecipe,
		aliases: [...new Set([recipe.id, localRecipe])],
		label: recipe.label,
		description: recipe.description ?? null,
		version: recipe.version,
		root: {
			...describeRecipeComponentRef(recipe.root),
			role:
				rootResolution.status === "known"
					? rootResolution.definition.role
					: null,
		},
		slots: Object.keys(recipe.slots ?? {}).sort(),
		controls: describeRecipeControls(recipe).map((control) => ({
			name: control.name,
			prop: control.prop,
			valueType: control.valueType,
		})),
		markerGuidance: {
			inspectTool: "describeRegistryRecipe",
		},
	};
};

const buildRegistryCatalogForContract = (
	policy: McpPolicy,
	includeRecipes: AuthoringContractRecipeMode,
	includeRegistryComponents: AuthoringContractRegistryComponentMode,
) => {
	const allowedComponentsByLibrary = getRegistryIds().map((library) =>
		getComponentIds(library).filter((component) =>
			isComponentAllowed(policy, library, component),
		),
	);
	const componentsByLibrary = allowedComponentsByLibrary.map(
		(components, index) => {
			const library = getRegistryIds()[index];
			if (includeRegistryComponents === "none") {
				return [];
			}

			return components.map((component) =>
				includeRegistryComponents === "full"
					? summarizeComponentForAuthoringContract(library, component)
					: summarizeComponentCompactForAuthoringContract(library, component),
			);
		},
	);
	const recipesByLibrary =
		includeRecipes === "summary"
			? getRegistryIds().map((library) =>
					getRegistryRecipes(library)
						.filter((recipe) => isRecipeAllowed(policy, recipe))
						.map((recipe) => summarizeRecipeForContract(library, recipe)),
				)
			: getRegistryIds().map(
					() => [] as ReturnType<typeof summarizeRecipeForContract>,
				);

	return getRegistryIds().map((library, index) => ({
		library,
		builtIn: true,
		readOnly: true,
		...(includeRegistryComponents === "none"
			? {
					componentCount: allowedComponentsByLibrary[index].length,
					listTool: "listRegistryComponents",
				}
			: { components: componentsByLibrary[index] }),
		...(includeRecipes === "summary"
			? { recipes: recipesByLibrary[index] }
			: {}),
	}));
};

const summarizeTokenPlanningContext = (
	designSystemPayload: Awaited<ReturnType<typeof getDesignSystemPayload>>,
	storedTokens: TailwindTokenStorage | null,
) => {
	if (designSystemPayload.designSystem === null) {
		return {
			storageStatus: "not_linked" as const,
			listTool: "listDesignTokens",
			guidance:
				"Link the design to a configured system or pass designFileId after linking to inspect token storage.",
		};
	}

	const systemName = designSystemPayload.designSystem.systemName;
	if (!storedTokens) {
		return {
			storageStatus: "not_stored" as const,
			systemName,
			listTool: "listDesignTokens",
			guidance:
				"Token storage is not available yet for this system. Use listDesignTokens after tokens are synced.",
		};
	}

	const domains = Object.entries(storedTokens.domains).map(
		([domain, storage]) => {
			const customCount = storage.baselineDiff.added.length;
			const overriddenCount = storage.baselineDiff.overridden.length;
			const removedCount = storage.baselineDiff.removed.length;

			return {
				domain,
				tokenCount: Object.keys(storage.tokens).length,
				customCount,
				overriddenCount,
				removedCount,
				hasChanges: customCount + overriddenCount + removedCount > 0,
			};
		},
	);

	return {
		storageStatus: "stored" as const,
		systemName,
		listTool: "listDesignTokens",
		tokenSnapshotVersion: storedTokens.version,
		tokenSnapshotSyncedAt: storedTokens.metadata.syncedAt,
		tailwindBaselineVersion: storedTokens.metadata.tailwindBaselineVersion,
		reviewRequired: storedTokens.metadata.reviewRequired,
		domains,
		changedDomains: domains
			.filter((domainSummary) => domainSummary.hasChanges)
			.map((domainSummary) => domainSummary.domain),
		guidance:
			"Use listDesignTokens for the full per-domain token name/value list.",
	};
};

const buildResourcePlanningContext = async (
	context: TrickroomMcpServerContext,
	systemName: string | null,
) => {
	const fonts = {
		available: false,
		usageTool: null,
		listTool: null,
		note: "Font MCP discovery is not available yet. Use Tailwind font utilities via className.",
	};

	const unavailableAssets = {
		available: false,
		count: 0,
		usageTool: "findAssetUsage",
		listTool: "listSystemAssets",
		describeTool: "describeAsset",
		referenceProps: [assetIdProp, "alt"],
		elementComponents: ["trickroom/asset"],
		manifestUpdatedAt: null,
	};
	const unavailableIcons = {
		available: false,
		count: 0,
		usageTool: "findIconUsage",
		listTool: "listSystemIcons",
		describeTool: "describeIcon",
		referenceProps: [iconIdProp, "aria-label"],
		elementComponents: ["trickroom/icon"],
		manifestUpdatedAt: null,
	};

	if (systemName === null) {
		return {
			assets: unavailableAssets,
			icons: unavailableIcons,
			fonts,
			guidance:
				"Link the design to a configured system to discover assets and icons.",
		};
	}

	const system = await findDesignSystem(context.projectRoot, systemName);
	if (!system) {
		return {
			assets: unavailableAssets,
			icons: unavailableIcons,
			fonts,
			guidance: `System "${systemName}" is referenced but not configured.`,
		};
	}

	const [assetManifest, iconManifest] = await Promise.all([
		readAssetManifest(context.projectRoot, system.manifest.systemId).catch(
			() => null,
		),
		readIconManifest(context.projectRoot, system.manifest.systemId).catch(
			() => null,
		),
	]);

	return {
		assets: {
			available: assetManifest !== null,
			count: assetManifest ? Object.keys(assetManifest.assets).length : 0,
			usageTool: "findAssetUsage",
			listTool: "listSystemAssets",
			describeTool: "describeAsset",
			referenceProps: [assetIdProp, "alt"],
			elementComponents: ["trickroom/asset"],
			manifestUpdatedAt: assetManifest?.metadata.updatedAt ?? null,
		},
		icons: {
			available: iconManifest !== null,
			count: iconManifest ? Object.keys(iconManifest.icons).length : 0,
			usageTool: "findIconUsage",
			listTool: "listSystemIcons",
			describeTool: "describeIcon",
			referenceProps: [iconIdProp, "aria-label"],
			elementComponents: ["trickroom/icon"],
			manifestUpdatedAt: iconManifest?.metadata.indexedAt ?? null,
		},
		fonts,
		guidance:
			"Inspect listSystemAssets and listSystemIcons before assigning canonical resource IDs. Raw bytes and SVG are not returned by MCP.",
	};
};

const buildAuthoringGuidance = () => ({
	recommendedFirstCall:
		"Call getDesignAuthoringContract with designFileId once before planning design-file mutations. For system component draft authoring, call getSystemComponentAuthoringContract.",
	mutationStrategy: [
		{
			prefer: "addRecipe",
			when: "The UI maps to a supported registry recipe.",
		},
		{
			prefer: "addSubtree",
			when: "You need a generated multi-node structure not covered by a recipe.",
		},
		{
			prefer: "addElement",
			when: "You need one simple registry node.",
		},
		{
			prefer: "copySubtree",
			when: "You can reuse an existing subtree from this or another design.",
		},
		{
			prefer: "addSystemComponent",
			when: "You are placing a published system component instance from the linked design system.",
		},
		{
			prefer: "updateSystemComponentInstance",
			when: "You are changing variant values or override targets on an attached system component instance.",
		},
		{
			prefer: "validateOperation",
			when: "A single operation target or parameters are uncertain.",
		},
		{
			prefer: "validateSubtree",
			when: "A candidate subtree is large or structurally complex.",
		},
		{
			prefer: "validateCopySubtree",
			when: "Copying an existing subtree into a new parent is uncertain.",
		},
	],
	rules: [
		"Boards are views or interaction states, never breakpoints: build one responsive board and review it at several viewport widths.",
		"Do not write registry-reference props or recipe marker props manually.",
		"Inspect system assets and icons before setting canonical resource IDs.",
		"Use listDesignTokens for full token lists; the contract only summarizes storage.",
		"Use describeRegistryRecipe for full recipe templates and slot defaults.",
		"Use getSystemComponentAuthoringContract before creating or updating system component drafts.",
		"Every write returns warningCount. Likely-typo warnings (UNKNOWN_TAILWIND_UTILITY, UNKNOWN_*_TOKEN) and MISSING_RENDERER (the stage shows a placeholder) on the elements you touched are returned by default — fix them before moving on. Other warnings are counted, not listed; escalate with response.includeWarnings when warningCount is non-zero and you need them.",
	],
	boards: {
		rule: BOARD_GUIDANCE,
		responsive:
			"Express breakpoints inside the board with responsive class variants; a board's width comes from the viewport it is viewed at, not from the board itself.",
		useSeparateBoardsFor: [
			"distinct views or pages",
			"interaction states such as a sheet, drawer, dialog, or menu open",
			"alternative explorations the user asked to compare",
		],
		doNotUseSeparateBoardsFor: [
			"breakpoints or device sizes (desktop/tablet/mobile)",
		],
		verify:
			"Call screenshotBoard on the same board with viewport mobile, tablet, and desktop to review responsive behavior.",
	},
	stepReferences: {
		appliesTo:
			"applyDesignOperations and validateOperationPlan element id parameters: elementId, parentId, targetParentId, sourceElementId, instanceId, rootElementId.",
		forms: {
			"$step:N": "The element step N changed or inserted (its root).",
			"$step:N:rootElementId": "The root element of what step N inserted.",
			"$step:N:tempId:<tempId>":
				"The node with that tempId in step N's addSubtree (for copySubtree: the copy of that source element id).",
			"$step:N:slot:<slotName>":
				"The slot host of the recipe step N inserted, for filling recipe slots (e.g. a dialog's content) in the same batch.",
			"$step:N:tempId:<recipeTempId>:slot:<slotName>":
				"The slot host of one recipe when step N's addSubtree inserted several recipe nodes.",
		},
		note: "Use step references instead of bare tempIds; a bare tempId is not an element id. Slot names come from describeRegistryRecipe.",
	},
	responseVerbosity: {
		default:
			"Write tools (applyDesignOperations, copySubtree, and single-element mutations) return error-severity issues, a warningCount scoped to the elements the write touched, and likely-typo (UNKNOWN_TAILWIND_UTILITY, UNKNOWN_*_TOKEN) and MISSING_RENDERER warnings on those elements. Other warnings and the full custom-utility token catalog are omitted to keep responses small.",
		escalate: [
			{
				on: "every write tool (applyDesignOperations, copySubtree, addElement, addSubtree, updateElementProps, …)",
				how: 'Pass response: { includeWarnings: true } to include every warning in scope (elements this write touched). Add warningScope: "file" for the whole design, includeTokenDiagnostics: true for the full custom-utility catalog, or includeWarnings: false to drop even typo warnings.',
			},
			{
				on: "after many writes",
				how: "Call validateDesignFile (supports includeTokenDiagnostics) for the whole design's issue set.",
			},
		],
		when: "Escalate when a write succeeds but you need to confirm token/class health, are debugging unexpected styling, or are about to hand off; otherwise keep the default to minimize tokens.",
	},
});

const SYSTEM_COMPONENT_AUTHORING_PLACEHOLDER_REVISION =
	"sha256:0000000000000000000000000000000000000000000000000000000000000000";
const SYSTEM_COMPONENT_AUTHORING_PLACEHOLDER_TEMPLATE_HASH =
	"sha256:1111111111111111111111111111111111111111111111111111111111111111";

const SYSTEM_COMPONENT_AUTHORING_CONTRACT_EXAMPLES = [
	{
		tool: "createSystemComponentDraft",
		description: "Create a component draft with a root template and variants.",
		arguments: {
			systemName: "Core",
			expectedRevision: SYSTEM_COMPONENT_AUTHORING_PLACEHOLDER_REVISION,
			slug: "status-pill",
			name: "Status Pill",
			draft: {
				root: {
					path: "root",
					library: "trickroom",
					component: "container",
					className: "inline-flex items-center gap-2 rounded-full px-3 py-1",
					children: [
						{
							path: "label",
							library: "trickroom",
							component: "text",
							text: "Status",
						},
					],
				},
				variants: {
					axes: {
						tone: {
							label: "Tone",
							defaultValue: "neutral",
							values: {
								neutral: {
									label: "Neutral",
									classesByPath: { root: "bg-zinc-100 text-zinc-800" },
								},
								success: {
									label: "Success",
									classesByPath: { root: "bg-emerald-100 text-emerald-800" },
								},
							},
						},
					},
					defaultValues: { tone: "neutral" },
				},
				overrideTargets: {
					label: {
						targetId: "label",
						label: "Label",
						path: "label",
						capabilities: ["text", "className"],
					},
				},
			},
		},
	},
	{
		tool: "updateSystemComponentDraft",
		description: "Update draft override targets with optimistic hashes.",
		arguments: {
			systemName: "Core",
			componentId: "cmp_00000000-0000-4000-8000-000000000001",
			expectedRevision: SYSTEM_COMPONENT_AUTHORING_PLACEHOLDER_REVISION,
			expectedDraftTemplateHash:
				SYSTEM_COMPONENT_AUTHORING_PLACEHOLDER_TEMPLATE_HASH,
			overrideTargets: {
				root: {
					targetId: "root",
					label: "Root",
					path: "root",
					capabilities: ["className"],
				},
			},
		},
	},
] as const;

export const getSystemComponentAuthoringContractPayload = async (
	context: TrickroomMcpServerContext,
	options: { systemName?: string; includeExamples?: boolean } = {},
) => {
	const systems = await listDesignSystems(context.projectRoot);
	const selectedSystem =
		options.systemName === undefined
			? null
			: (systems.find(
					(system) =>
						system.manifest.systemName === options.systemName ||
						system.manifest.systemId === options.systemName,
				) ?? null);

	return {
		project: getProjectReference(context),
		schemaVersion: 1,
		contract: "system-component-authoring",
		system:
			options.systemName === undefined
				? null
				: {
						requested: options.systemName,
						configured: selectedSystem !== null,
						systemId: selectedSystem?.manifest.systemId ?? null,
						systemName: selectedSystem?.manifest.systemName ?? null,
					},
		configuredSystems: systems.map((system) => ({
			systemId: system.manifest.systemId,
			systemName: system.manifest.systemName,
		})),
		recommendedFirstCall:
			"Call getSystemComponentAuthoringContract before createSystemComponentDraft or updateSystemComponentDraft. Use listSystemComponents or describeSystemComponent for the current revision and draft hashes.",
		tools: {
			read: ["listSystemComponents", "describeSystemComponent"],
			write: [
				"createSystemComponentDraft",
				"updateSystemComponentDraft",
				"publishSystemComponent",
				"deleteSystemComponent",
			],
		},
		shapes: {
			root: {
				type: "RecipeTemplateNode",
				required: ["path", "library", "component"],
				optional: ["name", "className", "props", "text", "slot", "children"],
				pathRules: [
					'Use "root" for the root node path.',
					"Every template path must be unique, non-empty, stable, and slashless.",
					"slots, variants.classesByPath, and overrideTargets.path reference these paths.",
				],
				children:
					"Recursive array of RecipeTemplateNode for branch-role nodes.",
				props: "JSON-primitive registry control props only.",
			},
			slots: {
				type: "Record<string, SystemComponentSlotDefinition>",
				requiredPerSlot: ["name", "hostPath"],
				optionalPerSlot: ["label", "insertIndex", "defaultChildren", "history"],
				rules: [
					"Map key must match slot.name.",
					"hostPath must reference a template path.",
					"defaultChildren uses the same RecipeTemplateNode shape.",
					"Slot content renders after the host's declared template children by default (declared children first, then slot children).",
					"insertIndex (non-negative integer) splices slot content into the host's declared children at that index, clamped to the declared-children length. Set it to 0 to place slot content before the declared children — for example an optional leading icon ahead of a fixed label.",
					"Changing insertIndex on publish changes render order and marks existing instances stale; migration re-splices preserved authored slot content at the new version's insertIndex.",
					'Legacy alternative to insertIndex: host the slot on a first-positioned wrapper node with className "contents" so appended slot content still renders ahead of sibling declared children.',
				],
			},
			variants: {
				type: "SystemComponentVariantSchema",
				required: ["axes"],
				axisShape: {
					required: ["label", "values"],
					optional: ["defaultValue"],
				},
				valueShape: {
					optional: ["label", "classesByPath"],
				},
				classesByPath:
					"Record from template path to non-empty Tailwind class string. Paths must exist in root.",
				compoundVariants:
					"Array of { when: Record<axis, value | value[]>, classesByPath }. Normal authoring uses single string values for at least two valid axis/value conditions.",
				defaultValues:
					"Record from axis id to value id. Both schema defaultValues and axis.defaultValue must reference real value ids.",
				rules: [
					"Omit defaultValues and axis.defaultValue for optional axes. Omitted default-less axes are genuinely unset; Trickroom does not fabricate the first value.",
					"Compound variants are matched by their normalized when signature. Do not author duplicate signatures; validation reports duplicates and persisted order remains CSS precedence.",
					"Compounds with empty classesByPath are treated as empty and may be garbage-collected by authoring flows; omit them instead of persisting empty entries.",
					"Array-valued when entries remain accepted for compatibility and are preserved as advanced shapes, but normal UI authoring should not collapse or expand them silently.",
				],
				instanceUpdates:
					"Use variantValues to set axes and unsetVariantAxes to clear axes. Missing variantValues keys leave existing instance values unchanged. On addSystemComponent, unsetVariantAxes clears matching initial variantValues before schema defaults resolve.",
			},
			overrideTargets: {
				type: "Record<string, SystemComponentOverrideTarget>",
				requiredPerTarget: ["targetId", "label", "path"],
				optionalPerTarget: ["capabilities", "props", "history"],
				capabilities: ["className", "text", "icon", "asset"],
				props:
					"Visible registry control prop names on the target template node, for example placeholder or disabled.",
				rules: [
					"Map key must match target.targetId.",
					"path must reference a template path.",
					"capabilities defaults to className when omitted.",
					"props must reference visible, non-deprecated registry controls on the target node.",
				],
			},
		},
		validation: {
			errorCode: "VALIDATION_FAILED",
			diagnosticCode: "INVALID_SYSTEM_COMPONENT_DRAFT_INPUT",
			note: "Malformed draft inputs return structured diagnostics with path and message fields.",
		},
		...((options.includeExamples ?? true)
			? { examples: SYSTEM_COMPONENT_AUTHORING_CONTRACT_EXAMPLES }
			: {}),
	};
};

export const getAuthoringContractPayload = async (
	context: TrickroomMcpServerContext,
	options: AuthoringContractOptions = {},
) => {
	const {
		designFileId,
		includeExamples = true,
		includeRecipes = "none",
		includeResources = false,
		includeRegistryComponents = "summary",
	} = options;
	const policy = getMcpPolicy(context.config);
	if (designFileId !== undefined) {
		assertCanReadDesignFile(policy, designFileId);
	}

	const registriesPayload = buildRegistryCatalogForContract(
		policy,
		includeRecipes,
		includeRegistryComponents,
	);
	const componentCatalog = registriesPayload.map((registry) => ({
		library: registry.library,
		...(includeRegistryComponents === "none"
			? { componentCount: registry.componentCount ?? 0 }
			: { components: registry.components ?? [] }),
	}));
	const recipeCatalog =
		includeRecipes === "summary"
			? registriesPayload.map((registry) => ({
					library: registry.library,
					recipes: registry.recipes ?? [],
				}))
			: [];

	const catalogHash = createCatalogHash(componentCatalog);
	const registryHash = catalogHash;
	const recipeCatalogHash =
		includeRecipes === "summary" ? createCatalogHash(recipeCatalog) : null;

	const designSystemPayload =
		designFileId === undefined
			? null
			: await getDesignSystemPayload(context, designFileId);

	const storedTokens =
		designSystemPayload?.designSystem?.systemId === undefined ||
		designSystemPayload?.designSystem?.systemId === null
			? null
			: await readDomainTokensReadonly(
					context.projectRoot,
					designSystemPayload.designSystem.systemId,
				);

	const tokens =
		designSystemPayload === null
			? null
			: summarizeTokenPlanningContext(designSystemPayload, storedTokens);

	const resources =
		designSystemPayload === null || !includeResources
			? null
			: await buildResourcePlanningContext(
					context,
					designSystemPayload.designSystem?.systemName ?? null,
				);

	const resourceManifestUpdatedAt =
		resources === null
			? null
			: ([resources.assets.manifestUpdatedAt, resources.icons.manifestUpdatedAt]
					.filter((value): value is string => typeof value === "string")
					.sort()
					.at(-1) ?? null);

	return {
		project: getProjectReference(context),
		governance: getGovernanceSummary(policy),
		schemaVersion: 1,
		contract: "design-authoring",
		designSchemaVersion: 1,
		relatedContracts: {
			systemComponentAuthoring: {
				tool: "getSystemComponentAuthoringContract",
				when: "Use for createSystemComponentDraft and updateSystemComponentDraft root, slot, variant, and override target payloads.",
			},
		},
		catalogVersion: "builtin:trickroom:1",
		catalogHash,
		registryHash,
		recipeCatalogHash,
		tokenSnapshotVersion: tokens?.tokenSnapshotVersion ?? null,
		tokenSnapshotSyncedAt: tokens?.tokenSnapshotSyncedAt ?? null,
		resourceManifestUpdatedAt,
		registries: registriesPayload,
		props: {
			writableInstanceProps: ["className", "data-trickroom-name"],
			modelFacingAliases: {
				name: "data-trickroom-name",
			},
			systemOwnedProps: [...SYSTEM_PROP_KEYS].sort(),
			fixedSystemProps: [
				"data-trickroom-library",
				"data-trickroom-component",
				"data-trickroom-role",
			],
		},
		compositionRules: {
			roleInvariants: [
				{
					role: "text",
					children: "string",
					acceptsElementChildren: false,
				},
				{
					role: "leaf",
					children: "empty-array",
					acceptsElementChildren: false,
				},
				{
					role: "branch",
					children: "array",
					acceptsElementChildren: true,
				},
			],
			futureSlotModel:
				"Slot metadata can narrow freeform composition later, but it must not override role invariants.",
		},
		mutationRules: [
			"Use element IDs as primary handles.",
			"Use listDesignFiles for the current expectedRevision; use bounded readDesignFile, readElement, or readSubtree only for needed structure.",
			"Use validateOperation to dry-run a single operation before writing when the target context is uncertain.",
			"Registry-reference and recipe marker props are system-owned and must not be written through instance props.",
			"Use updateElementText for text role content; text is stored in children, not props.",
			"Only branch role elements accept child elements; text and leaf role elements reject child insertion and moves into them.",
			"Before authoring, call listMemoryNotes for the relevant design, system, and project scopes to honor recorded intent, usage conventions, and constraints; capture durable rationale with addMemoryNote.",
		],
		authoringGuidance: buildAuthoringGuidance(),
		...(includeExamples ? { examples: AUTHORING_CONTRACT_EXAMPLES } : {}),
		...(tokens === null ? {} : { tokens }),
		...(resources === null ? {} : { resources }),
		designSystem: designSystemPayload,
	};
};
