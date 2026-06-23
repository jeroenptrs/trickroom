import { type QueryClient, queryOptions } from "@tanstack/react-query";
import type {
	MemoryCategory,
	MemoryNote,
	MemoryScopeRef,
	MemorySummary,
} from "../utils/memory-manifest-service.types";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export type {
	MemoryCategory,
	MemoryNote,
	MemorySummary,
} from "../utils/memory-manifest-service.types";

export type MemoryReferenceType =
	| "design"
	| "component"
	| "token"
	| "asset"
	| "icon";

export type MemoryReferenceTarget = {
	id: string;
	label: string;
	detail?: string;
};

export type ReferenceTargetsResponse = {
	scope: MemoryScopeRef;
	type: MemoryReferenceType;
	targets: MemoryReferenceTarget[];
};

export type MemoryQueryScope =
	| { kind: "system"; systemId: string }
	| { kind: "design"; designId: string }
	| { kind: "project" };

export type MemoryListResponse = {
	scope: MemoryScopeRef;
	revision: string;
	exists: boolean;
	summary: MemorySummary;
	notes: MemoryNote[];
};

export type MemoryNoteResponse = {
	scope: MemoryScopeRef;
	revision: string;
	note: MemoryNote;
};

export type MemoryWriteResponse = {
	scope: MemoryScopeRef;
	newRevision: string;
	note: MemoryNote;
};

export type DeleteMemoryNoteResponse = {
	scope: MemoryScopeRef;
	newRevision: string;
	noteId: string;
	deleted: true;
};

export type CreateMemoryNoteParams = {
	body: string;
	category: MemoryCategory;
	title?: string;
	tags?: string[];
	pinned?: boolean;
	order?: number;
	authorLabel?: string;
	expectedRevision?: string;
};

export type UpdateMemoryNoteParams = {
	expectedRevision: string;
	body?: string;
	category?: MemoryCategory;
	title?: string | null;
	tags?: string[] | null;
	pinned?: boolean | null;
	order?: number | null;
	authorLabel?: string;
};

const memoryBaseUrl = (scope: MemoryQueryScope): string => {
	if (scope.kind === "system") {
		return `/api/trickroom/systems/${encodeURIComponent(scope.systemId)}/memory`;
	}
	if (scope.kind === "design") {
		return `/api/trickroom/designs/${encodeURIComponent(scope.designId)}/memory`;
	}
	return "/api/trickroom/memory";
};

const memoryScopeKeyPart = (scope: MemoryQueryScope): readonly unknown[] => {
	if (scope.kind === "system") {
		return [scope.kind, scope.systemId];
	}
	if (scope.kind === "design") {
		return [scope.kind, scope.designId];
	}
	return [scope.kind];
};

export const memoryQueryKey = (
	scope: MemoryQueryScope,
	projectScope?: ProjectQueryScope,
) =>
	withProjectQueryScope(
		["trickroom-memory", ...memoryScopeKeyPart(scope)],
		projectScope,
	);

const fetchMemoryNotes = async (scope: MemoryQueryScope) => {
	const response = await fetch(memoryBaseUrl(scope));
	return readJsonOrThrow<MemoryListResponse>(response);
};

export const memoryQueryOptions = (
	scope: MemoryQueryScope,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: memoryQueryKey(scope, projectScope),
		queryFn: () => fetchMemoryNotes(scope),
		retry: false,
	});

export const createMemoryNote = async (
	scope: MemoryQueryScope,
	params: CreateMemoryNoteParams,
) => {
	const response = await fetch(memoryBaseUrl(scope), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(params),
	});
	return readJsonOrThrow<MemoryWriteResponse>(response);
};

export const updateMemoryNote = async (
	scope: MemoryQueryScope,
	noteId: string,
	params: UpdateMemoryNoteParams,
) => {
	const response = await fetch(
		`${memoryBaseUrl(scope)}/${encodeURIComponent(noteId)}`,
		{
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		},
	);
	return readJsonOrThrow<MemoryWriteResponse>(response);
};

export const deleteMemoryNote = async (
	scope: MemoryQueryScope,
	noteId: string,
	expectedRevision: string,
) => {
	const response = await fetch(
		`${memoryBaseUrl(scope)}/${encodeURIComponent(noteId)}`,
		{
			method: "DELETE",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ expectedRevision }),
		},
	);
	return readJsonOrThrow<DeleteMemoryNoteResponse>(response);
};

export const referenceTargetsQueryKey = (
	scope: MemoryQueryScope,
	type: MemoryReferenceType,
	query: string,
	projectScope?: ProjectQueryScope,
) =>
	withProjectQueryScope(
		[
			"trickroom-memory-reference-targets",
			...memoryScopeKeyPart(scope),
			type,
			query,
		],
		projectScope,
	);

const fetchReferenceTargets = async (
	scope: MemoryQueryScope,
	type: MemoryReferenceType,
	query: string,
) => {
	const params = new URLSearchParams({ type });
	if (query) {
		params.set("query", query);
	}
	const response = await fetch(
		`${memoryBaseUrl(scope)}/reference-targets?${params.toString()}`,
	);
	return readJsonOrThrow<ReferenceTargetsResponse>(response);
};

export const referenceTargetsQueryOptions = (
	scope: MemoryQueryScope,
	type: MemoryReferenceType,
	query = "",
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: referenceTargetsQueryKey(scope, type, query, projectScope),
		queryFn: () => fetchReferenceTargets(scope, type, query),
		retry: false,
	});

export const invalidateMemory = (
	queryClient: QueryClient,
	scope: MemoryQueryScope,
	projectScope?: ProjectQueryScope,
) =>
	queryClient.invalidateQueries({
		queryKey: memoryQueryKey(scope, projectScope),
	});
