import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { availableRegistries, registries } from "../libraries/registry";
import {
	isMcpEnabled,
	TrickroomProjectConfigError,
	type TrickroomProjectContext,
} from "../project";
import { isTrickroomDesign } from "../server-utils";
import {
	createDesignFileService,
	type DesignFileRead,
	DesignFileServiceError,
} from "../services/design-file-service";
import {
	applyAddElement,
	applyDeleteElement,
	applyMoveElement,
	applyUpdateElementProps,
	applyUpdateElementText,
	DesignTransformError,
} from "../services/design-transform-service";
import type { Node as DesignNode, Role, TrickroomDesign } from "../types";
import { readDomainTokensReadonly } from "../utils/tailwind-token-store";

export type TrickroomMcpServerContext = TrickroomProjectContext;

const readOnlyClosedWorldAnnotations = {
	readOnlyHint: true,
	openWorldHint: false,
} as const;

type RegistryId = keyof typeof registries;

type ElementContext = {
	element: DesignNode;
	parent: DesignNode | null;
	index: number | null;
	rootIndex: number | null;
	siblingIds: string[];
};

type ValidationIssue = {
	severity: "error" | "warning";
	code: string;
	message: string;
	path?: string;
	elementId?: string;
};

const createJsonResult = (
	payload: Record<string, unknown>,
): CallToolResult => ({
	content: [
		{
			type: "text",
			text: JSON.stringify(payload, null, 2),
		},
	],
	structuredContent: payload,
});

const createProjectInfoResult = (context: TrickroomMcpServerContext) => {
	const payload = {
		projectName: context.config.name,
		projectRoot: context.projectRoot,
		configPath: context.configPath,
		mcpEnabled: true,
		configuredSystems: Object.keys(context.config.systems ?? {}),
	};

	return createJsonResult(payload);
};

const getRegistryIds = () => [...availableRegistries].sort() as RegistryId[];

const getRegistryOrThrow = (library: string) => {
	if (!Object.hasOwn(registries, library)) {
		throw new Error(`Unknown registry library "${library}"`);
	}

	return registries[library as RegistryId];
};

const getComponentIds = (library: RegistryId) =>
	Object.keys(registries[library]).sort();

const getCategoryForTokenName = (name: string) => {
	const separatorIndex = name.indexOf("-");
	return separatorIndex === -1 ? name : name.slice(0, separatorIndex);
};

const getAllowedChildrenMetadata = (role: Role | undefined) => {
	if (role === "text") {
		return {
			kind: "none",
			serializedChildren: "string",
			reason:
				"Text role elements store text in children and cannot contain child elements.",
		};
	}

	return {
		kind: "nodes",
		serializedChildren: "array",
		reason: "Default elements can contain child element nodes.",
	};
};

const getDefaultMetadata = (
	library: RegistryId,
	component: string,
	role: Role | undefined,
) => ({
	props: {
		"data-trickroom-library": library,
		"data-trickroom-component": component,
		...(role ? { "data-trickroom-role": role } : {}),
	},
	children: role === "text" ? "" : [],
});

const getDesignMetadata = (designFileId: string, read: DesignFileRead) => ({
	id: designFileId,
	file: read.file,
	name: read.design.name,
	systemName: read.design.systemName ?? null,
	revision: read.revision,
});

const getNodeName = (node: DesignNode) => node.props["data-trickroom-name"];

const getChildIds = (node: DesignNode) =>
	Array.isArray(node.children) ? node.children.map((child) => child.id) : [];

const getTextPreview = (text: string) =>
	text.length <= 80 ? text : `${text.slice(0, 77)}...`;

const compactElementTree = (node: DesignNode): Record<string, unknown> => {
	const isText = typeof node.children === "string";

	return {
		id: node.id,
		name: getNodeName(node),
		library: node.props["data-trickroom-library"],
		component: node.props["data-trickroom-component"],
		role: node.props["data-trickroom-role"] ?? "default",
		...(isText
			? {
					textLength: node.children.length,
					textPreview: getTextPreview(node.children),
				}
			: {
					childIds: getChildIds(node),
					children: node.children.map(compactElementTree),
				}),
	};
};

const detailedElement = (node: DesignNode) => ({
	id: node.id,
	props: node.props,
	text: typeof node.children === "string" ? node.children : null,
	childIds: getChildIds(node),
});

const detailedSubtree = (
	node: DesignNode,
	depth: number | undefined,
	currentDepth = 0,
): Record<string, unknown> => {
	if (typeof node.children === "string") {
		return {
			...detailedElement(node),
			children: node.children,
			truncated: false,
		};
	}

	const childIds = getChildIds(node);
	const isTruncated = depth !== undefined && currentDepth >= depth;

	return {
		...detailedElement(node),
		children: isTruncated
			? []
			: node.children.map((child) =>
					detailedSubtree(child, depth, currentDepth + 1),
				),
		truncated: isTruncated && childIds.length > 0,
	};
};

