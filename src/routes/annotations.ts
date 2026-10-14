import type { Context, Env, Hono, MiddlewareHandler } from "hono";
import { isAnnotationTarget } from "../services/annotation-file-schema";
import {
	type AnnotationServiceContext,
	AnnotationServiceError,
	clearAnnotations,
	countDesignAnnotations,
	createAnnotation,
	getAnnotation,
	listAnnotations,
	moveAnnotationToBranch,
	reanchorAnnotation,
	replyToAnnotation,
	resolveAnnotations,
	revertChange,
	transitionAnnotation,
} from "../services/annotation-service";
import {
	AnnotationStore,
	AnnotationStoreError,
	getAnnotationContainer,
} from "../services/annotation-store";
import {
	ANNOTATION_STATUSES,
	type AnnotationActor,
	type AnnotationContainer,
	type AnnotationScope,
	type AnnotationSnapshot,
	type AnnotationStatus,
	type AnnotationTarget,
} from "../services/annotations.types";
import { isSameScope, readCheckoutScope } from "../services/checkout-scope";
import {
	type ComponentAnchorRead,
	readComponentAnchor,
	resolveAnnotationSystemId,
	revertComponentChange,
} from "../services/component-annotations";
import {
	createDesignFileService,
	DesignFileServiceError,
} from "../services/design-file-service";
import type { TrickroomConfig } from "../types";
import { SystemComponentOperationsError } from "../utils/system-component-operations";

/**
 * `/api/trickroom/annotations`: the editor's annotation API. Every write is
 * attributed to the human; nothing in a request can change that (agents
 * write through MCP). Thin over `annotation-service.ts`. Routes:
 *
 * - `GET    /annotations?designId=|systemId=&componentId=` list (`boardId`, `elementId`, `status`, `branch`)
 * - `GET    /annotations/counts` agent and designer work per design (the project screen)
 * - `POST   /annotations` create `{ target, body, snapshot? }`
 * - `GET    /annotations/:id` one annotation
 * - `POST   /annotations/:id/entries` reply `{ body, expectedRevision? }`
 * - `POST   /annotations/:id/transition` `{ to: "resolved" | "dismissed" | "open", summary?, reason?, expectedRevision? }`
 * - `POST   /annotations/:id/anchor` re-anchor `{ target, snapshot?, expectedRevision? }`
 * - `POST   /annotations/:id/move` to the current branch `{ expectedRevision? }`
 * - `POST   /annotations/:id/revert` `{ entryId, expectedRevision? }`
 * - `POST   /annotations/resolve` bulk `{ designId | systemId+componentId, annotationIds? | boardId?, statuses?, expectedRevisions? }`
 * - `POST   /annotations/clear` `{ designId | systemId+componentId, boardId?, branch?, expectedRevisions? }`
 *
 * Every write takes an optional `expectedScope: { branch, worktreePath }`,
 * the checkout the editor listed its annotations in. When the checkout has
 * changed since (another branch checked out with the design open), the
 * write is refused with 409 `SCOPE_CHANGED` and `details.scope`, the
 * checkout now, so a stale tab never writes to another branch's
 * annotations. The check runs when the request starts and again under the
 * write's locks, right before it stores (and before a revert's design or
 * component write), against a fresh read of `.git/HEAD`: a write queued
 * behind a lock across a checkout is refused too. `GET` answers carry
 * `scope` for the same comparison.
 *
 * Every write to existing annotations honours the revision the editor
 * read: `expectedRevision` on single-annotation routes (409 when stale),
 * `expectedRevisions: { [annotationId]: revision }` on bulk routes (stale
 * ones are reported in `skipped`). Clear also skips anything changed since
 * it listed it.
 *
 * `:id` routes take an optional `?designId=` (or `systemId` and
 * `componentId`) hint so the annotation is not looked up in every folder.
 *
 * Component node targets (`{ kind: "componentNode", systemId, componentId,
 * nodePath, variants? }`) are checked against the component's draft
 * template (or its published one without a draft): the node must exist and
 * pinned variant values must be in its schema. The server fills the node's
 * names and the component revision; the editor sends the variant values in
 * view as `snapshot.variants`. Their change records revert through the
 * component's draft. List takes `nodePath` for one node's annotations.
 */

