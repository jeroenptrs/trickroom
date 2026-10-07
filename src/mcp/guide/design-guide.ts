import type { SystemComponentRecord } from "../../utils/system-components";
import { BOARD_GUIDANCE } from "../guidance";
import { TOOL } from "../tool-names";
import { buildDesignCoreFacts, type DesignGuideInput } from "./design-facts";
import { buildOperationsTopic } from "./operations";
import {
	buildRecipesTopic,
	buildRegistryTopic,
	listOpenByDefaultRecipes,
} from "./registry-topics";
import { type GuideTopic, listGuideTopics } from "./topics";

/**
 * The design authoring contract: a core an agent reads once per session, and
 * topics it fetches when a task needs them. Statements here are what agents
 * trust, so each one must match current tool behaviour.
 */

export const DESIGN_GUIDE_TOPIC_NAMES = [
	"operations",
	"step-references",
	"boards",
	"recipes",
	"components",
	"registry",
	"tokens",
	"resources",
	"overlays",
	"validation",
	"memory",
	"examples",
] as const;

export type DesignGuideTopicName = (typeof DESIGN_GUIDE_TOPIC_NAMES)[number];

const WRITE_CONTEXT = {
	designFileId: "<design uuid>",
	expectedRevision: "<revision from your last read or write>",
};

const CORE_MODEL = [
	"A design file holds boards: root elements, one per screen or state, each with a tree of elements under it.",
	"An element is a registry component (library/component) with a role: branch holds child elements, text holds a string, leaf holds nothing. trickroom/container and trickroom/text build most layouts; trickroom/asset and trickroom/icon show the design system's images and icons.",
	"Styling is className, a Tailwind v4 class string. The other writable props are the layer name and the component's declared controls.",
	"A recipe (e.g. base-ui/dialog.default) inserts an attached structure of headless base-ui elements: you fill its slots and set its controls. A system component instance does the same for a component published in the design system: you pick variant values and fill its override targets and slots.",
	"Ids are generated on insert; a write maps your tempIds to them.",
];

const CORE_RULES = [
	BOARD_GUIDANCE,
	"Classes are checked against Tailwind and the linked design system. Prefer its tokens (color token brand-500 gives bg-brand-500) to arbitrary values like bg-[#123456]. Writes return unknown classes and tokens as warnings with the nearest valid class: fix them.",
	"Recipe and component structure is locked: no moving, deleting, retexting or inserting, except into declared slots. Change instances through slots, controls, variants and overrides; detach only when the user wants a one-off.",
	"Writes to an existing design take expectedRevision: the revision from your last read or the newRevision of your last write. It is checked per board: changes others made to boards you do not touch never block you. On REVISION_MISMATCH, re-read only the boards it names (next) and retry with currentRevision; never guess.",
	"Never write data-trickroom-library, -component, -role or marker props; Trickroom owns them.",
];

const CORE_WORKFLOW = [
	`Read: the design block below has the revision and boards; ${TOOL.designRead} with view "outline" gives structure and ids, with elementId the detail. If memoryNotes counts are non-zero, ${TOOL.memoryRead}({ designFileId }) and read the notes that bear on your task. When the human points at "this", ${TOOL.editorContext} says what they have open and selected.`,
	`Write in batches: ${TOOL.designApply} runs ordered steps atomically and returns one newRevision. Steps reference elements created by earlier steps with $step:N:tempId:<tempId> or $step:N:slot:<slot>. Prefer a system component (it carries the system's styling), then a recipe, then hand-built elements.`,
	`Check: fix warnings the write returns. ${TOOL.designScreenshot} the changed boards with viewport: ["mobile", "tablet", "desktop"] in one call and look at the images (scale: 1 for fine detail). Then ${TOOL.designValidate}, and ${TOOL.editorFocus} to show the human what changed.`,
	`Report tool trouble: when a Trickroom tool blocked or misled you, returned something unusable, or lacked a capability you needed, call ${TOOL.feedbackSubmit} with a one-line summary (your recent calls are attached). Not for design content questions.`,
];

