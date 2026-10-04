import { z } from "zod";
import { DesignTransformError } from "../../services/design-transform-service";
import { listDesignSystems } from "../../utils/design-system-store";
import {
	addMemoryNote,
	deleteMemoryNote,
	MEMORY_CATEGORIES,
	type MemoryCategory,
	type MemoryScope,
	readMemoryManifest,
	summarizeMemoryManifest,
	updateMemoryNote,
} from "../../utils/memory-manifest-service";
import {
	collectMemoryReferenceWarnings,
	listMemoryReferenceTargets,
	MEMORY_REFERENCE_TYPES,
	type MemoryReferenceType,
	resolveMemoryNoteReferences,
} from "../../utils/memory-references";
import {
	appendMcpAuditLog,
	assertCanReadDesignFile,
	assertCanWriteProject,
	getMcpPolicy,
	type McpPolicy,
} from "../governance";
import { assertConfiguredSystem } from "../payloads/design-system";
import { getProjectReference } from "../payloads/project";
import type { TrickroomMcpServerContext } from "../server-types";
import {
	destructiveMutationAnnotations,
	mutationAnnotations,
	readOnlyClosedWorldAnnotations,
} from "./annotations";
import type { McpToolContext } from "./context";
import { createJsonResult, createToolErrorResult } from "./results";
import { withProjectScopedInput } from "./schemas";