const human: AnnotationActor = { role: "human" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const readBody = async (c: Context) => {
	const body = (await c.req.json().catch(() => null)) as unknown;
	return isRecord(body) ? body : null;
};

const optionalString = (value: unknown) =>
	typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * The checkout is not the one the editor listed in, or not the one this
 * request started in: nothing is written.
 */
const scopeChanged = (scope: AnnotationScope) =>
	new AnnotationServiceError(
		"SCOPE_CHANGED",
		`The checkout changed: annotations are now those of ${scope.branch === "*" ? "the unscoped bucket" : `branch ${scope.branch}`}. Nothing was written; list them again.`,
		{ scope },
	);

class RequestError extends Error {
	readonly status: 400 | 404 | 409;
	constructor(message: string, status: 400 | 404 | 409 = 400) {
		super(message);
		this.status = status;
	}
}

const errorJson = (
	c: Context,
	status: number,
	error: string,
	code: string,
	details?: Record<string, unknown>,
) =>
	c.json(
		{ error, code, ...(details ? { details } : {}) },
		status as 400 | 404 | 409 | 423 | 500,
	);

const respondWithError = (c: Context, error: unknown) => {
	if (error instanceof RequestError) {
		return errorJson(c, error.status, error.message, "INVALID_REQUEST");
	}
	if (error instanceof AnnotationStoreError) {
		const status =
			error.code === "ANNOTATION_NOT_FOUND"
				? 404
				: error.code === "ANNOTATION_REVISION_MISMATCH" ||
						error.code === "ANNOTATION_EXISTS" ||
						error.code === "UNSUPPORTED_ANNOTATION_VERSION"
					? 409
					: error.code === "ANNOTATION_LOCKED"
						? 423
						: error.code === "INVALID_ANNOTATION_FILE"
							? 500
							: 400;
		return errorJson(c, status, error.message, error.code, error.details);
	}
	if (error instanceof AnnotationServiceError) {
		const status =
			error.code === "TARGET_NOT_FOUND"
				? 404
				: error.code === "CHANGED_SINCE" ||
						error.code === "WRONG_BRANCH" ||
						error.code === "SCOPE_CHANGED" ||
						error.code === "DESIGN_BUSY" ||
						error.code === "COMPONENT_BUSY"
					? 409
					: error.code === "REVERT_NOT_RECORDED"
						? 500
						: 400;
		return errorJson(c, status, error.message, error.code, error.details);
	}
	if (error instanceof DesignFileServiceError) {
		return errorJson(
			c,
			error.code === "DESIGN_FILE_LOCKED" ? 423 : 400,
			error.message,
			error.code,
		);
	}
	if (error instanceof SystemComponentOperationsError) {
		return errorJson(
			c,
			error.code === "COMPONENT_NOT_FOUND" || error.code === "SYSTEM_NOT_FOUND"
				? 404
				: error.code === "STALE_WRITE" || error.code === "DRAFT_HASH_MISMATCH"
					? 409
					: error.code === "MANIFEST_LOCKED"
						? 423
						: 400,
			error.message,
			error.code,
		);
	}
	if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
		return errorJson(c, 404, "The design does not exist.", "DESIGN_NOT_FOUND");
	}
	console.error(error);
	return errorJson(c, 500, "Failed to process annotation request", "INTERNAL");
};

const parseStatuses = (value: unknown): AnnotationStatus[] | undefined => {
	if (value === undefined || value === null || value === "") return undefined;
	const list = Array.isArray(value)
		? value
		: typeof value === "string"
			? value.split(",")
			: null;
	if (
		!list?.every((status) =>
			(ANNOTATION_STATUSES as readonly unknown[]).includes(
				typeof status === "string" ? status.trim() : status,
			),
		)
	) {
		throw new RequestError(
			`status must be a list of ${ANNOTATION_STATUSES.join(", ")}.`,
		);
	}
	return list.map((status) => String(status).trim() as AnnotationStatus);
};

