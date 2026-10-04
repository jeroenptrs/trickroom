import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DesignTransformError } from "../../services/design-transform-service";
import {
	findDesignSystem,
	listDesignSystems,
} from "../../utils/design-system-store";
import {
	addMemoryNote,
	deleteMemoryNote,
	MEMORY_CATEGORIES,
	type MemoryCategory,
	MemoryManifestError,
	type MemoryManifestRead,
	type MemoryNote,
	type MemoryScope,
	memoryNoteRevision,
	readMemoryManifest,
	sortMemoryNotes,
	summarizeMemoryManifest,
	toMemoryNoteIndexEntry,
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
import {
	getDesignSystemHandle,
	readDesignFileForTool,
} from "../payloads/design-tree";
import { getProjectReference } from "../payloads/project";
import type { TrickroomMcpServerContext } from "../server-types";
import {
	destructiveMutationAnnotations,
	mutationAnnotations,
	readOnlyClosedWorldAnnotations,
} from "./annotations";
import type { McpToolContext } from "./context";
import { createJsonResult, createToolErrorResult } from "./results";
import {
	designFileIdSchema,
	expectedRevisionSchema,
	isDesignFileId,
	withProjectScopedInput,
} from "./schemas";

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
			'Memory owner: "project", "system:<name or id>", "design:<uuid>", or { kind, systemName | designFileId }. systemId/name and designId/id are accepted too, kind may be omitted, and a system scope without a name uses the only configured system.',
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
			if (!isDesignFileId(designFileId)) {
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

	const withNoteReferences = async <Note extends object>(
		context: TrickroomMcpServerContext,
		memoryScope: MemoryScope,
		note: Note,
		body: string,
		resolveReferences: boolean,
	) =>
		resolveReferences
			? {
					...note,
					references: await resolveMemoryNoteReferences(
						context.projectRoot,
						memoryScope,
						body,
					),
				}
			: note;

	// Context maps MemoryManifestError to code + message; keep the details
	// (current revisions, failing edit index) so agents can retry directly.
	const withMemoryErrorDetails = async (
		context: TrickroomMcpServerContext,
		fn: () => Promise<CallToolResult>,
	) => {
		try {
			return await fn();
		} catch (error) {
			if (error instanceof MemoryManifestError && error.details) {
				return createToolErrorResult(
					context,
					error.code,
					error.message,
					error.details,
				);
			}
			throw error;
		}
	};

	const listScopeNotes = async (
		context: TrickroomMcpServerContext,
		memoryScope: MemoryScope,
		reference: Record<string, unknown>,
		options: { includeBodies: boolean; resolveReferences: boolean },
	) => {
		const read = await readMemoryManifest(context.projectRoot, memoryScope);
		const notes = await Promise.all(
			sortMemoryNotes(Object.values(read.manifest.notes)).map((note) =>
				withNoteReferences(
					context,
					memoryScope,
					options.includeBodies
						? { ...note, revision: memoryNoteRevision(note) }
						: toMemoryNoteIndexEntry(note),
					note.body,
					options.resolveReferences,
				),
			),
		);
		const summary = summarizeMemoryManifest(read.manifest);
		return {
			scope: reference,
			revision: read.revision,
			noteCount: summary.noteCount,
			...(summary.noteCount > 0 ? { categories: summary.categories } : {}),
			notes,
		};
	};

	// The scopes an agent needs when starting work on one design: the
	// project, the design's linked system (when configured), and the design.
	const resolveDesignSessionScopes = async (
		context: TrickroomMcpServerContext,
		policy: McpPolicy,
		designFileId: string,
	) => {
		assertCanReadDesignFile(policy, designFileId);
		const read = await readDesignFileForTool(context, designFileId);
		const systemHandle = getDesignSystemHandle(read.design);
		const system = systemHandle
			? await findDesignSystem(context.projectRoot, systemHandle)
			: null;
		const scopes: Array<{
			scope: MemoryScope;
			reference: Record<string, unknown>;
		}> = [{ scope: { kind: "project" }, reference: { kind: "project" } }];
		if (system) {
			scopes.push({
				scope: { kind: "system", systemHandle: system.manifest.systemId },
				reference: {
					kind: "system",
					systemId: system.manifest.systemId,
					systemName: system.manifest.systemName,
				},
			});
		}
		scopes.push({
			scope: { kind: "design", designId: designFileId },
			reference: { kind: "design", designFileId },
		});
		return scopes;
	};

	server.registerTool(
		"listMemoryNotes",
		{
			title: "List Memory Notes",
			description:
				"Index of durable memory/steering notes, without bodies: id, title, category, size, per-note revision, and a one-line summary. Defaults to the project scope. At the start of work on a design, pass designFileId to index the project, the design's linked system, and the design in one call. Read bodies with getMemoryNote.",
			inputSchema: withProjectScopedInput({
				scope: memoryScopeSchema.optional(),
				designFileId: designFileIdSchema
					.optional()
					.describe(
						"Index the project, this design's linked system, and this design together. Do not combine with scope.",
					),
				includeBodies: z
					.boolean()
					.optional()
					.describe(
						"When true, return full notes with bodies instead of the index. Prefer getMemoryNote for the notes you need.",
					),
				resolveReferences: z
					.boolean()
					.optional()
					.describe(
						"When true, attach per-note reference resolution for embedded {{type:id}} tokens.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({
			scope,
			designFileId,
			includeBodies,
			resolveReferences,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const options = {
					includeBodies: includeBodies === true,
					resolveReferences: resolveReferences === true,
				};
				if (designFileId !== undefined) {
					if (scope !== undefined) {
						throw new DesignTransformError(
							"INVALID_OPERATION_PARAMETERS",
							"Pass either scope or designFileId to listMemoryNotes, not both. designFileId already includes the project, linked system, and design scopes.",
						);
					}
					const scopes = await resolveDesignSessionScopes(
						context,
						policy,
						designFileId,
					);
					return createJsonResult({
						status: "success",
						project: getProjectReference(context),
						scopes: await Promise.all(
							scopes.map((entry) =>
								listScopeNotes(context, entry.scope, entry.reference, options),
							),
						),
					});
				}
				const { scope: memoryScope, reference } = await resolveMemoryScope(
					context,
					policy,
					scope ?? "project",
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					...(await listScopeNotes(context, memoryScope, reference, options)),
				});
			}),
	);

	const MAX_NOTES_PER_GET = 20;

	server.registerTool(
		"getMemoryNote",
		{
			title: "Get Memory Note",
			description: `Read memory note bodies by id from one scope: noteId for one note, or noteIds for up to ${MAX_NOTES_PER_GET}. Each note carries its revision for updateMemoryNote/deleteMemoryNote.`,
			inputSchema: withProjectScopedInput({
				scope: memoryScopeSchema,
				noteId: z.string().min(1).optional().describe("Memory note id."),
				noteIds: z
					.array(z.string().min(1))
					.min(1)
					.max(MAX_NOTES_PER_GET)
					.optional()
					.describe("Several memory note ids from the same scope."),
				resolveReferences: z
					.boolean()
					.optional()
					.describe(
						"When true, attach reference resolution for embedded {{type:id}} tokens in the note body.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ scope, noteId, noteIds, resolveReferences, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				if ((noteId === undefined) === (noteIds === undefined)) {
					throw new DesignTransformError(
						"INVALID_OPERATION_PARAMETERS",
						"Pass exactly one of noteId or noteIds to getMemoryNote.",
					);
				}
				const policy = getMcpPolicy(context.config);
				const { scope: memoryScope, reference } = await resolveMemoryScope(
					context,
					policy,
					scope,
				);
				const read = await readMemoryManifest(context.projectRoot, memoryScope);
				const requested = [...new Set(noteIds ?? [noteId as string])];
				const missingNoteIds = requested.filter(
					(id) => !read.manifest.notes[id],
				);
				if (noteId !== undefined && missingNoteIds.length > 0) {
					return createToolErrorResult(
						context,
						"NOTE_NOT_FOUND",
						`Memory note "${noteId}" was not found in this scope. Call listMemoryNotes for the ids in each scope.`,
						{ scope: reference },
					);
				}
				const notes = await Promise.all(
					requested
						.map((id) => read.manifest.notes[id])
						.filter((note) => note !== undefined)
						.map((note) =>
							withNoteReferences(
								context,
								memoryScope,
								{ ...note, revision: memoryNoteRevision(note) },
								note.body,
								resolveReferences === true,
							),
						),
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					scope: reference,
					scopeRevision: read.revision,
					...(noteId !== undefined
						? { note: notes[0] }
						: {
								notes,
								...(missingNoteIds.length > 0 ? { missingNoteIds } : {}),
							}),
				});
			}),
	);

	const noteAcknowledgement = (
		context: TrickroomMcpServerContext,
		reference: Record<string, unknown>,
		read: MemoryManifestRead,
		note: MemoryNote,
		referenceWarnings: unknown[],
	) =>
		createJsonResult({
			status: "success",
			project: getProjectReference(context),
			scope: reference,
			noteId: note.noteId,
			newRevision: memoryNoteRevision(note),
			scopeRevision: read.revision,
			size: note.body.length,
			...(referenceWarnings.length > 0 ? { referenceWarnings } : {}),
		});

	server.registerTool(
		"addMemoryNote",
		{
			title: "Add Memory Note",
			description:
				"Add one durable memory/steering note to a system, design, or project scope. Bodies are markdown and may embed reference tokens like {{design:<uuid>}}. Returns noteId, the note's revision, and size.",
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
				return noteAcknowledgement(
					context,
					reference,
					read,
					note,
					await safeMemoryReferenceWarnings(context, memoryScope, note.body),
				);
			}),
	);

	const memoryNoteEditSchema = z.discriminatedUnion("op", [
		z
			.object({
				op: z.literal("append"),
				text: z
					.string()
					.min(1)
					.describe(
						"Added as a new paragraph after the body; start with a newline to control spacing yourself.",
					),
			})
			.strict(),
		z
			.object({
				op: z.literal("prepend"),
				text: z
					.string()
					.min(1)
					.describe("Added as a new paragraph before the body."),
			})
			.strict(),
		z
			.object({
				op: z.literal("replace"),
				oldText: z
					.string()
					.min(1)
					.describe(
						"Exact text currently in the body. Must occur once unless all is true.",
					),
				newText: z.string().describe("Replacement text; empty deletes."),
				all: z
					.boolean()
					.optional()
					.describe("Replace every occurrence instead of exactly one."),
			})
			.strict(),
	]);

	server.registerTool(
		"updateMemoryNote",
		{
			title: "Update Memory Note",
			description:
				"Update one memory note. Change the body with edits (append, prepend, exact-text replace) rather than resending it; body replaces it whole. expectedRevision is the note's revision from listMemoryNotes/getMemoryNote (the scope revision also works), so edits to other notes in the scope do not conflict. Returns noteId, the new revision, and size.",
			inputSchema: withProjectScopedInput({
				scope: memoryScopeSchema,
				noteId: z.string().min(1).describe("Memory note id to update."),
				expectedRevision: expectedRevisionSchema,
				category: memoryCategorySchema.optional(),
				edits: z
					.array(memoryNoteEditSchema)
					.min(1)
					.optional()
					.describe(
						"Body edits applied in order. A replace whose oldText is missing or ambiguous fails without writing.",
					),
				body: z
					.string()
					.min(1)
					.optional()
					.describe("Replacement markdown body. Prefer edits for long notes."),
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
			edits,
			body,
			title,
			tags,
			pinned,
			order,
			authorLabel,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) =>
				withMemoryErrorDetails(context, async () => {
					const policy = getMcpPolicy(context.config);
					assertCanWriteProject(policy);
					if (body !== undefined && edits !== undefined) {
						throw new DesignTransformError(
							"INVALID_OPERATION_PARAMETERS",
							"Pass either body (full replacement) or edits, not both.",
						);
					}
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
							...(edits !== undefined ? { edits } : {}),
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
					return noteAcknowledgement(
						context,
						reference,
						read,
						note,
						body !== undefined || edits !== undefined
							? await safeMemoryReferenceWarnings(
									context,
									memoryScope,
									note.body,
								)
							: [],
					);
				}),
			),
	);

	server.registerTool(
		"deleteMemoryNote",
		{
			title: "Delete Memory Note",
			description:
				"Delete one memory note. expectedRevision is the note's revision from listMemoryNotes/getMemoryNote (the scope revision also works).",
			inputSchema: withProjectScopedInput({
				scope: memoryScopeSchema,
				noteId: z.string().min(1).describe("Memory note id to delete."),
				expectedRevision: expectedRevisionSchema,
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ scope, noteId, expectedRevision, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				withMemoryErrorDetails(context, async () => {
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
						noteId,
						deleted: true,
						scopeRevision: read.revision,
					});
				}),
			),
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
