import { queryOptions } from "@tanstack/react-query";
import type { DesignFileRevision } from "../services/design-file-service.types";
import type { DesignManifest } from "../stores/design-merge";
import type { DesignPartRevisions } from "../stores/design-store";
import type { Node, TrickroomDesign, TrickroomDesignSummary } from "../types";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export const designSummariesQueryKey = ["trickroom-designs"];
export const designSummariesProjectQueryKey = (
	projectScope?: ProjectQueryScope,
) => withProjectQueryScope(designSummariesQueryKey, projectScope);
export const designFileQueryKey = (
	designId: string,
	projectScope?: ProjectQueryScope,
) => withProjectQueryScope(["trickroom-design", designId], projectScope);

export type DesignFileSnapshot = {
	design: TrickroomDesign;
	revision: DesignFileRevision;
	/**
	 * Set on save results that kept another writer's changes the saved design
	 * did not have: `design` is the merged design on disk.
	 */
	merged?: boolean;
	/** The revision of the manifest and of every board, when the server reports them. */
	parts?: DesignPartRevisions;
};

const revisionHeaderName = "x-trickroom-revision";
const mergedHeaderName = "x-trickroom-design-merged";
const expectedRevisionHeaderName = "x-trickroom-expected-revision";
const designStateHeaderName = "x-trickroom-design-state";

const isRevisionEntry = (
	value: unknown,
): value is { id: string; revision: string } =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { id?: unknown }).id === "string" &&
	typeof (value as { revision?: unknown }).revision === "string";

/** Reads `{ manifest, boards }` revisions; undefined when malformed. */
export const parseDesignPartRevisions = (
	value: unknown,
): DesignPartRevisions | undefined => {
	if (
		typeof value !== "object" ||
		value === null ||
		typeof (value as { manifest?: unknown }).manifest !== "string"
	) {
		return undefined;
	}
	const boards = (value as { boards?: unknown }).boards;
	if (!Array.isArray(boards) || !boards.every(isRevisionEntry)) {
		return undefined;
	}
	return {
		manifest: (value as { manifest: string }).manifest,
		boards: boards.map(({ id, revision }) => ({ id, revision })),
	};
};

const readDesignParts = (response: Response) => {
	const header = response.headers.get(designStateHeaderName);
	if (!header) return undefined;
	try {
		return parseDesignPartRevisions(JSON.parse(decodeURIComponent(header)));
	} catch {
		return undefined;
	}
};

const readDesignSnapshot = async (
	response: Response,
): Promise<DesignFileSnapshot> => {
	const design = await readJsonOrThrow<TrickroomDesign>(response);
	const revision = response.headers.get(revisionHeaderName);
	if (!revision) {
		throw new Error("Design response did not include a revision");
	}
	const parts = readDesignParts(response);

	return {
		design,
		revision,
		...(response.headers.get(mergedHeaderName) === "true"
			? { merged: true }
			: {}),
		...(parts ? { parts } : {}),
	};
};

export type DesignBoardSnapshot = { board: Node; revision: string };

/** One board with its revision; null when the design no longer has it. */
export const fetchDesignBoard = async (
	designId: string,
	boardId: string,
): Promise<DesignBoardSnapshot | null> => {
	const query = new URLSearchParams({ id: designId, board: boardId });
	const response = await fetch(
		`/api/trickroom/design/board?${query.toString()}`,
	);
	if (response.status === 404) {
		return null;
	}
	return readJsonOrThrow<DesignBoardSnapshot>(response);
};

export type DesignManifestSnapshot = {
	revision: DesignFileRevision;
	manifest: DesignManifest;
	manifestRevision: string;
	boards: { id: string; revision: string }[];
};

/** The design's top-level fields and the revision of every part. */
export const fetchDesignManifest = async (
	designId: string,
): Promise<DesignManifestSnapshot> => {
	const query = new URLSearchParams({ id: designId });
	const response = await fetch(
		`/api/trickroom/design/manifest?${query.toString()}`,
	);
	return readJsonOrThrow<DesignManifestSnapshot>(response);
};

export const fetchDesignFile = async (designId: string) => {
	const query = new URLSearchParams({ id: designId });
	const response = await fetch(`/api/trickroom/design?${query.toString()}`);
	return readDesignSnapshot(response);
};

const fetchDesignSummaries = async () => {
	const response = await fetch("/api/trickroom/designs");
	return readJsonOrThrow<TrickroomDesignSummary[]>(response);
};

const saveQueues = new Map<string, Promise<unknown>>();

const putDesignFile = async (
	designId: string,
	design: TrickroomDesign,
	expectedRevision?: DesignFileRevision | null,
) => {
	const query = new URLSearchParams({ id: designId });
	const response = await fetch(`/api/trickroom/design?${query.toString()}`, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
			...(expectedRevision
				? { [expectedRevisionHeaderName]: expectedRevision }
				: {}),
		},
		body: JSON.stringify(design),
	});

	return readDesignSnapshot(response);
};

export const saveDesignFile = (
	designId: string,
	design: TrickroomDesign,
	expectedRevision?: DesignFileRevision | null,
) => {
	const previousSave = saveQueues.get(designId);
	const queuedSave = previousSave
		? previousSave
				.catch(() => undefined)
				.then(() => putDesignFile(designId, design, expectedRevision))
		: putDesignFile(designId, design, expectedRevision);

	saveQueues.set(designId, queuedSave);
	queuedSave.then(
		() => {
			if (saveQueues.get(designId) === queuedSave) {
				saveQueues.delete(designId);
			}
		},
		() => {
			if (saveQueues.get(designId) === queuedSave) {
				saveQueues.delete(designId);
			}
		},
	);

	return queuedSave;
};

export const renameDesignFile = async (designId: string, name: string) => {
	const snapshot = await fetchDesignFile(designId);
	return saveDesignFile(
		designId,
		{ ...snapshot.design, name },
		snapshot.revision,
	);
};

export const deleteDesignFile = async (designId: string) => {
	const query = new URLSearchParams({ id: designId });
	const response = await fetch(`/api/trickroom/design?${query.toString()}`, {
		method: "DELETE",
	});

	return readJsonOrThrow<{ ok: true }>(response);
};

export const createDesignFile = async (
	designId: string,
	design: TrickroomDesign,
) => {
	const query = new URLSearchParams({ id: designId });
	const response = await fetch(`/api/trickroom/design?${query.toString()}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(design),
	});

	return readJsonOrThrow<TrickroomDesign>(response);
};

export const extractDesignSubtreeToFile = async ({
	sourceDesignId,
	targetDesignId,
	elementId,
	name,
}: {
	sourceDesignId: string;
	targetDesignId: string;
	elementId: string;
	name?: string;
}) => {
	const response = await fetch("/api/trickroom/design/extract", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			sourceDesignId,
			targetDesignId,
			elementId,
			...(name !== undefined ? { name } : {}),
		}),
	});

	return readJsonOrThrow<TrickroomDesign>(response);
};

export const designFileQueryOptions = (
	designId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: designFileQueryKey(designId, projectScope),
		queryFn: () => fetchDesignFile(designId),
	});

export const designSummariesQueryOptions = (projectScope?: ProjectQueryScope) =>
	queryOptions({
		queryKey: designSummariesProjectQueryKey(projectScope),
		queryFn: fetchDesignSummaries,
	});