/** `designId`, or `systemId` with `componentId`, from a query or body. */
const parseContainer = (
	source: Record<string, unknown>,
): AnnotationContainer | null => {
	const designId = optionalString(source.designId);
	if (designId) return { kind: "design", designId };
	const systemId = optionalString(source.systemId);
	const componentId = optionalString(source.componentId);
	if (systemId && componentId) {
		return { kind: "component", systemId, componentId };
	}
	return null;
};

const requireContainer = (source: Record<string, unknown>) => {
	const container = parseContainer(source);
	if (!container) {
		throw new RequestError("Pass designId, or systemId and componentId.");
	}
	return container;
};

/**
 * The optional `expectedRevision` every single-annotation write accepts:
 * absent is fine, anything but a non-empty string is a 400.
 */
const expectedRevisionOf = (body: Record<string, unknown> | null) => {
	const value = body?.expectedRevision;
	if (value === undefined || value === null) return {};
	if (typeof value !== "string" || value.length === 0) {
		throw new RequestError("expectedRevision must be a revision string.");
	}
	return { expectedRevision: value };
};

/**
 * The optional `expectedScope` every write accepts: the checkout the editor
 * believes it is in. Absent is fine; a malformed one is a 400.
 */
const expectedScopeOf = (
	body: Record<string, unknown> | null,
): AnnotationScope | null => {
	const value = body?.expectedScope;
	if (value === undefined || value === null) return null;
	if (
		!isRecord(value) ||
		typeof value.branch !== "string" ||
		typeof value.worktreePath !== "string"
	) {
		throw new RequestError(
			"expectedScope must be { branch, worktreePath } from a list.",
		);
	}
	return { branch: value.branch, worktreePath: value.worktreePath };
};

/** Bulk writes: `expectedRevisions`, an object of annotation id to revision. */
const expectedRevisionsOf = (body: Record<string, unknown>) => {
	const value = body.expectedRevisions;
	if (value === undefined || value === null) return {};
	if (
		!isRecord(value) ||
		!Object.values(value).every(
			(revision) => typeof revision === "string" && revision.length > 0,
		)
	) {
		throw new RequestError(
			"expectedRevisions must map annotation ids to revision strings.",
		);
	}
	return { expectedRevisions: value as Record<string, string> };
};

/**
 * `?designId=` (or `systemId` and `componentId`) on a `:annotationId` route
 * saves looking the annotation up in every folder.
 */
const containerHint = (c: Context) => {
	const container = parseContainer(c.req.query());
	return container ? { container } : {};
};

const parseSnapshot = (
	value: unknown,
): Omit<AnnotationSnapshot, "branch" | "worktreePath"> | undefined => {
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw new RequestError("snapshot must be an object.");
	const snapshot: Omit<AnnotationSnapshot, "branch" | "worktreePath"> = {};
	if (typeof value.stageMode === "string") snapshot.stageMode = value.stageMode;
	if (
		typeof value.responsiveWidth === "number" &&
		Number.isFinite(value.responsiveWidth)
	) {
		snapshot.responsiveWidth = value.responsiveWidth;
	}
	// Names the server cannot derive (component nodes, WP5).
	if (typeof value.layerName === "string") snapshot.layerName = value.layerName;
	if (typeof value.component === "string") snapshot.component = value.component;
	if (
		Array.isArray(value.ancestorNames) &&
		value.ancestorNames.every((name) => typeof name === "string")
	) {
		snapshot.ancestorNames = value.ancestorNames as string[];
	}
	// The variant values in view (component nodes).
	if (
		isRecord(value.variants) &&
		Object.values(value.variants).every((entry) => typeof entry === "string")
	) {
		snapshot.variants = Object.fromEntries(
			Object.entries(value.variants as Record<string, string>),
		);
	}
	if (typeof value.designRevision === "string") {
		snapshot.designRevision = value.designRevision;
	}
	return snapshot;
};

const parseTarget = (value: unknown): AnnotationTarget => {
	if (!isAnnotationTarget(value)) {
		throw new RequestError(
			"target must be { kind: design | board | layer | componentNode, … } with its ids.",
		);
	}
	return value;
};

export type AnnotationRoutesOptions = {
	/** Where the per-user annotation store lives. */
	trickroomHome: string;
};