const CORE_EXAMPLE = {
	tool: TOOL.designApply,
	arguments: {
		...WRITE_CONTEXT,
		operations: [
			{
				operation: "addSubtree",
				parameters: {
					parentId: null,
					index: 0,
					subtree: {
						tempId: "page",
						library: "trickroom",
						component: "container",
						name: "Settings",
						className: "flex min-h-screen w-full flex-col gap-6 p-4 md:p-8",
						children: [
							{
								tempId: "title",
								library: "trickroom",
								component: "text",
								text: "Settings",
								className: "text-2xl font-semibold",
							},
						],
					},
				},
			},
			{
				operation: "addRecipe",
				parameters: {
					parentId: "$step:0:tempId:page",
					index: 1,
					library: "base-ui",
					recipe: "switch.default",
				},
			},
		],
	},
};

const buildStepReferencesTopic = () => ({
	appliesTo: `${TOOL.designApply} and ${TOOL.designValidate} parameters elementId, parentId, targetParentId, sourceElementId, instanceId and rootElementId.`,
	forms: {
		"$step:N": "The element step N changed or inserted (its root).",
		"$step:N:rootElementId": "The root element step N inserted.",
		"$step:N:tempId:<tempId>":
			"The node with that tempId in step N's addSubtree. For copySubtree: the copy of that source element id.",
		"$step:N:slot:<slotName>":
			"The slot host of the recipe step N inserted (addRecipe, or a single recipe node in addSubtree).",
		"$step:N:tempId:<recipeTempId>:slot:<slotName>":
			"The slot host of one recipe when step N's addSubtree inserted several.",
	},
	notes: [
		"Steps are numbered from 0.",
		"A bare tempId is not an element id: always use a $step reference.",
		"Slot names come from the recipes topic. Each step result lists the recipes it inserted with their slot host ids, for follow-up batches.",
		"$step:N resolves to an element id; updateRecipeControl accepts it as instanceId, with path defaulting to that element's template path.",
		"A reference that does not resolve fails the step with INVALID_OPERATION_PARAMETERS and lists the accepted forms with the step's available tempIds or slots.",
	],
	example: [
		{
			operation: "addRecipe",
			parameters: {
				parentId: "board-id",
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
					tempId: "heading",
					library: "trickroom",
					component: "text",
					text: "Delete project?",
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
});

const buildBoardsTopic = () => ({
	rule: BOARD_GUIDANCE,
	create:
		"Insert with parentId null to create a board at the design root, usually a trickroom/container. Never wrap boards in a shared layer.",
	size: "Size a screen board like a page: w-full with h-screen or min-h-screen, and responsive variants inside. w-full fills the viewport in screenshots and the responsive view; on the canvas a board without its own width is at least 1280px wide. Fixed widths such as w-[720px] suit component specimens, not screens.",
	useSeparateBoardsFor: [
		"distinct views or pages",
		"interaction states: a dialog, sheet, popover or select open",
		"alternatives the user asked to compare",
	],
	doNotUseSeparateBoardsFor: [
		"breakpoints or device sizes (desktop, tablet, mobile)",
	],
	states:
		'For an interaction state, copy the base board (copySubtree with parentId null) and change the copy. Name boards by view and state, e.g. "Settings · Delete dialog".',
	review: `${TOOL.designScreenshot} with viewport: ["mobile", "tablet", "desktop"] captures the board at each width in one call; breakpoint variants resolve against each viewport. boardId takes several ids or "all" (up to 12 images per call).`,
});

const COMPONENTS_USAGE = [
	"addSystemComponent places an instance of a published component: pass systemId and componentId (cmp_…), not the name. Omit version for the current version.",
	"variantValues picks a value per variant axis. An omitted axis takes the component's default value, or stays unset when it has none.",
	"overrides is keyed by override target id. Each target allows some of className, text, icon (data-trickroom-icon-id), asset (data-trickroom-asset-id) and the props it lists.",
	"The instance's own elements are locked: no name, className, text or prop edits, no moves or deletes. Change the instance with updateSystemComponentInstance: variantValues merges, unsetVariantAxes clears, overrides replaces the whole map. Delete the instance root to remove it.",
	"Slots accept your own elements: insert into the slot host. Reads mark slot hosts with slot.",
	"To size or position an instance in its layout, use an override target with the className capability (often root), or wrap the instance in a container.",
	`${TOOL.componentRead}({ view: "stale" }) finds instances of older versions; ${TOOL.componentMigrate} moves them to the current version.`,
	"detachSystemComponent turns the instance into plain elements that no longer follow the component. Only for a one-off the user asked for.",
	`${TOOL.componentRead}({ componentId }) returns one component's interface: variant axes with values and defaults, slots, override targets and props. To create or change components, read ${TOOL.guide}({ topic: "component-authoring" }).`,
];

const describePublishedComponent = (component: SystemComponentRecord) => {
	const version =
		component.published?.versions[component.published.currentVersion];
	const axes = Object.entries(version?.variants?.axes ?? {});
	const targets = Object.values(version?.overrideTargets ?? {});
	const slots = Object.keys(version?.slots ?? {});
	return {
		componentId: component.componentId,
		slug: component.slug,
		name: component.name,
		...(component.group ? { group: component.group } : {}),
		...(axes.length > 0
			? {
					variants: Object.fromEntries(
						axes.map(([axis, definition]) => [
							axis,
							Object.keys(definition.values),
						]),
					),
				}
			: {}),
		...(targets.length > 0
			? {
					overrides: Object.fromEntries(
						targets.map((target) => [
							target.targetId,
							[
								...(target.capabilities ?? ["className"]),
								...(target.props ?? []),
							],
						]),
					),
				}
			: {}),
		...(slots.length > 0 ? { slots } : {}),
	};
};

/** Above this many published components the topic lists ids only. */
const MAX_DETAILED_COMPONENTS = 12;

const buildComponentsTopic = async (input: DesignGuideInput) => {
	const system = await input.readSystem();
	if (!system) {
		return {
			usage: COMPONENTS_USAGE,
			system: null,
			note: "No linked design system. Pass designFileId for a design linked to a system.",
		};
	}
	const published = await input.readPublishedComponents();
	const name = input.filter.name?.trim().toLowerCase();
	const matches =
		name === undefined
			? published
			: published.filter((component) =>
					[component.slug, component.name, component.group ?? ""].some(
						(value) => value.toLowerCase().includes(name),
					),
				);
	const header = {
		usage: COMPONENTS_USAGE,
		system: { systemId: system.systemId, systemName: system.systemName },
	};

	if (matches.length <= MAX_DETAILED_COMPONENTS) {
		return {
			...header,
			components: matches.map(describePublishedComponent),
			...(matches.length === 0 && name !== undefined
				? { note: `No published component matches "${name}".` }
				: {}),
		};
	}
	return {
		...header,
		components: Object.fromEntries(
			matches.map((component) => [component.slug, component.componentId]),
		),
		note: 'Slug to componentId. Pass name (a slug, name or group such as "button" or "atoms") for variant axes, override targets and slots.',
	};
};

const buildTokensTopic = async (input: DesignGuideInput) => {
	const system = await input.readSystem();
	const tokens = system ? await input.readTokenCounts() : null;
	return {
		validation: [
			"Every class a write sets is checked against Tailwind and the design's linked design system.",
			"UNKNOWN_TAILWIND_UTILITY: Tailwind cannot generate the class, usually a typo. Checked when the system's CSS loads.",
			"UNKNOWN_<DOMAIN>_TOKEN (COLOR, SPACING, FONT, TEXT, RADIUS, SHADOW): the system's Tailwind build cannot emit the class because it names a theme token the system lacks, or one the system removed on purpose.",
			"Both come back in the write response with suggestions holding the nearest valid class, keeping variants, ! and /opacity. Fix them.",
			'OUT_OF_SYSTEM_<DOMAIN>: an arbitrary value such as bg-[#123456] or rounded-[7px] that bypasses the system. Counted in warningCount, listed with response: "full". Prefer a token unless the user asked for that exact value.',
			"design_validate runs these checks as the system's lint rule design.unknown-class-token (the code above is in check) with its lint.json, next to design.unknown-variant-value and design.design-only-class-target.",
		],
		classes:
			"Tokens are Tailwind v4 theme variables, so a token's domain gives its utilities: color brand-500 → bg-brand-500, text-brand-500, border-brand-500; spacing pad-lg → p-pad-lg, gap-pad-lg; radius md → rounded-md; text sm → text-sm; font sans → font-sans; shadow card → shadow-card; breakpoint tablet → the tablet: variant.",
		list: `${TOOL.systemRead}({ view: "tokens", designFileId, domain?, query?, limit? }) returns token names and values. Filter by domain and query: color domains are often large.`,
		system: system
			? {
					systemName: system.systemName,
					tokensByDomain: tokens?.domains ?? null,
					...(tokens?.reviewRequired
						? {
								reviewRequired:
									"The token snapshot needs review in the app; token checks may be out of date.",
							}
						: {}),
				}
			: null,
	};
};

const buildResourcesTopic = async (input: DesignGuideInput) => {
	const system = await input.readSystem();
	const counts = system ? await input.readResourceCounts() : null;
	return {
		assets: `trickroom/asset (leaf) shows a raster image from the design system: set props data-trickroom-asset-id (from ${TOOL.systemRead} view "assets") and alt. Fit and size it with className (object-cover, aspect-video, size-*). The objectFit, objectPosition, loading and decoding props are legacy: use classes.`,
		icons: `trickroom/icon (leaf) shows an SVG icon from the design system: set data-trickroom-icon-id (from ${TOOL.systemRead} view "icons") and, for icons that carry meaning, aria-label. Size it with className.`,
		rules: [
			"The design must be linked to a design system, and the id must exist in its catalog; unknown ids are rejected.",
			`${TOOL.systemRead} views "assets" and "icons" take query (e.g. "arrow left") and limit; with id they return one entry, and views "asset_usage" and "icon_usage" show where one is used.`,
			"MCP returns ids and metadata, never image bytes or SVG source.",
			`${TOOL.systemUpdate} registers new image files and icon folders when policy allows.`,
		],
		system: system
			? {
					systemName: system.systemName,
					assets: counts?.assets ?? 0,
					icons: counts?.icons ?? 0,
				}
			: null,
	};
};

const buildOverlaysTopic = (input: DesignGuideInput) => ({
	behavior: [
		"Each board contains its own overlays: dialogs, sheets (base-ui/drawer.default), popovers and select popups render inside the board they belong to, and fixed elements such as a fixed inset-0 backdrop position against the board, not the screen.",
		`These recipes render open by default: ${listOpenByDefaultRecipes(input.policy).join(", ")}. Place one on a board and that board shows the open state. For a closed state, set props: { defaultOpen: false } on the recipe root with updateElementProps.`,
		"Place an overlay recipe where its trigger belongs in the layout: the trigger slot renders inline as the control that opens it.",
		"While an overlay is open, a board with no height of its own grows to the viewport height in screenshots and the responsive view (800px on the canvas). Give screen boards h-screen or min-h-screen anyway.",
		"Screenshots and the responsive view render overlays with their authored modal behaviour, and keep popups inside the board. The canvas renders them non-modal, exactly where authored.",
		"Menus and context menus have no open control and render closed.",
		"Breakpoint variants and viewport units (dvh, vw) resolve against the viewport, not the board. While an overlay is open, position variants on the board's children (first:, odd:, nth-*) also count the overlay's host element.",
	],
	pattern:
		"Dialog-open state: copy the page board (copySubtree, parentId null), add the dialog recipe to the copy where its trigger sits, and fill its content slot. The examples topic shows it as one batch.",
});

const buildValidationTopic = () => ({
	writeResponses: [
		"Writes return newRevision, created ids, the error issues the write introduced, warningCount, and warnings: likely typos (UNKNOWN_TAILWIND_UTILITY, UNKNOWN_*_TOKEN) and MISSING_RENDERER (the stage draws a placeholder) on the elements the write touched, grouped by code and class. warningCount also covers file-level warnings. Only the boards the write touched are checked.",
		"preExistingErrorCount counts errors the touched boards already had. They do not block a write; a plan that adds errors is refused with PLAN_LEAVES_ERRORS.",
		'response: "full" lists every warning on the touched elements ungrouped and adds token diagnostics and each step\'s summary.',
		`${TOOL.designValidate} without operations returns every issue in the design. Run it before handing off.`,
	],
	dryRuns: `${TOOL.designValidate} with operations and expectedRevision dry-runs the same steps ${TOOL.designApply} takes: one operation, a subtree insert, a copy or a whole batch. It never writes or returns generated ids; each step's \`predicted\` says what it would do.`,
	errorHints: [
		"Unknown library, component or recipe: suggestions and the available names.",
		"Unknown element or parent id: truncatedIdMatches, nameMatches and, when nothing matched, availableBoardIds.",
		"Unknown board: availableBoards. A nested element id passed as a board says to use elementId instead.",
		"Unknown system component: suggestions with the closest componentIds.",
		`REVISION_MISMATCH: someone else changed a board you change (staleBoards: id, name), or the design's name, settings or board order (manifest, order). Re-read only what it names (next: ${TOOL.designRead} calls with boardId), redo your steps there, then retry with currentRevision. Boards you do not touch never need a re-read. A copy whose source board changed fails with SOURCE_REVISION_MISMATCH and staleSourceBoard.`,
	],
});

const buildMemoryTopic = async (input: DesignGuideInput) => ({
	what: "Memory notes are durable steering notes on the project, a design system or a design: intent, usage, conventions, constraints, decisions and todos. They are never added to your context automatically: you read them on purpose.",
	read: [
		`${TOOL.memoryRead}({ designFileId }) indexes the project, the design's linked system and the design in one call: id, title, category, size, revision and a one-line summary per note, no bodies. ${TOOL.memoryRead}({ scope }) indexes one scope.`,
		`${TOOL.memoryRead}({ scope, noteIds }) with one id or up to 20 returns bodies. Before writing, read the notes that bear on your task and follow them over your own preferences.`,
		'Scopes: { kind: "design", designFileId }, { kind: "system", systemName } and "project".',
	],
	write: [
		`${TOOL.memoryWrite}({ action: "add", scope, category, title, body }) records what a later session needs: a decision and its reason, a constraint the user stated, a convention. Not progress logs or summaries of your work. Give it a title: the index shows it.`,
		"Categories: intent, usage, conventions, constraints, decision, todo.",
		`Bodies are markdown and may reference other entities: {{design:<designId>}}, {{board:<designId>/<boardId>}}, {{layer:<designId>/<elementId>}}, {{component:<id or slug>}}, {{token:<domain>/<name>}}, {{asset:<id>}}, {{icon:<id>}}. Reference the layer a decision is about rather than describing where it sits; the human gets a link that selects it. ${TOOL.memoryRead}({ scope, referenceType }) lists valid targets (layer: the design scope's layers, or query "<designId>/" for another design's); resolveReferences: true resolves them, and writes return referenceWarnings for ones that do not resolve.`,
		`${TOOL.memoryWrite} action "update" changes a note with edits (append, prepend, exact-text replace) or a whole new body; "update" and "delete" take the note's revision from the index as expectedRevision.`,
	],
	noteCounts: await input.readMemoryCounts(),
});

const buildExamplesTopic = () => [
	{
		task: "New design with one responsive screen",
		calls: [
			{
				tool: TOOL.designCreate,
				arguments: { name: "Billing" },
				note: "Returns designFile.id and newRevision. The design has no boards yet.",
			},
			{
				tool: TOOL.designApply,
				arguments: {
					...WRITE_CONTEXT,
					operations: [
						{
							operation: "addSubtree",
							parameters: {
								parentId: null,
								index: 0,
								subtree: {
									tempId: "page",
									library: "trickroom",
									component: "container",
									name: "Billing",
									className:
										"flex min-h-screen w-full flex-col gap-6 p-4 md:flex-row md:p-8",
									children: [
										{
											tempId: "nav",
											library: "trickroom",
											component: "container",
											name: "Nav",
											className: "flex gap-2 md:w-56 md:flex-col",
										},
										{
											tempId: "main",
											library: "trickroom",
											component: "container",
											name: "Main",
											className: "flex flex-1 flex-col gap-4",
											children: [
												{
													library: "trickroom",
													component: "text",
													text: "Billing",
													className: "text-2xl font-semibold",
												},
											],
										},
									],
								},
							},
						},
					],
				},
			},
			{
				tool: TOOL.designScreenshot,
				arguments: {
					designFileId: "<design uuid>",
					boardId: "<page id from idMap>",
					viewport: ["mobile", "tablet", "desktop"],
				},
			},
		],
	},
	{
		task: "Board with a dialog open over the page",
		calls: [
			{
				tool: TOOL.designApply,
				arguments: {
					...WRITE_CONTEXT,
					operations: [
						{
							operation: "copySubtree",
							parameters: {
								sourceElementId: "<page board id>",
								parentId: null,
								index: 1,
							},
						},
						{
							operation: "updateElementProps",
							parameters: {
								elementId: "$step:0",
								name: "Billing · Cancel plan dialog",
							},
						},
						{
							operation: "addRecipe",
							parameters: {
								parentId: "$step:0:tempId:<main element id>",
								index: 0,
								library: "base-ui",
								recipe: "dialog.default",
							},
						},
						{
							operation: "addSubtree",
							parameters: {
								parentId: "$step:2:slot:content",
								index: 0,
								subtree: {
									library: "trickroom",
									component: "text",
									text: "Cancel your plan?",
									className: "text-lg font-semibold",
								},
							},
						},
					],
				},
				note: "For copySubtree, $step:0:tempId:<source id> is the copy of that source element. The dialog renders open; its content slot keeps its default title, description and close button until you change them.",
			},
		],
	},
	{
		task: "Place and adjust a design system component",
		calls: [
			{
				tool: TOOL.designApply,
				arguments: {
					...WRITE_CONTEXT,
					operations: [
						{
							operation: "addSystemComponent",
							parameters: {
								parentId: "<parent id>",
								index: 0,
								systemId: "sys_…",
								componentId: "cmp_…",
								variantValues: { tone: "primary" },
								overrides: { label: { text: "Upgrade" } },
							},
						},
						{
							operation: "updateSystemComponentInstance",
							parameters: {
								rootElementId: "$step:0",
								variantValues: { size: "sm" },
							},
						},
					],
				},
				note: "Axis, value and override target ids come from the components topic.",
			},
		],
	},
	{
		task: "Icon and image from the design system",
		calls: [
			{
				tool: TOOL.systemRead,
				arguments: { view: "icons", query: "search", limit: 5 },
			},
			{
				tool: TOOL.designApply,
				arguments: {
					...WRITE_CONTEXT,
					operations: [
						{
							operation: "addElement",
							parameters: {
								parentId: "<parent id>",
								index: 0,
								library: "trickroom",
								component: "icon",
								className: "size-4",
								props: { "data-trickroom-icon-id": "<icon id>" },
							},
						},
						{
							operation: "addElement",
							parameters: {
								parentId: "<parent id>",
								index: 1,
								library: "trickroom",
								component: "asset",
								className: "aspect-video w-full object-cover",
								props: {
									"data-trickroom-asset-id": "<asset id>",
									alt: "Product screenshot",
								},
							},
						},
					],
				},
			},
		],
	},
];

export const DESIGN_GUIDE_TOPICS: readonly GuideTopic<
	DesignGuideTopicName,
	DesignGuideInput
>[] = [
	{
		name: "operations",
		when: `Every ${TOOL.designApply} operation with parameters and an example.`,
		build: buildOperationsTopic,
	},
	{
		name: "step-references",
		when: "Targeting elements created earlier in the same batch.",
		build: buildStepReferencesTopic,
	},
	{
		name: "boards",
		when: "Adding boards or deciding what gets its own board.",
		build: buildBoardsTopic,
	},
	{
		name: "recipes",
		when: "Composed UI (dialog, sheet, menu, select, tabs, fields). Add name for one recipe's template.",
		build: (input) => buildRecipesTopic(input.policy, input.filter),
	},
	{
		name: "components",
		when: "Placing or changing design system component instances. Add name for variants and overrides.",
		build: buildComponentsTopic,
	},
	{
		name: "registry",
		when: "Raw registry elements: roles, controls, defaults. Filter with library and name.",
		build: (input) => buildRegistryTopic(input.policy, input.filter),
	},
	{
		name: "tokens",
		when: "Choosing classes or fixing class warnings.",
		build: buildTokensTopic,
	},
	{
		name: "resources",
		when: "Images and icons from the design system.",
		build: buildResourcesTopic,
	},
	{
		name: "overlays",
		when: "Boards with an open dialog, sheet, popover or select.",
		build: buildOverlaysTopic,
	},
	{
		name: "validation",
		when: "Warnings, dry-runs and error hints.",
		build: buildValidationTopic,
	},
	{
		name: "memory",
		when: "Reading and writing memory notes.",
		build: buildMemoryTopic,
	},
	{
		name: "examples",
		when: "Worked calls: new screen, dialog-open board, component instance, icons.",
		build: buildExamplesTopic,
	},
];

export const buildDesignGuideCore = async (input: DesignGuideInput) => ({
	model: CORE_MODEL,
	rules: CORE_RULES,
	workflow: CORE_WORKFLOW,
	example: CORE_EXAMPLE,
	...(await buildDesignCoreFacts(input)),
	topics: listGuideTopics(DESIGN_GUIDE_TOPICS),
	topicUsage: `Fetch with ${TOOL.guide}({ designFileId, topic: "recipes" }) or topic: ["operations", "boards"]; name and library filter registry, recipes and components. Creating or changing design system components: topic "component-authoring".`,
});
