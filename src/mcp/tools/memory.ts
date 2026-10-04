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
	isDesignScopedReferenceType,
	listMemoryReferenceTargets,
	MEMORY_REFERENCE_TYPES,
	type MemoryReferenceType,
	resolveMemoryNoteReferences,
	splitDesignScopedReferenceId,
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
import { TOOL } from "../tool-names";
import {
	destructiveMutationAnnotations,
	readOnlyClosedWorldAnnotations,
	SEARCH_HINT_META_KEY,
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
		operation: "add" | "update" | "delete",
		memoryScope: MemoryScope,
		expectedRevision: string | null,
		resultingRevision: string | null,
	) => {
		await appendMcpAuditLog(context, {
			toolName: TOOL.memoryWrite,
			operation,
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

	const MAX_NOTES_PER_READ = 20;

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

	const listNotesIndex = async (
		context: TrickroomMcpServerContext,
		policy: McpPolicy,
		input: {
			scope?: MemoryScopeInput;
			designFileId?: string;
			includeBodies?: boolean;
			resolveReferences?: boolean;
		},
	) => {
		const options = {
			includeBodies: input.includeBodies === true,
			resolveReferences: input.resolveReferences === true,
		};
		if (input.designFileId !== undefined) {
			if (input.scope !== undefined) {
				throw new DesignTransformError(
					"INVALID_OPERATION_PARAMETERS",
					"Pass either scope or designFileId, not both: designFileId already covers the project, the design's linked system and the design.",
				);
			}
			const scopes = await resolveDesignSessionScopes(
				context,
				policy,
				input.designFileId,
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
			input.scope ?? "project",
		);
		return createJsonResult({
			status: "success",
			project: getProjectReference(context),
			...(await listScopeNotes(context, memoryScope, reference, options)),
		});
	};

	const readNotes = async (
		context: TrickroomMcpServerContext,
		policy: McpPolicy,
		input: {
			scope: MemoryScopeInput;
			noteIds: string[];
			resolveReferences?: boolean;
		},
	) => {
		const { scope: memoryScope, reference } = await resolveMemoryScope(
			context,
			policy,
			input.scope,
		);
		const read = await readMemoryManifest(context.projectRoot, memoryScope);
		const requested = [...new Set(input.noteIds)];
		const missingNoteIds = requested.filter((id) => !read.manifest.notes[id]);
		if (missingNoteIds.length === requested.length) {
			return createToolErrorResult(
				context,
				"NOTE_NOT_FOUND",
				`Memory note ${missingNoteIds.map((id) => `"${id}"`).join(", ")} not found in this scope. Call ${TOOL.memoryRead} without noteIds for the ids in each scope.`,
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
						input.resolveReferences === true,
					),
				),
		);
		return createJsonResult({
			status: "success",
			project: getProjectReference(context),
			scope: reference,
			scopeRevision: read.revision,
			notes,
			...(missingNoteIds.length > 0 ? { missingNoteIds } : {}),
		});
	};

	const listTargets = async (
		context: TrickroomMcpServerContext,
		policy: McpPolicy,
		input: {
			scope?: MemoryScopeInput;
			type: MemoryReferenceType;
			query?: string;
		},
	) => {
		const { scope: memoryScope, reference } = await resolveMemoryScope(
			context,
			policy,
			input.scope ?? "project",
		);
		const allowed = policy.allowedDesignFileIds;
		const targets = (
			await listMemoryReferenceTargets(
				context.projectRoot,
				memoryScope,
				input.type,
				input.query ?? "",
			)
		).filter((target) => {
			// Designs outside the allowlist are not listed, nor their boards
			// and layers.
			if (
				allowed === null ||
				(input.type !== "design" && !isDesignScopedReferenceType(input.type))
			) {
				return true;
			}
			const designId =
				input.type === "design"
					? target.id
					: splitDesignScopedReferenceId(target.id)?.designId;
			return designId !== undefined && allowed.has(designId);
		});
		return createJsonResult({
			status: "success",
			project: getProjectReference(context),
			scope: reference,
			type: input.type,
			targets,
		});
	};

	server.registerTool(
		TOOL.memoryRead,
		{
			title: "Read Memory Notes",
			description: `Read durable memory notes: intent, usage, conventions, constraints, decisions and todos recorded on the project, a design system or a design. Without noteIds: an index without bodies (id, title, category, size, per-note revision, one-line summary); designFileId indexes the project, the design's linked system and the design in one call, the way to start work on a design. With noteIds (one id or up to ${MAX_NOTES_PER_READ}) and scope: those notes' bodies with their revisions for ${TOOL.memoryWrite}. With referenceType: candidate {{type:id}} targets to embed in a note body. Notes are never added to your context on their own: read the ones that bear on your task and follow them.`,
			inputSchema: withProjectScopedInput({
				scope: memoryScopeSchema.optional(),
				designFileId: designFileIdSchema
					.optional()
					.describe(
						"Index the project, this design's linked system and this design together.",
					),
				noteIds: z
					.union([
						z.string().min(1),
						z.array(z.string().min(1)).min(1).max(MAX_NOTES_PER_READ),
					])
					.optional()
					.describe("Note id or ids to read in full, from one scope."),
				includeBodies: z
					.boolean()
					.optional()
					.describe(
						"Index with full bodies. Prefer noteIds for the notes you need.",
					),
				resolveReferences: z
					.boolean()
					.optional()
					.describe("Attach resolution of embedded {{type:id}} tokens."),
				referenceType: z
					.enum([...MEMORY_REFERENCE_TYPES] as [
						MemoryReferenceType,
						...MemoryReferenceType[],
					])
					.optional()
					.describe(
						"List reference targets of this type. Ids: design <designId>, board <designId>/<boardId>, layer <designId>/<elementId> (layers of the design scope's design, or of the design a query <designId>/… names), component, token <domain>/<name>, asset, icon.",
					),
				query: z
					.string()
					.optional()
					.describe("referenceType: case-insensitive filter on id or label."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"notes steering intent decisions conventions constraints context rationale",
			},
		},
		async ({
			scope,
			designFileId,
			noteIds,
			includeBodies,
			resolveReferences,
			referenceType,
			query,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				if (referenceType !== undefined) {
					return listTargets(context, policy, {
						scope,
						type: referenceType,
						query,
					});
				}
				if (noteIds !== undefined) {
					if (scope === undefined) {
						throw new DesignTransformError(
							"INVALID_OPERATION_PARAMETERS",
							"Reading notes by id needs their scope, as listed in the index.",
						);
					}
					return readNotes(context, policy, {
						scope,
						noteIds: typeof noteIds === "string" ? [noteIds] : noteIds,
						resolveReferences,
					});
				}
				return listNotesIndex(context, policy, {
					scope,
					designFileId,
					includeBodies,
					resolveReferences,
				});
			}),
	);

	server.registerTool(
		TOOL.memoryWrite,
		{
			title: "Write Memory Notes",
			description: `Add, update or delete one memory note in a scope. action "add": category and a markdown body, ideally a title; record what a later session needs (a decision and its reason, a constraint the user stated, a convention), not progress logs. action "update": change the body with edits (append, prepend, exact-text replace) rather than resending it, or replace fields; expectedRevision is the note's revision from ${TOOL.memoryRead} (the scope revision also works), so edits to other notes do not conflict. action "delete": noteId and expectedRevision. Bodies may embed {{type:id}} references; unresolved ones come back as referenceWarnings. Returns noteId, the note's new revision and size.`,
			inputSchema: withProjectScopedInput({
				action: z.enum(["add", "update", "delete"]).describe("What to do."),
				scope: memoryScopeSchema,
				noteId: z
					.string()
					.min(1)
					.optional()
					.describe("update, delete: the note's id."),
				expectedRevision: expectedRevisionSchema
					.optional()
					.describe("update, delete: the note's revision."),
				category: memoryCategorySchema.optional(),
				body: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Markdown body: required to add; on update it replaces the body whole.",
					),
				edits: z
					.array(memoryNoteEditSchema)
					.min(1)
					.optional()
					.describe(
						"update: body edits applied in order. A replace whose oldText is missing or ambiguous fails without writing.",
					),
				title: z
					.string()
					.nullable()
					.optional()
					.describe("Note title; null clears it on update."),
				tags: z
					.array(z.string().min(1))
					.nullable()
					.optional()
					.describe("Tags; null or empty clears them on update."),
				pinned: z.boolean().nullable().optional(),
				order: z.number().nullable().optional(),
				authorLabel: z
					.string()
					.min(1)
					.optional()
					.describe("Human-readable author label."),
			}),
			annotations: destructiveMutationAnnotations,
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"note remember record decision convention constraint steering",
			},
		},
		async ({
			action,
			scope,
			noteId,
			expectedRevision,
			category,
			body,
			edits,
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
					const { scope: memoryScope, reference } = await resolveMemoryScope(
						context,
						policy,
						scope,
					);

					if (action === "add") {
						if (category === undefined || body === undefined) {
							throw new DesignTransformError(
								"INVALID_OPERATION_PARAMETERS",
								'action "add" needs category and body.',
							);
						}
						const { read, note } = await addMemoryNote(
							context.projectRoot,
							memoryScope,
							{
								category,
								body,
								title: title ?? undefined,
								tags: tags ?? undefined,
								pinned: pinned ?? undefined,
								order: order ?? undefined,
								author: {
									kind: "agent",
									...(authorLabel ? { label: authorLabel } : {}),
								},
							},
						);
						await auditMemoryWrite(
							context,
							"add",
							memoryScope,
							null,
							read.revision,
						);
						return noteAcknowledgement(
							context,
							reference,
							read,
							note,
							await safeMemoryReferenceWarnings(
								context,
								memoryScope,
								note.body,
							),
						);
					}

					if (noteId === undefined || expectedRevision === undefined) {
						throw new DesignTransformError(
							"INVALID_OPERATION_PARAMETERS",
							`action "${action}" needs noteId and expectedRevision.`,
						);
					}

					if (action === "delete") {
						const read = await deleteMemoryNote(
							context.projectRoot,
							memoryScope,
							noteId,
							{ expectedRevision },
						);
						await auditMemoryWrite(
							context,
							"delete",
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
					}

					if (body !== undefined && edits !== undefined) {
						throw new DesignTransformError(
							"INVALID_OPERATION_PARAMETERS",
							"Pass either body (full replacement) or edits, not both.",
						);
					}
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
						"update",
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
};