export const registerMemoryTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	const memoryCategorySchema = z
		.enum([...MEMORY_CATEGORIES] as [MemoryCategory, ...MemoryCategory[]])
		.describe(
			"Note category. One of: intent, usage, conventions, constraints, decision, todo.",
		);

	const MEMORY_SCOPE_ACCEPTED_SHAPES = [
		'{ "kind": "project" }',
		'{ "kind": "system", "systemName": "<system name or id>" }',
		'{ "kind": "design", "designFileId": "<design uuid>" }',
		'"project"',
		'"system:<system name or id>"',
		'"design:<design uuid>"',
	];

	// Lenient on purpose: agents routinely send "project", { systemId }, or
	// { kind: "design", id }. Normalization and errors live in
	// normalizeMemoryScopeInput so failures can list the accepted shapes.
	const memoryScopeSchema = z
		.union([
			z.string().min(1),
			z
				.object({
					kind: z.enum(["system", "design", "project"]).optional(),
					systemName: z
						.string()
						.min(1)
						.optional()
						.describe("Configured design system name or id."),
					designFileId: z
						.string()
						.min(1)
						.optional()
						.describe("Design file UUID."),
				})
				.passthrough(),
		])
		.describe(
			`Memory owner scope: a system, a design file, or the whole project. Accepted shapes: ${MEMORY_SCOPE_ACCEPTED_SHAPES.join(" | ")}. systemId/name are accepted for systemName and designId/id for designFileId; kind may be omitted when systemName or designFileId is given, and a system scope without a name uses the project's only configured system. Reference tokens like {{design:<uuid>}} or {{component:<systemId>/<componentId>}} may be embedded in note bodies.`,
		);

	type MemoryScopeInput = z.infer<typeof memoryScopeSchema>;

	type NormalizedMemoryScopeInput =
		| { kind: "system"; systemName?: string }
		| { kind: "design"; designFileId: string }
		| { kind: "project" };

	const invalidMemoryScope = (reason: string, received: unknown) =>
		new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			`Invalid memory scope: ${reason} Accepted shapes: ${MEMORY_SCOPE_ACCEPTED_SHAPES.join(" | ")}.`,
			{
				acceptedScopeShapes: MEMORY_SCOPE_ACCEPTED_SHAPES,
				receivedScope: received,
			},
		);

	const pickString = (record: Record<string, unknown>, keys: string[]) => {
		for (const key of keys) {
			const value = record[key];
			if (typeof value === "string" && value.trim().length > 0) {
				return value.trim();
			}
		}
		return undefined;
	};

	const normalizeMemoryScopeInput = (
		scopeInput: MemoryScopeInput,
	): NormalizedMemoryScopeInput => {
		let record: Record<string, unknown>;
		if (typeof scopeInput === "string") {
			const [kind, ...rest] = scopeInput.trim().split(":");
			const value = rest.join(":").trim();
			record = {
				kind: kind.trim().toLowerCase(),
				...(value ? { id: value } : {}),
			};
		} else {
			record = scopeInput as Record<string, unknown>;
		}

		const systemName = pickString(record, [
			"systemName",
			"systemId",
			"system",
			...(record.kind === "system" ? ["name", "id"] : []),
		]);
		const designFileId = pickString(record, [
			"designFileId",
			"designId",
			"design",
			...(record.kind === "design" ? ["id"] : []),
		]);
		const kind =
			typeof record.kind === "string"
				? record.kind
				: systemName !== undefined
					? "system"
					: designFileId !== undefined
						? "design"
						: undefined;

		if (kind === "project") {
			return { kind: "project" };
		}
		if (kind === "system") {
			return { kind: "system", ...(systemName ? { systemName } : {}) };
		}
		if (kind === "design") {
			if (designFileId === undefined) {
				throw invalidMemoryScope(
					"a design scope needs designFileId.",
					scopeInput,
				);
			}
			if (!z.string().uuid().safeParse(designFileId).success) {
				throw invalidMemoryScope(
					`designFileId "${designFileId}" is not a design file UUID.`,
					scopeInput,
				);
			}
			return { kind: "design", designFileId };
		}
		throw invalidMemoryScope(
			kind === undefined
				? "kind is missing."
				: `unknown kind "${String(kind)}".`,
			scopeInput,
		);
	};

	const resolveMemoryScope = async (
		context: TrickroomMcpServerContext,
		policy: McpPolicy,
		rawScopeInput: MemoryScopeInput,
	): Promise<{ scope: MemoryScope; reference: Record<string, unknown> }> => {
		const scopeInput = normalizeMemoryScopeInput(rawScopeInput);
		if (scopeInput.kind === "system") {
			let systemName = scopeInput.systemName;
			if (systemName === undefined) {
				const systems = await listDesignSystems(context.projectRoot);
				if (systems.length !== 1) {
					throw new DesignTransformError(
						"INVALID_OPERATION_PARAMETERS",
						`Invalid memory scope: a system scope needs systemName when the project has ${systems.length} configured systems. Accepted shapes: ${MEMORY_SCOPE_ACCEPTED_SHAPES.join(" | ")}.`,
						{
							acceptedScopeShapes: MEMORY_SCOPE_ACCEPTED_SHAPES,
							receivedScope: rawScopeInput,
							availableSystems: systems.map((entry) => ({
								systemId: entry.manifest.systemId,
								systemName: entry.manifest.systemName,
							})),
						},
					);
				}
				systemName = systems[0].manifest.systemId;
			}
			const system = await assertConfiguredSystem(context, systemName);
			return {
				scope: { kind: "system", systemHandle: system.manifest.systemId },
				reference: {
					kind: "system",
					systemId: system.manifest.systemId,
					systemName: system.manifest.systemName,
				},
			};
		}
		if (scopeInput.kind === "design") {
			assertCanReadDesignFile(policy, scopeInput.designFileId);
			return {
				scope: { kind: "design", designId: scopeInput.designFileId },
				reference: { kind: "design", designFileId: scopeInput.designFileId },
			};
		}
		return { scope: { kind: "project" }, reference: { kind: "project" } };
	};

	const safeMemoryReferenceWarnings = async (
		context: TrickroomMcpServerContext,
		memoryScope: MemoryScope,
		body: string,
	) => {
		try {
			return await collectMemoryReferenceWarnings(
				context.projectRoot,
				memoryScope,
				body,
			);
		} catch {
			return [];
		}
	};

	const auditMemoryWrite = async (
		context: TrickroomMcpServerContext,
		toolName: string,
		memoryScope: MemoryScope,
		expectedRevision: string | null,
		resultingRevision: string | null,
	) => {
		await appendMcpAuditLog(context, {
			toolName,
			operation: toolName,
			projectRoot: context.projectRoot,
			designFileId: memoryScope.kind === "design" ? memoryScope.designId : null,
			expectedRevision,
			resultingRevision,
			success: true,
			status: "success",
		});
	};

	const enrichMemoryNotes = async (
		context: TrickroomMcpServerContext,
		memoryScope: MemoryScope,
		notes: import("../../utils/memory-manifest-service.types").MemoryNote[],
		resolveReferences: boolean,
	) => {
		if (!resolveReferences) {
			return notes;
		}
		return Promise.all(
			notes.map(async (note) => ({
				...note,
				references: await resolveMemoryNoteReferences(
					context.projectRoot,
					memoryScope,
					note.body,
				),
			})),
		);
	};

	const enrichMemoryNote = async (
		context: TrickroomMcpServerContext,
		memoryScope: MemoryScope,
		note: import("../../utils/memory-manifest-service.types").MemoryNote,
		resolveReferences: boolean,
	) => {
		if (!resolveReferences) {
			return note;
		}
		return {
			...note,
			references: await resolveMemoryNoteReferences(
				context.projectRoot,
				memoryScope,
				note.body,
			),
		};
	};

	server.registerTool(
		"listMemoryNotes",
		{
			title: "List Memory Notes",
			description:
				"List durable memory/steering notes for a system, design, or project scope. Check for relevant notes before authoring or explaining work in that domain.",
			inputSchema: withProjectScopedInput({
				scope: memoryScopeSchema,
				resolveReferences: z
					.boolean()
					.optional()
					.describe(
						"When true, attach per-note reference resolution for embedded {{type:id}} tokens.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ scope, resolveReferences, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const { scope: memoryScope, reference } = await resolveMemoryScope(
					context,
					policy,
					scope,
				);
				const read = await readMemoryManifest(context.projectRoot, memoryScope);
				const summary = summarizeMemoryManifest(read.manifest);
				const notes = await enrichMemoryNotes(
					context,
					memoryScope,
					Object.values(read.manifest.notes),
					resolveReferences === true,
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					scope: reference,
					revision: read.revision,
					exists: read.exists,
					summary,
					notes,
				});
			}),
	);

	server.registerTool(
		"getMemoryNote",
		{
			title: "Get Memory Note",
			description:
				"Read one memory note by id from a system, design, or project scope.",
			inputSchema: withProjectScopedInput({
				scope: memoryScopeSchema,
				noteId: z.string().min(1).describe("Memory note id."),
				resolveReferences: z
					.boolean()
					.optional()
					.describe(
						"When true, attach reference resolution for embedded {{type:id}} tokens in the note body.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ scope, noteId, resolveReferences, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const { scope: memoryScope, reference } = await resolveMemoryScope(
					context,
					policy,
					scope,
				);
				const read = await readMemoryManifest(context.projectRoot, memoryScope);
				const note = read.manifest.notes[noteId];
				if (!note) {
					return createToolErrorResult(
						context,
						"NOTE_NOT_FOUND",
						`Memory note "${noteId}" was not found.`,
						{ scope: reference, revision: read.revision },
					);
				}
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					scope: reference,
					revision: read.revision,
					note: await enrichMemoryNote(
						context,
						memoryScope,
						note,
						resolveReferences === true,
					),
				});
			}),
	);

	server.registerTool(
		"addMemoryNote",
		{
			title: "Add Memory Note",
			description:
				"Add one durable memory/steering note to a system, design, or project scope. Bodies are markdown and may embed reference tokens like {{design:<uuid>}}.",
			inputSchema: withProjectScopedInput({
				scope: memoryScopeSchema,
				category: memoryCategorySchema,
				body: z.string().min(1).describe("Markdown note body."),
				title: z.string().min(1).optional().describe("Optional note title."),
				tags: z.array(z.string().min(1)).optional().describe("Optional tags."),
				pinned: z.boolean().optional().describe("Pin the note to the top."),
				order: z.number().optional().describe("Optional manual sort order."),
				authorLabel: z
					.string()
					.min(1)
					.optional()
					.describe("Optional human-readable author label for attribution."),
			}),
			annotations: mutationAnnotations,
		},
		async ({
			scope,
			category,
			body,
			title,
			tags,
			pinned,
			order,
			authorLabel,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const { scope: memoryScope, reference } = await resolveMemoryScope(
					context,
					policy,
					scope,
				);
				const { read, note } = await addMemoryNote(
					context.projectRoot,
					memoryScope,
					{
						category,
						body,
						title,
						tags,
						pinned,
						order,
						author: {
							kind: "agent",
							...(authorLabel ? { label: authorLabel } : {}),
						},
					},
				);
				await auditMemoryWrite(
					context,
					"addMemoryNote",
					memoryScope,
					null,
					read.revision,
				);
				const referenceWarnings = await safeMemoryReferenceWarnings(
					context,
					memoryScope,
					note.body,
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					scope: reference,
					newRevision: read.revision,
					note,
					referenceWarnings,
				});
			}),
	);

	server.registerTool(
		"updateMemoryNote",
		{
			title: "Update Memory Note",
			description:
				"Update one memory note's fields. Requires the current expectedRevision from a prior read.",
			inputSchema: withProjectScopedInput({
				scope: memoryScopeSchema,
				noteId: z.string().min(1).describe("Memory note id to update."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe("Current memory manifest revision from a prior read."),
				category: memoryCategorySchema.optional(),
				body: z
					.string()
					.min(1)
					.optional()
					.describe("Replacement markdown body."),
				title: z
					.string()
					.nullable()
					.optional()
					.describe("Replacement title; null clears it."),
				tags: z
					.array(z.string().min(1))
					.nullable()
					.optional()
					.describe("Replacement tags; null or empty clears them."),
				pinned: z.boolean().nullable().optional(),
				order: z.number().nullable().optional(),
				authorLabel: z.string().min(1).optional(),
			}),
			annotations: mutationAnnotations,
		},
		async ({
			scope,
			noteId,
			expectedRevision,
			category,
			body,
			title,
			tags,
			pinned,
			order,
			authorLabel,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const { scope: memoryScope, reference } = await resolveMemoryScope(
					context,
					policy,
					scope,
				);
				const { read, note } = await updateMemoryNote(
					context.projectRoot,
					memoryScope,
					noteId,
					{
						...(category !== undefined ? { category } : {}),
						...(body !== undefined ? { body } : {}),
						...(title !== undefined ? { title } : {}),
						...(tags !== undefined ? { tags } : {}),
						...(pinned !== undefined ? { pinned } : {}),
						...(order !== undefined ? { order } : {}),
						...(authorLabel
							? { author: { kind: "agent", label: authorLabel } }
							: {}),
					},
					{ expectedRevision },
				);
				await auditMemoryWrite(
					context,
					"updateMemoryNote",
					memoryScope,
					expectedRevision,
					read.revision,
				);
				const referenceWarnings = await safeMemoryReferenceWarnings(
					context,
					memoryScope,
					note.body,
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					scope: reference,
					newRevision: read.revision,
					note,
					referenceWarnings,
				});
			}),
	);

	server.registerTool(
		"deleteMemoryNote",
		{
			title: "Delete Memory Note",
			description:
				"Delete one memory note. Requires the current expectedRevision from a prior read.",
			inputSchema: withProjectScopedInput({
				scope: memoryScopeSchema,
				noteId: z.string().min(1).describe("Memory note id to delete."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe("Current memory manifest revision from a prior read."),
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ scope, noteId, expectedRevision, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const { scope: memoryScope, reference } = await resolveMemoryScope(
					context,
					policy,
					scope,
				);
				const read = await deleteMemoryNote(
					context.projectRoot,
					memoryScope,
					noteId,
					{ expectedRevision },
				);
				await auditMemoryWrite(
					context,
					"deleteMemoryNote",
					memoryScope,
					expectedRevision,
					read.revision,
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					scope: reference,
					newRevision: read.revision,
					noteId,
					deleted: true,
				});
			}),
	);

	server.registerTool(
		"listReferenceTargets",
		{
			title: "List Reference Targets",
			description:
				"List candidate reference targets (the MCP equivalent of editor intellisense) for embedding {{type:id}} tokens in memory note bodies. Design targets are available in any scope; component/token/asset/icon targets require a scope linked to a design system.",
			inputSchema: withProjectScopedInput({
				scope: memoryScopeSchema,
				type: z
					.enum([...MEMORY_REFERENCE_TYPES] as [
						MemoryReferenceType,
						...MemoryReferenceType[],
					])
					.describe(
						"Reference type to list: design, component, token, asset, or icon.",
					),
				query: z
					.string()
					.optional()
					.describe("Optional case-insensitive filter on id/label."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ scope, type, query, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const { scope: memoryScope, reference } = await resolveMemoryScope(
					context,
					policy,
					scope,
				);
				const targets = await listMemoryReferenceTargets(
					context.projectRoot,
					memoryScope,
					type,
					query ?? "",
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					scope: reference,
					type,
					targets,
				});
			}),
	);
};
