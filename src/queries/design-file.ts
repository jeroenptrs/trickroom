import { queryOptions } from "@tanstack/react-query";
import type { DesignFileRevision } from "../services/design-file-service.types";
import type { TrickroomDesign, TrickroomDesignSummary } from "../types";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export const getDesignFileForUuid = (uuid: string) => `${uuid}.json`;

export const designSummariesQueryKey = ["trickroom-designs"];
export const designSummariesProjectQueryKey = (
	projectScope?: ProjectQueryScope,
) => withProjectQueryScope(designSummariesQueryKey, projectScope);
export const designFileQueryKey = (
	file: string,
	projectScope?: ProjectQueryScope,
) => withProjectQueryScope(["trickroom-design", file], projectScope);

export type DesignFileSnapshot = {
	design: TrickroomDesign;
	revision: DesignFileRevision;
};

const revisionHeaderName = "x-trickroom-revision";
const expectedRevisionHeaderName = "x-trickroom-expected-revision";

const readDesignSnapshot = async (response: Response) => {
	const design = await readJsonOrThrow<TrickroomDesign>(response);
	const revision = response.headers.get(revisionHeaderName);
	if (!revision?.startsWith("sha256:")) {
		throw new Error("Design response did not include a valid revision");
	}

	return { design, revision: revision as DesignFileRevision };
};

const fetchDesignFile = async (file: string) => {
	const query = new URLSearchParams({ file });
	const response = await fetch(`/api/trickroom/design?${query.toString()}`);
	return readDesignSnapshot(response);
};

const fetchDesignSummaries = async () => {
	const response = await fetch("/api/trickroom/designs");
	return readJsonOrThrow<TrickroomDesignSummary[]>(response);
};

const saveQueues = new Map<string, Promise<unknown>>();

const putDesignFile = async (
	file: string,
	design: TrickroomDesign,
	expectedRevision?: DesignFileRevision | null,
) => {
	const query = new URLSearchParams({ file });
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
	file: string,
	design: TrickroomDesign,
	expectedRevision?: DesignFileRevision | null,
) => {
	const previousSave = saveQueues.get(file);
	const queuedSave = previousSave
		? previousSave
				.catch(() => undefined)
				.then(() => putDesignFile(file, design, expectedRevision))
		: putDesignFile(file, design, expectedRevision);

	saveQueues.set(file, queuedSave);
	queuedSave.then(
		() => {
			if (saveQueues.get(file) === queuedSave) {
				saveQueues.delete(file);
			}
		},
		() => {
			if (saveQueues.get(file) === queuedSave) {
				saveQueues.delete(file);
			}
		},
	);

	return queuedSave;
};

export const renameDesignFile = async (file: string, name: string) => {
	const snapshot = await fetchDesignFile(file);
	return saveDesignFile(file, { ...snapshot.design, name }, snapshot.revision);
};

export const deleteDesignFile = async (file: string) => {
	const query = new URLSearchParams({ file });
	const response = await fetch(`/api/trickroom/design?${query.toString()}`, {
		method: "DELETE",
	});

	return readJsonOrThrow<{ ok: true }>(response);
};

export const createDesignFile = async (
	file: string,
	design: TrickroomDesign,
) => {
	const query = new URLSearchParams({ file });
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
	sourceFile,
	targetFile,
	elementId,
	name,
}: {
	sourceFile: string;
	targetFile: string;
	elementId: string;
	name?: string;
}) => {
	const response = await fetch("/api/trickroom/design/extract", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			sourceFile,
			targetFile,
			elementId,
			...(name !== undefined ? { name } : {}),
		}),
	});

	return readJsonOrThrow<TrickroomDesign>(response);
};

export const designFileQueryOptions = (
	file: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: designFileQueryKey(file, projectScope),
		queryFn: () => fetchDesignFile(file),
	});

export const designSummariesQueryOptions = (projectScope?: ProjectQueryScope) =>
	queryOptions({
		queryKey: designSummariesProjectQueryKey(projectScope),
		queryFn: fetchDesignSummaries,
	});