export const registerAnnotationRoutes = <E extends Env>(
	app: Hono<E>,
	attachProject: MiddlewareHandler<E>,
	{ trickroomHome }: AnnotationRoutesOptions,
) => {
	app.use("/api/trickroom/annotations", attachProject);
	app.use("/api/trickroom/annotations/*", attachProject);

	/** Everything a handler needs, resolved once per request. */
	const resolveRequest = (c: Context) => {
		const projectRoot = c.get("projectRoot") as string;
		const config = c.get("config") as TrickroomConfig | undefined;
		const projectId = config?.projectId;
		if (!projectId) {
			throw new RequestError("The project has no projectId.", 409);
		}
		let scope: ReturnType<typeof readCheckoutScope> | null = null;
		/** The editor's `expectedScope`, once `assertScope` read it. */
		let expected: AnnotationScope | null = null;
		/**
		 * Under the write's locks, right before it stores: the checkout read
		 * again (never the request's cached scope), which must still be the
		 * one the request started in and the one the editor expects. A write
		 * that waited on a lock across a checkout is refused.
		 */
		const beforeWrite = async () => {
			const current = await readCheckoutScope(projectRoot);
			const started = scope ? await scope : null;
			if (
				(started && !isSameScope(started, current)) ||
				(expected && !isSameScope(expected, current))
			) {
				throw scopeChanged(current);
			}
		};
		const context: AnnotationServiceContext = {
			store: new AnnotationStore({ projectId, trickroomHome, beforeWrite }),
		};
		const designService = createDesignFileService(projectRoot, {
			trickroomHome,
		});
		return {
			context,
			designService,
			projectRoot,
			// The checkout's branch, read once per request.
			scope: () => {
				scope ??= readCheckoutScope(projectRoot);
				return scope;
			},
			/**
			 * Refuses a write whose `expectedScope` is not the checkout's
			 * scope now; writes use that same scope.
			 */
			assertScope: async (body: Record<string, unknown> | null) => {
				expected = expectedScopeOf(body);
				scope ??= readCheckoutScope(projectRoot);
				const current = await scope;
				if (expected && !isSameScope(expected, current)) {
					throw scopeChanged(current);
				}
			},
			readDesign: async (container: AnnotationContainer | null) =>
				container?.kind === "design"
					? designService.readDesignFile(container.designId)
					: null,
			/** The component of a component container; null when it is gone. */
			readComponent: async (
				container: AnnotationContainer | null,
			): Promise<ComponentAnchorRead | null> =>
				container?.kind === "component"
					? readComponentAnchor(
							projectRoot,
							container.systemId,
							container.componentId,
						).catch(() => null)
					: null,
			/**
			 * A component node target as stored: its system named by the
			 * manifest's id (the editor and MCP share one folder per
			 * component), and the component it must exist in.
			 */
			resolveComponentTarget: async (target: AnnotationTarget) => {
				if (target.kind !== "componentNode") return { target };
				const systemId = await resolveAnnotationSystemId(
					projectRoot,
					target.systemId,
				);
				const component = systemId
					? await readComponentAnchor(projectRoot, systemId, target.componentId)
					: null;
				if (!systemId || !component) {
					throw new AnnotationServiceError(
						"TARGET_NOT_FOUND",
						`Component ${target.componentId} is not in design system ${target.systemId}.`,
					);
				}
				return {
					target: { ...target, systemId },
					component: {
						template: component.template,
						revision: component.revision,
					},
				};
			},
		};
	};

	const handle =
		(
			handler: (
				c: Context,
				request: ReturnType<typeof resolveRequest>,
			) => Promise<Response>,
		) =>
		async (c: Context) => {
			try {
				return await handler(c, resolveRequest(c));
			} catch (error) {
				return respondWithError(c, error);
			}
		};

	app.get(
		"/api/trickroom/annotations",
		handle(async (c, request) => {
			const query = c.req.query();
			const container = requireContainer(query);
			const branch = optionalString(query.branch);
			// Annotations of a design that is gone are still listed.
			const read = await request.readDesign(container).catch((error) => {
				if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
				throw error;
			});
			const component = await request.readComponent(container);
			const scope = await request.scope();
			const result = await listAnnotations(request.context, {
				container,
				scope,
				...(branch ? { branch } : {}),
				...(query.status ? { statuses: parseStatuses(query.status) } : {}),
				...(query.boardId ? { boardId: query.boardId } : {}),
				...(query.elementId ? { elementId: query.elementId } : {}),
				...(query.nodePath ? { nodePath: query.nodePath } : {}),
				design: read?.design ?? null,
				component: component?.template ?? null,
			});
			return c.json({
				scope,
				...(read ? { designRevision: read.revision } : {}),
				...(component
					? {
							componentRevision: component.revision,
							componentSource: component.source,
						}
					: {}),
				annotations: result.annotations,
				problems: result.problems,
			});
		}),
	);

	// Before `/annotations/:annotationId`, which would take "counts" as an id.
	app.get(
		"/api/trickroom/annotations/counts",
		handle(async (c, request) => {
			const scope = await request.scope();
			const counts = await countDesignAnnotations(request.context, { scope });
			return c.json({
				scope,
				designs: Object.fromEntries(counts),
			});
		}),
	);

	app.post(
		"/api/trickroom/annotations",
		handle(async (c, request) => {
			const body = await readBody(c);
			await request.assertScope(body);
			if (!body) throw new RequestError("Expected a JSON object.");
			const parsed = parseTarget(body.target);
			if (typeof body.body !== "string") {
				throw new RequestError("body must be the remark's text.");
			}
			const { target, component } =
				await request.resolveComponentTarget(parsed);
			const read = await request.readDesign(getAnnotationContainer(target));
			const result = await createAnnotation(request.context, {
				target,
				...(component ? { component } : {}),
				body: body.body,
				by: human,
				scope: await request.scope(),
				...(body.snapshot !== undefined
					? { snapshot: parseSnapshot(body.snapshot) }
					: {}),
				...(read
					? { design: { design: read.design, revision: read.revision } }
					: {}),
			});
			return c.json(result, 201);
		}),
	);

	app.post(
		"/api/trickroom/annotations/resolve",
		handle(async (c, request) => {
			const body = await readBody(c);
			await request.assertScope(body);
			if (!body) throw new RequestError("Expected a JSON object.");
			const container = requireContainer(body);
			const annotationIds = body.annotationIds;
			if (
				annotationIds !== undefined &&
				!(
					Array.isArray(annotationIds) &&
					annotationIds.every((id) => typeof id === "string")
				)
			) {
				throw new RequestError("annotationIds must be a list of ids.");
			}
			const read = await request.readDesign(container);
			const result = await resolveAnnotations(request.context, {
				container,
				by: human,
				...(annotationIds ? { annotationIds: annotationIds as string[] } : {}),
				scope: await request.scope(),
				...(body.statuses !== undefined
					? { statuses: parseStatuses(body.statuses) }
					: {}),
				...(optionalString(body.boardId)
					? { boardId: body.boardId as string }
					: {}),
				design: read?.design ?? null,
				...expectedRevisionsOf(body),
			});
			return c.json(result);
		}),
	);

	app.post(
		"/api/trickroom/annotations/clear",
		handle(async (c, request) => {
			const body = await readBody(c);
			await request.assertScope(body);
			if (!body) throw new RequestError("Expected a JSON object.");
			const container = requireContainer(body);
			const read = await request.readDesign(container).catch(() => null);
			const branch = optionalString(body.branch);
			const result = await clearAnnotations(request.context, {
				container,
				scope: await request.scope(),
				...(branch ? { branch } : {}),
				...(optionalString(body.boardId)
					? { boardId: body.boardId as string }
					: {}),
				design: read?.design ?? null,
				...expectedRevisionsOf(body),
			});
			return c.json(result);
		}),
	);

	app.get(
		"/api/trickroom/annotations/:annotationId",
		handle(async (c, request) => {
			const annotationId = c.req.param("annotationId") as string;
			const container = await request.context.store.locate(
				annotationId,
				parseContainer(c.req.query()) ?? undefined,
			);
			if (!container) {
				throw new AnnotationStoreError(
					"ANNOTATION_NOT_FOUND",
					`Annotation ${annotationId} does not exist.`,
				);
			}
			// A design that cannot be read leaves `detached` underived.
			const read = await request.readDesign(container).catch(() => null);
			const component = await request.readComponent(container);
			return c.json({
				scope: await request.scope(),
				annotation: await getAnnotation(request.context, {
					annotationId,
					container,
					design: read?.design ?? null,
					component: component?.template ?? null,
				}),
			});
		}),
	);

	app.post(
		"/api/trickroom/annotations/:annotationId/entries",
		handle(async (c, request) => {
			const body = await readBody(c);
			await request.assertScope(body);
			if (!body || typeof body.body !== "string") {
				throw new RequestError("body must be the reply's text.");
			}
			const result = await replyToAnnotation(request.context, {
				annotationId: c.req.param("annotationId") as string,
				...containerHint(c),
				by: human,
				body: body.body,
				...expectedRevisionOf(body),
			});
			return c.json(result);
		}),
	);

	app.post(
		"/api/trickroom/annotations/:annotationId/transition",
		handle(async (c, request) => {
			const body = await readBody(c);
			await request.assertScope(body);
			const to = body?.to;
			if (to !== "resolved" && to !== "dismissed" && to !== "open") {
				throw new RequestError("to must be resolved, dismissed or open.");
			}
			const result = await transitionAnnotation(request.context, {
				annotationId: c.req.param("annotationId") as string,
				...containerHint(c),
				by: human,
				to,
				...(typeof body?.reason === "string" ? { reason: body.reason } : {}),
				...(typeof body?.summary === "string" ? { summary: body.summary } : {}),
				...expectedRevisionOf(body),
			});
			return c.json(result);
		}),
	);

	app.post(
		"/api/trickroom/annotations/:annotationId/anchor",
		handle(async (c, request) => {
			const body = await readBody(c);
			await request.assertScope(body);
			if (!body) throw new RequestError("Expected a JSON object.");
			const { target, component } = await request.resolveComponentTarget(
				parseTarget(body.target),
			);
			const read = await request.readDesign(getAnnotationContainer(target));
			const result = await reanchorAnnotation(request.context, {
				annotationId: c.req.param("annotationId") as string,
				by: human,
				target,
				...(component ? { component } : {}),
				container: getAnnotationContainer(target),
				...(read
					? { design: { design: read.design, revision: read.revision } }
					: {}),
				...(body.snapshot !== undefined
					? { snapshot: parseSnapshot(body.snapshot) }
					: {}),
				...expectedRevisionOf(body),
			});
			return c.json(result);
		}),
	);

	app.post(
		"/api/trickroom/annotations/:annotationId/move",
		handle(async (c, request) => {
			const body = (await readBody(c)) ?? {};
			await request.assertScope(body);
			const result = await moveAnnotationToBranch(request.context, {
				annotationId: c.req.param("annotationId") as string,
				...containerHint(c),
				by: human,
				scope: await request.scope(),
				...expectedRevisionOf(body),
			});
			return c.json(result);
		}),
	);

	app.post(
		"/api/trickroom/annotations/:annotationId/revert",
		handle(async (c, request) => {
			const body = await readBody(c);
			await request.assertScope(body);
			const entryId = optionalString(body?.entryId);
			if (!entryId) throw new RequestError("entryId must name a change entry.");
			const annotationId = c.req.param("annotationId") as string;
			const container = await request.context.store.locate(
				annotationId,
				parseContainer(c.req.query()) ?? undefined,
			);
			if (container?.kind === "component") {
				return c.json(
					await revertComponentChange(request.context, {
						annotationId,
						entryId,
						by: human,
						projectRoot: request.projectRoot,
						container,
						scope: await request.scope(),
						...expectedRevisionOf(body),
					}),
				);
			}
			const result = await revertChange(request.context, {
				annotationId: c.req.param("annotationId") as string,
				...containerHint(c),
				entryId,
				by: human,
				designService: request.designService,
				scope: await request.scope(),
				...expectedRevisionOf(body),
			});
			return c.json(result);
		}),
	);
};
