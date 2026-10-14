import type { Context, Env, Hono, MiddlewareHandler } from "hono";
import { isAnnotationTarget } from "../services/annotation-file-schema";
import {
	type AnnotationServiceContext,
	AnnotationServiceError,
	clearAnnotations,
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
	type AnnotationSnapshot,
	type AnnotationStatus,
	type AnnotationTarget,
} from "../services/annotations.types";
import { readCheckoutScope } from "../services/checkout-scope";
import {
	createDesignFileService,
	DesignFileServiceError,
} from "../services/design-file-service";
import type { TrickroomConfig } from "../types";

/**
 * `/api/trickroom/annotations`: the editor's annotation API. Every write is
 * attributed to the human; nothing in a request can change that (agents
 * write through MCP). Thin over `annotation-service.ts`. Routes:
 *
 * - `GET    /annotations?designId=|systemId=&componentId=` list (`boardId`, `elementId`, `status`, `branch`)
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
 * Every write to existing annotations honours the revision the editor
 * read: `expectedRevision` on single-annotation routes (409 when stale),
 * `expectedRevisions: { [annotationId]: revision }` on bulk routes (stale
 * ones are reported in `skipped`). Clear also skips anything changed since
 * it listed it.
 *
 * `:id` routes take an optional `?designId=` (or `systemId` and
 * `componentId`) hint so the annotation is not looked up in every folder.
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
				: error.code === "CHANGED_SINCE" || error.code === "DESIGN_BUSY"
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
		const context: AnnotationServiceContext = {
			store: new AnnotationStore({ projectId, trickroomHome }),
		};
		const designService = createDesignFileService(projectRoot, {
			trickroomHome,
		});
		let scope: ReturnType<typeof readCheckoutScope> | null = null;
		return {
			context,
			designService,
			// The checkout's branch, read once per request.
			scope: () => {
				scope ??= readCheckoutScope(projectRoot);
				return scope;
			},
			readDesign: async (container: AnnotationContainer | null) =>
				container?.kind === "design"
					? designService.readDesignFile(container.designId)
					: null,
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
			const scope = await request.scope();
			const result = await listAnnotations(request.context, {
				container,
				scope,
				...(branch ? { branch } : {}),
				...(query.status ? { statuses: parseStatuses(query.status) } : {}),
				...(query.boardId ? { boardId: query.boardId } : {}),
				...(query.elementId ? { elementId: query.elementId } : {}),
				design: read?.design ?? null,
			});
			return c.json({
				scope,
				...(read ? { designRevision: read.revision } : {}),
				annotations: result.annotations,
				problems: result.problems,
			});
		}),
	);

	app.post(
		"/api/trickroom/annotations",
		handle(async (c, request) => {
			const body = await readBody(c);
			if (!body) throw new RequestError("Expected a JSON object.");
			const target = parseTarget(body.target);
			if (typeof body.body !== "string") {
				throw new RequestError("body must be the remark's text.");
			}
			const read = await request.readDesign(getAnnotationContainer(target));
			const result = await createAnnotation(request.context, {
				target,
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
			return c.json({
				annotation: await getAnnotation(request.context, {
					annotationId,
					container,
					design: read?.design ?? null,
				}),
			});
		}),
	);

	app.post(
		"/api/trickroom/annotations/:annotationId/entries",
		handle(async (c, request) => {
			const body = await readBody(c);
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
			if (!body) throw new RequestError("Expected a JSON object.");
			const target = parseTarget(body.target);
			const read = await request.readDesign(getAnnotationContainer(target));
			const result = await reanchorAnnotation(request.context, {
				annotationId: c.req.param("annotationId") as string,
				by: human,
				target,
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
			const entryId = optionalString(body?.entryId);
			if (!entryId) throw new RequestError("entryId must name a change entry.");
			const result = await revertChange(request.context, {
				annotationId: c.req.param("annotationId") as string,
				...containerHint(c),
				entryId,
				by: human,
				designService: request.designService,
				...expectedRevisionOf(body),
			});
			return c.json(result);
		}),
	);
};