const findElementContext = (
	design: TrickroomDesign,
	elementId: string,
): ElementContext | null => {
	const visit = (
		node: DesignNode,
		parent: DesignNode | null,
		index: number | null,
		rootIndex: number | null,
		siblingIds: string[],
	): ElementContext | null => {
		if (node.id === elementId) {
			return {
				element: node,
				parent,
				index,
				rootIndex,
				siblingIds,
			};
		}

		if (typeof node.children === "string") {
			return null;
		}

		const childSiblingIds = node.children.map((child) => child.id);
		for (const [childIndex, child] of node.children.entries()) {
			const found = visit(child, node, childIndex, null, childSiblingIds);
			if (found) {
				return found;
			}
		}

		return null;
	};

	const rootSiblingIds = design.boards.map((board) => board.id);
	for (const [rootIndex, root] of design.boards.entries()) {
		const found = visit(root, null, null, rootIndex, rootSiblingIds);
		if (found) {
			return found;
		}
	}

	return null;
};

const getSiblingContext = (context: ElementContext) => {
	const currentIndex = context.index ?? context.rootIndex ?? null;

	return {
		parentId: context.parent?.id ?? null,
		root: context.parent === null,
		index: currentIndex,
		rootIndex: context.rootIndex,
		siblingIds: context.siblingIds,
		previousSiblingId:
			currentIndex === null || currentIndex <= 0
				? null
				: context.siblingIds[currentIndex - 1],
		nextSiblingId:
			currentIndex === null || currentIndex >= context.siblingIds.length - 1
				? null
				: context.siblingIds[currentIndex + 1],
	};
};

const getElementContextOrThrow = (
	design: TrickroomDesign,
	elementId: string,
) => {
	const context = findElementContext(design, elementId);
	if (!context) {
		throw new Error(`Unknown element "${elementId}"`);
	}

	return context;
};

const summarizeDesignSystemReference = (
	context: TrickroomMcpServerContext,
	systemName: string | null | undefined,
) => {
	const normalizedSystemName = systemName ?? null;
	const configuredSystems = context.config.systems ?? {};
	const configuredCssPath =
		normalizedSystemName === null
			? undefined
			: configuredSystems[normalizedSystemName];

	return normalizedSystemName === null
		? null
		: {
				systemName: normalizedSystemName,
				configured: configuredCssPath !== undefined,
				...(configuredCssPath !== undefined
					? { cssPath: configuredCssPath }
					: {}),
			};
};

const validateElementReferences = (
	node: DesignNode,
	path: string,
	seenElementIds: Map<string, string>,
	issues: ValidationIssue[],
	componentUsage: Map<string, number>,
) => {
	const library = node.props["data-trickroom-library"];
	const component = node.props["data-trickroom-component"];
	const role = node.props["data-trickroom-role"];
	const componentKey = `${library}/${component}`;
	componentUsage.set(componentKey, (componentUsage.get(componentKey) ?? 0) + 1);

	const firstPath = seenElementIds.get(node.id);
	if (firstPath) {
		issues.push({
			severity: "error",
			code: "DUPLICATE_ELEMENT_ID",
			message: `Element id "${node.id}" is already used at ${firstPath}.`,
			path,
			elementId: node.id,
		});
	} else {
		seenElementIds.set(node.id, path);
	}

	if (!Object.hasOwn(registries, library)) {
		issues.push({
			severity: "error",
			code: "UNKNOWN_REGISTRY_LIBRARY",
			message: `Element references unknown registry "${library}".`,
			path,
			elementId: node.id,
		});
	} else {
		const registry = registries[library];
		if (!Object.hasOwn(registry, component)) {
			issues.push({
				severity: "error",
				code: "UNKNOWN_REGISTRY_COMPONENT",
				message: `Element references unknown component "${component}" in registry "${library}".`,
				path,
				elementId: node.id,
			});
		} else {
			const expectedRole = registry[component as keyof typeof registry].role;
			if (role !== expectedRole) {
				issues.push({
					severity: "error",
					code: "REGISTRY_ROLE_MISMATCH",
					message: `Element role does not match registry metadata for "${componentKey}".`,
					path,
					elementId: node.id,
				});
			}
		}
	}

	if (Array.isArray(node.children)) {
		for (const [childIndex, child] of node.children.entries()) {
			validateElementReferences(
				child,
				`${path}.children[${childIndex}]`,
				seenElementIds,
				issues,
				componentUsage,
			);
		}
	}
};

const describeComponent = (library: RegistryId, component: string) => {
	const registry = getRegistryOrThrow(library);
	if (!Object.hasOwn(registry, component)) {
		throw new Error(
			`Unknown component "${component}" in registry "${library}"`,
		);
	}

	const definition = registry[component as keyof typeof registry];
	const role = definition.role;

	return {
		library,
		component,
		role: role ?? "default",
		builtIn: true,
		readOnly: true,
		allowedChildren: getAllowedChildrenMetadata(role),
		defaults: getDefaultMetadata(library, component, role),
		supportedProps: [
			{
				name: "className",
				required: false,
				source: "instance",
				description: "Tailwind class string applied to this element instance.",
			},
			{
				name: "data-trickroom-name",
				required: true,
				source: "instance",
				description: "Human-readable layer name.",
			},
			{
				name: "data-trickroom-library",
				required: true,
				source: "registry-reference",
				fixedValue: library,
			},
			{
				name: "data-trickroom-component",
				required: true,
				source: "registry-reference",
				fixedValue: component,
			},
			...(role
				? [
						{
							name: "data-trickroom-role",
							required: true,
							source: "registry-reference",
							fixedValue: role,
						},
					]
				: []),
		],
	};
};

