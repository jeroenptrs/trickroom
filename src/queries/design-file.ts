import { queryOptions } from "@tanstack/react-query";
import type { DesignFileRevision } from "../services/design-file-service.types";
import type { TrickroomDesign, TrickroomDesignSummary } from "../types";
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
};

const revisionHeaderName = "x-trickroom-revision";
const expectedRevisionHeaderName = "x-trickroom-expected-revision";

const readDesignSnapshot = async (response: Response) => {
	const design = await readJsonOrThrow<TrickroomDesign>(response);
	const revision = response.headers.get(revisionHeaderName);
	if (!revision) {
		throw new Error("Design response did not include a revision");
	}

	return { design, revision };
};

const fetchDesignFile = async (designId: string) => {
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