const readDesignFileForTool = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
) => {
	const service = createDesignFileService(context.projectRoot);
	return service.readDesignFile(service.getFileForUuid(designFileId));
};

const getDesignSystemPayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
) => {
	const read = await readDesignFileForTool(context, designFileId);
	const systemName = read.design.systemName ?? null;
	const configuredSystems = context.config.systems ?? {};
	const configuredCssPath = systemName
		? configuredSystems[systemName]
		: undefined;
	const storedTokens = systemName
		? await readDomainTokensReadonly(context.projectRoot, systemName)
		: null;

	return {
		designFile: {
			id: designFileId,
			file: read.file,
			name: read.design.name,
			revision: read.revision,
			systemName,
		},
		designSystem: systemName
			? {
					systemName,
					configured: configuredCssPath !== undefined,
					...(configuredCssPath !== undefined
						? { cssPath: configuredCssPath }
						: {}),
					tokenStorage: storedTokens
						? {
								available: true,
								version: storedTokens.version,
								cssPath: storedTokens.metadata.cssPath,
								syncedAt: storedTokens.metadata.syncedAt,
								tailwindBaselineVersion:
									storedTokens.metadata.tailwindBaselineVersion,
								reviewRequired: storedTokens.metadata.reviewRequired,
							}
						: {
								available: false,
							},
				}
			: null,
	};
};

const listDesignFilesPayload = async (context: TrickroomMcpServerContext) => {
	const service = createDesignFileService(context.projectRoot);
	const designFiles = await service.listDesignSummaries();

	return {
		projectName: context.config.name,
		projectRoot: context.projectRoot,
		designFiles: designFiles.map((designFile) => ({
			id: designFile.uuid,
			file: designFile.file,
			name: designFile.name,
			systemName: designFile.systemName ?? null,
			revision: designFile.revision,
		})),
	};
};

const readDesignFilePayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
) => {
	const read = await readDesignFileForTool(context, designFileId);

	return {
		designFile: getDesignMetadata(designFileId, read),
		designSystem: summarizeDesignSystemReference(
			context,
			read.design.systemName,
		),
		rootElementIds: read.design.boards.map((board) => board.id),
		elementTree: read.design.boards.map(compactElementTree),
	};
};

const readElementPayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	elementId: string,
) => {
	const read = await readDesignFileForTool(context, designFileId);
	const elementContext = getElementContextOrThrow(read.design, elementId);

	return {
		designFile: getDesignMetadata(designFileId, read),
		element: detailedElement(elementContext.element),
		context: getSiblingContext(elementContext),
	};
};

const readSubtreePayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	elementId: string,
	depth: number | undefined,
) => {
	const read = await readDesignFileForTool(context, designFileId);
	const elementContext = getElementContextOrThrow(read.design, elementId);

	return {
		designFile: getDesignMetadata(designFileId, read),
		elementId,
		depth: depth ?? null,
		context: getSiblingContext(elementContext),
		subtree: detailedSubtree(elementContext.element, depth),
	};
};

const validateDesignFilePayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
) => {
	const service = createDesignFileService(context.projectRoot);
	const read = await service.readJsonFile(service.getFileForUuid(designFileId));
	const issues: ValidationIssue[] = [];

	if (!isTrickroomDesign(read.value)) {
		return {
			designFile: {
				id: designFileId,
				file: read.file,
				revision: read.revision,
			},
			valid: false,
			issues: [
				{
					severity: "error",
					code: "INVALID_DESIGN_PAYLOAD",
					message: "File does not contain a valid Trickroom design payload.",
				},
			] satisfies ValidationIssue[],
		};
	}

	const design = read.value;
	const systemName = design.systemName ?? null;
	const configuredSystems = context.config.systems ?? {};
	if (systemName !== null && !Object.hasOwn(configuredSystems, systemName)) {
		issues.push({
			severity: "error",
			code: "UNKNOWN_DESIGN_SYSTEM",
			message: `Design references unconfigured design system "${systemName}".`,
			path: "systemName",
		});
	}

	const seenElementIds = new Map<string, string>();
	const componentUsage = new Map<string, number>();
	for (const [rootIndex, board] of design.boards.entries()) {
		validateElementReferences(
			board,
			`boards[${rootIndex}]`,
			seenElementIds,
			issues,
			componentUsage,
		);
	}

	const registryReferences = [...componentUsage.entries()]
		.map(([componentRef, count]) => {
			const [library, component] = componentRef.split("/");
			return { library, component, count };
		})
		.sort((a, b) =>
			a.library === b.library
				? a.component.localeCompare(b.component)
				: a.library.localeCompare(b.library),
		);

	return {
		designFile: {
			id: designFileId,
			file: read.file,
			name: design.name,
			systemName,
			revision: read.revision,
		},
		valid: issues.every((issue) => issue.severity !== "error"),
		issues,
		designSystem: summarizeDesignSystemReference(context, systemName),
		registryReferences,
		elementCount: seenElementIds.size,
		rootElementIds: design.boards.map((board) => board.id),
	};
};

export const createTrickroomMcpServer = (
	context: TrickroomMcpServerContext,
) => {
	if (!isMcpEnabled(context.config)) {
		throw new TrickroomProjectConfigError(
			"MCP_DISABLED",
			`MCP is disabled for project ${context.config.name}.`,
		);
	}

	const server = new McpServer(
		{
			name: "trickroom",
			version: "0.1.0",
		},
		{
			capabilities: {
				tools: {},
				prompts: {},
			},
			instructions:
				"Trickroom MCP exposes project-scoped design workspace metadata, registry discovery, design-system token discovery, and high-level design mutation tools. All mutation tools require an expectedRevision obtained from a prior read. On revision mismatch, re-read the design to get the current revision before retrying.",
		},
	);

	server.prompt(
		"edit_design_file",
		{
			designFileId: z.string().uuid().describe("Design file UUID to edit."),
		},
		({ designFileId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `I need to edit the Trickroom design file "${designFileId}". Please guide me through a safe edit workflow:

1. **Read Current State**: Start by calling 'readDesignFile' with designFileId "${designFileId}" to get the compact element tree and the current 'revision'.
2. **Discover Design System**: Call 'getDesignSystemForDesignFile' and 'listDesignTokens' to understand the linked design system and available Tailwind tokens.
3. **Explore Components**: Use 'listRegistries', 'listRegistryComponents', and 'describeRegistryComponent' to find valid components and their required props/roles.
4. **Plan Mutations**: Identify the elements to change.
5. **Execute Safely**:
   - For the FIRST mutation, use the 'revision' obtained in step 1 as 'expectedRevision'.
   - For every SUBSEQUENT mutation in a multi-step edit, you MUST use the 'newRevision' returned by the previous successful tool call (revision chaining).
   - If a tool returns 'REVISION_MISMATCH', do NOT guess. Call 'readDesignFile' again to get the NEW current revision, then retry your mutation with the updated 'expectedRevision'.
6. **Validate & Verify**: After all edits, call 'validateDesignFile' to ensure structural integrity and registry reference correctness. Finally, call 'readDesignFile' one last time to confirm the final state and get the latest revision.`,
					},
				},
			],
		}),
	);

	server.prompt(
		"add_component_to_design",
		{
			designFileId: z.string().uuid().describe("Design file UUID."),
			parentId: z
				.string()
				.optional()
				.describe("Target parent element ID. Omit to add at root."),
		},
		({ designFileId, parentId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `I want to add a new component to design file "${designFileId}"${parentId ? ` under parent "${parentId}"` : " at the root"}.

Workflow:
1. **Discovery**: Call 'listRegistryComponents' to see available components. Use 'describeRegistryComponent' to check 'role', 'allowedChildren', and 'supportedProps' for your chosen component.
2. **Context Check**: ${parentId ? `If 'parentId' is provided, call 'readElement' for "${parentId}"` : "If 'parentId' was provided, you would call 'readElement'"} to verify it is NOT a 'text' role element (which rejects children). If adding at the root, skip this check.
3. **Get Revision**: Call 'readDesignFile' to get the current 'revision'.
4. **Add Element**: Call 'addElement' with:
   - 'designFileId': "${designFileId}"
   - 'expectedRevision': [current revision]
   - 'parentId': ${parentId ? `"${parentId}"` : "null (to add at the root)"}
   - 'index': [chosen insertion index]
   - 'library' and 'component': [your choice]
   - 'name', 'className', 'text', and 'props' as needed.
5. **Handle Mismatch**: If 'REVISION_MISMATCH' occurs, re-read the design file and retry with the new revision.
6. **Verify**: Call 'readElement' on the new element ID returned by 'addElement' to confirm its properties and placement.`,
					},
				},
			],
		}),
	);

	server.prompt(
		"refactor_design_structure",
		{
			designFileId: z.string().uuid().describe("Design file UUID to refactor."),
		},
		({ designFileId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `I need to refactor the structure of design file "${designFileId}". This involves multiple moves, additions, or deletions.

Workflow for Multi-Step Refactoring:
1. **Full Read**: Call 'readDesignFile' to see the entire tree and get the initial 'revision'.
2. **Scoped Planning**: Use 'readSubtree' with a 'depth' to zoom in on complex areas you intend to refactor.
3. **Sequential Mutations**: Execute your changes one-by-one.
   - For the FIRST mutation, use the initial 'revision' as 'expectedRevision'.
   - For EVERY SUBSEQUENT mutation, you MUST use the 'newRevision' returned by the previous successful tool call.
4. **Concurrency Handling**: If ANY step returns 'REVISION_MISMATCH', you must stop, call 'readDesignFile' to synchronize your state and revision, then resume your refactor plan.
5. **Cleanup**: Use 'deleteElement' for any redundant wrappers or elements.
6. **Final Validation**: Call 'validateDesignFile' when the refactor is complete to ensure no duplicate IDs or invalid registry references were introduced.`,
					},
				},
			],
		}),
	);

	server.prompt(
		"explain_design_file",
		{
			designFileId: z.string().uuid().describe("Design file UUID to explain."),
		},
		({ designFileId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Please provide a technical explanation of design file "${designFileId}".

Discovery Steps (Read-Only):
1. **Structure**: Call 'readDesignFile' to summarize the boards, root elements, and the compact hierarchy.
2. **Health Check**: Call 'validateDesignFile' to identify any 'DUPLICATE_ELEMENT_ID', 'UNKNOWN_REGISTRY_COMPONENT', or 'UNKNOWN_DESIGN_SYSTEM' issues.
3. **Styling Context**: Call 'getDesignSystemForDesignFile' and 'listDesignTokens' to describe the styling baseline and available Tailwind tokens.
4. **Composition**: Summarize the 'registryReferences' and component roles used in the design.
5. **Synthesis**: Explain the design's purpose, identify likely points for expansion or editing, and highlight any broken references that need fixing.`,
					},
				},
			],
		}),
	);

	server.prompt(
		"validate_design_changes",
		{
			designFileId: z.string().uuid().describe("Design file UUID to validate."),
		},
		({ designFileId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Please perform a post-edit validation of design file "${designFileId}".

Workflow:
1. **Technical Validation**: Call 'validateDesignFile'.
2. **Analyze Issues**: If 'valid' is false, review the 'issues' list. If the design is already clean, do not perform any unnecessary mutations.
3. **Execute Fixes Deliberately**:
   - If fixes are needed, start by calling 'readDesignFile' to get the current 'revision'.
   - Pass this 'revision' as 'expectedRevision' to mutation tools (e.g., 'deleteElement' or 'moveElement' to resolve 'DUPLICATE_ELEMENT_ID').
   - If a fix returns 'REVISION_MISMATCH', re-read the design and retry the fix with the new current revision.
4. **Final State Sync**: After all fixes are applied, call 'readDesignFile' to get the final clean 'revision' and confirm the structure.
5. **Final Report**: Confirm that the design is technically sound and ready for preview.`,
					},
				},
			],
		}),
	);

	server.registerTool(
		"trickroom_project_info",
		{
			title: "Project Info",
			description:
				"Return the current Trickroom project root, config path, and configured system names.",
			annotations: readOnlyClosedWorldAnnotations,
		},
		async () => createProjectInfoResult(context),
	);

	server.registerTool(
		"listDesignFiles",
		{
			title: "List Design Files",
			description:
				"List project-scoped Trickroom design files with UUID handles, file metadata, names, design-system references, and revisions.",
			annotations: readOnlyClosedWorldAnnotations,
		},
		async () => createJsonResult(await listDesignFilesPayload(context)),
	);

	server.registerTool(
		"readDesignFile",
		{
			title: "Read Design File",
			description:
				"Read design metadata, design-system reference, root element IDs, and a compact element tree for one design file.",
			inputSchema: {
				designFileId: z.string().uuid().describe("Design file UUID."),
			},
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId }) =>
			createJsonResult(await readDesignFilePayload(context, designFileId)),
	);

	server.registerTool(
		"readElement",
		{
			title: "Read Element",
			description:
				"Read one full design element with props, text or child IDs, and parent/sibling context.",
			inputSchema: {
				designFileId: z.string().uuid().describe("Design file UUID."),
				elementId: z.string().min(1).describe("Element ID inside the design."),
			},
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, elementId }) =>
			createJsonResult(
				await readElementPayload(context, designFileId, elementId),
			),
	);

	server.registerTool(
		"readSubtree",
		{
			title: "Read Subtree",
			description:
				"Read a detailed element subtree rooted at the selected element.",
			inputSchema: {
				designFileId: z.string().uuid().describe("Design file UUID."),
				elementId: z.string().min(1).describe("Element ID inside the design."),
				depth: z
					.number()
					.int()
					.min(0)
					.max(20)
					.optional()
					.describe("Optional maximum descendant depth to include."),
			},
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, elementId, depth }) =>
			createJsonResult(
				await readSubtreePayload(context, designFileId, elementId, depth),
			),
	);

	server.registerTool(
		"validateDesignFile",
		{
			title: "Validate Design File",
			description:
				"Validate an existing design file without mutation, including payload integrity, duplicate element IDs, registry references, and design-system references.",
			inputSchema: {
				designFileId: z.string().uuid().describe("Design file UUID."),
			},
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId }) =>
			createJsonResult(await validateDesignFilePayload(context, designFileId)),
	);

	server.registerTool(
		"listRegistries",
		{
			title: "List Registries",
			description:
				"List read-only component registries available to this Trickroom project.",
			annotations: readOnlyClosedWorldAnnotations,
		},
		async () =>
			createJsonResult({
				registries: getRegistryIds().map((library) => ({
					library,
					builtIn: true,
					readOnly: true,
					componentCount: getComponentIds(library).length,
					components: getComponentIds(library),
				})),
			}),
	);

	server.registerTool(
		"listRegistryComponents",
		{
			title: "List Registry Components",
			description:
				"List components in a registry, including compact role and child-behavior metadata.",
			inputSchema: {
				library: z
					.string()
					.optional()
					.describe("Registry library id. Omit to list all registries."),
			},
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ library }) => {
			const selectedLibraries =
				library === undefined ? getRegistryIds() : [library as RegistryId];

			return createJsonResult({
				registries: selectedLibraries.map((selectedLibrary) => {
					getRegistryOrThrow(selectedLibrary);
					return {
						library: selectedLibrary,
						components: getComponentIds(selectedLibrary).map((component) => {
							const summary = describeComponent(selectedLibrary, component);
							return {
								library: summary.library,
								component: summary.component,
								role: summary.role,
								allowedChildren: summary.allowedChildren,
								defaults: summary.defaults,
							};
						}),
					};
				}),
			});
		},
	);

	server.registerTool(
		"describeRegistryComponent",
		{
			title: "Describe Registry Component",
			description:
				"Describe one read-only registry component, including role, allowed children, defaults, and supported props.",
			inputSchema: {
				library: z.string().min(1).describe("Registry library id."),
				component: z.string().min(1).describe("Registry component id."),
			},
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ library, component }) =>
			createJsonResult(describeComponent(library as RegistryId, component)),
	);

	server.registerTool(
		"getDesignSystemForDesignFile",
		{
			title: "Get Design System For Design File",
			description:
				"Resolve the design system linked from a design file and report configured CSS path plus token storage metadata.",
			inputSchema: {
				designFileId: z.string().min(1).describe("Design file UUID."),
			},
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId }) =>
			createJsonResult(await getDesignSystemPayload(context, designFileId)),
	);

	server.registerTool(
		"listDesignTokens",
		{
			title: "List Design Tokens",
			description:
				"List stored design tokens for the design system linked to a design file.",
			inputSchema: {
				designFileId: z.string().min(1).describe("Design file UUID."),
			},
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId }) => {
			const designSystemPayload = await getDesignSystemPayload(
				context,
				designFileId,
			);
			const systemName =
				designSystemPayload.designSystem === null
					? null
					: designSystemPayload.designSystem.systemName;
			const storedTokens = systemName
				? await readDomainTokensReadonly(context.projectRoot, systemName)
				: null;
			const colorDomain = storedTokens?.domains.color;

			return createJsonResult({
				...designSystemPayload,
				storageStatus:
					systemName === null
						? "not_linked"
						: storedTokens
							? "stored"
							: "not_stored",
				tokens: colorDomain
					? Object.entries(colorDomain.tokens).map(([name, value]) => ({
							domain: "color",
							category: getCategoryForTokenName(name),
							name,
							value,
							overrideConfirmed: colorDomain.overrides.includes(name),
							syncedAt: storedTokens.metadata.syncedAt,
							reviewRequired: storedTokens.metadata.reviewRequired,
						}))
					: [],
				domains: colorDomain
					? {
							color: {
								tokenCount: Object.keys(colorDomain.tokens).length,
								overrides: colorDomain.overrides,
								baselineDiff: colorDomain.baselineDiff,
							},
						}
					: {},
			});
		},
	);

	const mutationAnnotations = {
		readOnlyHint: false,
		openWorldHint: false,
	} as const;

	const destructiveMutationAnnotations = {
		...mutationAnnotations,
		destructiveHint: true,
		idempotentHint: false,
	} as const;

	const createRevisionMismatchResult = (
		currentRevision: string,
		expectedRevision: string,
	): CallToolResult => {
		const payload = {
			status: "REVISION_MISMATCH",
			currentRevision,
			expectedRevision,
			message:
				"The design file was modified since your last read. Re-read the design file to get the current revision, then retry.",
			suggestedReads: ["readDesignFile", "readElement"],
		};
		return {
			content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
			structuredContent: payload,
			isError: true,
		};
	};

	const createInvalidOperationResult = (
		error: DesignTransformError,
	): CallToolResult => {
		const payload = {
			status: "INVALID_OPERATION",
			code: error.code,
			message: error.message,
		};
		return {
			content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
			structuredContent: payload,
			isError: true,
		};
	};

	const getCompactElementSummary = (design: TrickroomDesign, elementId: string) => {
		const ctx = findElementContext(design, elementId);
		if (!ctx) return null;
		const node = ctx.element;
		const isText = typeof node.children === "string";
		return {
			id: node.id,
			name: node.props["data-trickroom-name"],
			library: node.props["data-trickroom-library"],
			component: node.props["data-trickroom-component"],
			role: node.props["data-trickroom-role"] ?? "default",
			...(isText
				? {
						textLength: node.children.length,
						textPreview: getTextPreview(node.children),
					}
				: {
						childIds: getChildIds(node),
					}),
		};
	};

	const getMutationContext = (design: TrickroomDesign, elementId: string) => {
		const ctx = findElementContext(design, elementId);
		if (!ctx) return null;
		return getSiblingContext(ctx);
	};

	const withMutationErrorHandling = async (
		fn: () => Promise<CallToolResult>,
	): Promise<CallToolResult> => {
		try {
			return await fn();
		} catch (error) {
			if (error instanceof DesignTransformError) {
				return createInvalidOperationResult(error);
			}
			throw error;
		}
	};

	server.registerTool(
		"renameDesignFile",
		{
			title: "Rename Design File",
			description:
				"Rename a design file by updating its design-level name. Requires expectedRevision from a prior read.",
			inputSchema: {
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe("Current revision from a prior read. Required for safe writes."),
				name: z.string().min(1).describe("New design file name."),
			},
			annotations: destructiveMutationAnnotations,
		},
		async ({ designFileId, expectedRevision, name }) => {
			const service = createDesignFileService(context.projectRoot);
			const file = service.getFileForUuid(designFileId);
			const read = await service.readDesignFile(file);

			if (read.revision !== expectedRevision) {
				return createRevisionMismatchResult(read.revision, expectedRevision);
			}

			let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
			try {
				write = await service.writeDesignFile(
					file,
					{ ...read.design, name },
					{ expectedRevision },
				);
			} catch (error) {
				if (
					error instanceof DesignFileServiceError &&
					error.code === "REVISION_MISMATCH"
				) {
					const raceRead = await service.readJsonFile(file);
					return createRevisionMismatchResult(
						raceRead.revision,
						expectedRevision,
					);
				}
				throw error;
			}

			return createJsonResult({
				status: "success",
				newRevision: write.revision,
				designFile: {
					id: designFileId,
					file: write.file,
					name: write.design.name,
					systemName: write.design.systemName ?? null,
					revision: write.revision,
				},
				warnings: [],
			});
		},
	);

	server.registerTool(
		"addElement",
		{
			title: "Add Element",
			description:
				"Create a new registry element inside a design file. Requires expectedRevision from a prior read.",
			inputSchema: {
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe("Current revision from a prior read. Required for safe writes."),
				parentId: z
					.string()
					.min(1)
					.nullable()
					.describe("Parent element ID, or null to add at the design root."),
				index: z
					.number()
					.int()
					.min(0)
					.describe("Insertion index within the parent's children or the root."),
				library: z.string().min(1).describe("Registry library id, e.g. 'trickroom'."),
				component: z
					.string()
					.min(1)
					.describe("Registry component id, e.g. 'container' or 'text'."),
				name: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Layer name (data-trickroom-name). Shortcut — takes precedence over props[\"data-trickroom-name\"] when both are supplied. Defaults to the component id.",
					),
				className: z
					.string()
					.optional()
					.describe(
						"Tailwind class string. Shortcut — takes precedence over props.className when both are supplied.",
					),
				text: z
					.string()
					.optional()
					.describe(
						"Initial text content for text role elements. Defaults to 'Text'.",
					),
				props: z
					.record(z.string(), z.string())
					.optional()
					.describe(
						"Optional extra instance props. Allowed keys: className, data-trickroom-name. Registry-reference keys (data-trickroom-library, data-trickroom-component, data-trickroom-role) and unknown keys are rejected with INVALID_PROP_KEY.",
					),
			},
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			designFileId,
			expectedRevision,
			parentId,
			index,
			library,
			component,
			name,
			className,
			text,
			props,
		}) => {
			return withMutationErrorHandling(async () => {
				const service = createDesignFileService(context.projectRoot);
				const file = service.getFileForUuid(designFileId);
				const read = await service.readDesignFile(file);

				if (read.revision !== expectedRevision) {
					return createRevisionMismatchResult(read.revision, expectedRevision);
				}

				const result = applyAddElement(read.design, {
					parentId,
					index,
					library,
					component,
					name,
					className,
					text,
					props,
				});

				let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
				try {
					write = await service.writeDesignFile(file, result.design, {
						expectedRevision,
					});
				} catch (error) {
					if (
						error instanceof DesignFileServiceError &&
						error.code === "REVISION_MISMATCH"
					) {
						const raceRead = await service.readJsonFile(file);
						return createRevisionMismatchResult(
							raceRead.revision,
							expectedRevision,
						);
					}
					throw error;
				}

				const element = getCompactElementSummary(result.design, result.changedElementId);
				const elementContext = getMutationContext(result.design, result.changedElementId);

				return createJsonResult({
					status: "success",
					newRevision: write.revision,
					changedElement: element,
					context: elementContext,
					warnings: [],
				});
			});
		},
	);

	server.registerTool(
		"updateElementProps",
		{
			title: "Update Element Props",
			description:
				"Update allowed instance props on a design element: name and/or className. Registry-reference props (library, component, role) cannot be changed.",
			inputSchema: {
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe("Current revision from a prior read. Required for safe writes."),
				elementId: z.string().min(1).describe("Element ID to update."),
				name: z
					.string()
					.min(1)
					.optional()
					.describe("New layer name for this element."),
				className: z
					.string()
					.optional()
					.describe("New Tailwind class string. Pass empty string to clear."),
			},
			annotations: destructiveMutationAnnotations,
		},
		async ({ designFileId, expectedRevision, elementId, name, className }) => {
			return withMutationErrorHandling(async () => {
				const service = createDesignFileService(context.projectRoot);
				const file = service.getFileForUuid(designFileId);
				const read = await service.readDesignFile(file);

				if (read.revision !== expectedRevision) {
					return createRevisionMismatchResult(read.revision, expectedRevision);
				}

				const result = applyUpdateElementProps(read.design, {
					elementId,
					name,
					className,
				});

				let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
				try {
					write = await service.writeDesignFile(file, result.design, {
						expectedRevision,
					});
				} catch (error) {
					if (
						error instanceof DesignFileServiceError &&
						error.code === "REVISION_MISMATCH"
					) {
						const raceRead = await service.readJsonFile(file);
						return createRevisionMismatchResult(
							raceRead.revision,
							expectedRevision,
						);
					}
					throw error;
				}

				return createJsonResult({
					status: "success",
					newRevision: write.revision,
					changedElement: getCompactElementSummary(result.design, result.changedElementId),
					context: getMutationContext(result.design, result.changedElementId),
					warnings: [],
				});
			});
		},
	);

	server.registerTool(
		"updateElementText",
		{
			title: "Update Element Text",
			description:
				"Update the text content of a text role element. Only valid for elements with role 'text'.",
			inputSchema: {
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe("Current revision from a prior read. Required for safe writes."),
				elementId: z
					.string()
					.min(1)
					.describe("Text role element ID to update."),
				text: z.string().describe("New text content."),
			},
			annotations: destructiveMutationAnnotations,
		},
		async ({ designFileId, expectedRevision, elementId, text }) => {
			return withMutationErrorHandling(async () => {
				const service = createDesignFileService(context.projectRoot);
				const file = service.getFileForUuid(designFileId);
				const read = await service.readDesignFile(file);

				if (read.revision !== expectedRevision) {
					return createRevisionMismatchResult(read.revision, expectedRevision);
				}

				const result = applyUpdateElementText(read.design, { elementId, text });

				let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
				try {
					write = await service.writeDesignFile(file, result.design, {
						expectedRevision,
					});
				} catch (error) {
					if (
						error instanceof DesignFileServiceError &&
						error.code === "REVISION_MISMATCH"
					) {
						const raceRead = await service.readJsonFile(file);
						return createRevisionMismatchResult(
							raceRead.revision,
							expectedRevision,
						);
					}
					throw error;
				}

				return createJsonResult({
					status: "success",
					newRevision: write.revision,
					changedElement: getCompactElementSummary(result.design, result.changedElementId),
					context: getMutationContext(result.design, result.changedElementId),
					warnings: [],
				});
			});
		},
	);

	server.registerTool(
		"moveElement",
		{
			title: "Move Element",
			description:
				"Move a design element to a new parent or position. Rejects cycles, text-role parents, and missing targets.",
			inputSchema: {
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe("Current revision from a prior read. Required for safe writes."),
				elementId: z.string().min(1).describe("Element ID to move."),
				targetParentId: z
					.string()
					.min(1)
					.nullable()
					.describe("New parent element ID, or null to move to the design root."),
				index: z
					.number()
					.int()
					.min(0)
					.describe("Insertion index within the target parent's children or the root."),
			},
			annotations: destructiveMutationAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			elementId,
			targetParentId,
			index,
		}) => {
			return withMutationErrorHandling(async () => {
				const service = createDesignFileService(context.projectRoot);
				const file = service.getFileForUuid(designFileId);
				const read = await service.readDesignFile(file);

				if (read.revision !== expectedRevision) {
					return createRevisionMismatchResult(read.revision, expectedRevision);
				}

				const result = applyMoveElement(read.design, {
					elementId,
					targetParentId,
					index,
				});

				let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
				try {
					write = await service.writeDesignFile(file, result.design, {
						expectedRevision,
					});
				} catch (error) {
					if (
						error instanceof DesignFileServiceError &&
						error.code === "REVISION_MISMATCH"
					) {
						const raceRead = await service.readJsonFile(file);
						return createRevisionMismatchResult(
							raceRead.revision,
							expectedRevision,
						);
					}
					throw error;
				}

				return createJsonResult({
					status: "success",
					newRevision: write.revision,
					changedElement: getCompactElementSummary(result.design, result.changedElementId),
					context: getMutationContext(result.design, result.changedElementId),
					warnings: [],
				});
			});
		},
	);

	server.registerTool(
		"deleteElement",
		{
			title: "Delete Element",
			description:
				"Delete a design element and all its descendants. This operation cannot be undone.",
			inputSchema: {
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe("Current revision from a prior read. Required for safe writes."),
				elementId: z.string().min(1).describe("Element ID to delete."),
			},
			annotations: destructiveMutationAnnotations,
		},
		async ({ designFileId, expectedRevision, elementId }) => {
			return withMutationErrorHandling(async () => {
				const service = createDesignFileService(context.projectRoot);
				const file = service.getFileForUuid(designFileId);
				const read = await service.readDesignFile(file);

				if (read.revision !== expectedRevision) {
					return createRevisionMismatchResult(read.revision, expectedRevision);
				}

				const originalContext = getMutationContext(read.design, elementId);

				const result = applyDeleteElement(read.design, { elementId });

				let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
				try {
					write = await service.writeDesignFile(file, result.design, {
						expectedRevision,
					});
				} catch (error) {
					if (
						error instanceof DesignFileServiceError &&
						error.code === "REVISION_MISMATCH"
					) {
						const raceRead = await service.readJsonFile(file);
						return createRevisionMismatchResult(
							raceRead.revision,
							expectedRevision,
						);
					}
					throw error;
				}

				const parentSiblings =
					originalContext?.parentId !== null && originalContext?.parentId
						? getMutationContext(result.design, originalContext.parentId)
						: null;

				return createJsonResult({
					status: "success",
					newRevision: write.revision,
					deletedElementId: result.changedElementId,
					deletedCount: result.deletedIds.length,
					context: {
						wasRoot: originalContext?.root ?? false,
						parentId: originalContext?.parentId ?? null,
						parentContext: parentSiblings,
					},
					warnings: [],
				});
			});
		},
	);

	return server;
};
