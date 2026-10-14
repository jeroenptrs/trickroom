import { createStore, shallow, useSelector } from "@tanstack/react-store";
import { isAnnotationTarget } from "../services/annotation-model";
import type { AnnotationTarget } from "../services/annotations.types";
import { annotationTargetKey } from "../utils/annotation-presentation";

// Annotations the designer is still writing: a new annotation per target,
// and a reply per annotation. Nothing here reaches disk until Send; once an
// annotation is on disk it is in front of a working agent within one tool
// call, so a half-written remark must never be. Kept in the browser's
// `sessionStorage` per project, so a reload of the tab keeps them.

export type AnnotationDraft = {
	/** `annotationTargetKey(target)`. */
	key: string;
	target: AnnotationTarget;
	body: string;
	updatedAt: number;
};

export type AnnotationDraftState = {
	/** The project the drafts belong to; null before one is open. */
	projectScope: string | null;
	/** New annotations, by target key. */
	drafts: Record<string, AnnotationDraft>;
	/** Replies, by annotation id. */
	replies: Record<string, string>;
};

const STORAGE_PREFIX = "trickroom:annotation-drafts:";
const STORAGE_VERSION = 1;

export const annotationDraftStorageKey = (projectScope: string) =>
	`${STORAGE_PREFIX}${projectScope}`;

const emptyState = (projectScope: string | null): AnnotationDraftState => ({
	projectScope,
	drafts: {},
	replies: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const getSessionStorage = () => {
	try {
		return typeof window === "undefined" ? null : window.sessionStorage;
	} catch {
		return null;
	}
};

/** Reads what a project's drafts were, keeping whatever entries are valid. */
export function readStoredAnnotationDrafts(
	projectScope: string,
): AnnotationDraftState {
	const state = emptyState(projectScope);
	try {
		const raw = getSessionStorage()?.getItem(
			annotationDraftStorageKey(projectScope),
		);
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) {
			return state;
		}
		if (Array.isArray(parsed.drafts)) {
			for (const entry of parsed.drafts) {
				if (
					!isRecord(entry) ||
					!isAnnotationTarget(entry.target) ||
					typeof entry.body !== "string" ||
					entry.body.trim() === ""
				) {
					continue;
				}
				const key = annotationTargetKey(entry.target);
				state.drafts[key] = {
					key,
					target: entry.target,
					body: entry.body,
					updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
				};
			}
		}
		if (isRecord(parsed.replies)) {
			for (const [annotationId, body] of Object.entries(parsed.replies)) {
				if (typeof body === "string" && body.trim() !== "") {
					state.replies[annotationId] = body;
				}
			}
		}
	} catch {
		// Unreadable storage or JSON starts without drafts.
	}
	return state;
}

function persist(state: AnnotationDraftState) {
	if (!state.projectScope) {
		return;
	}
	try {
		const storage = getSessionStorage();
		if (!storage) return;
		const key = annotationDraftStorageKey(state.projectScope);
		const drafts = Object.values(state.drafts);
		const replies = Object.entries(state.replies);
		if (drafts.length === 0 && replies.length === 0) {
			storage.removeItem(key);
			return;
		}
		storage.setItem(
			key,
			JSON.stringify({
				version: STORAGE_VERSION,
				drafts: drafts.map(({ target, body, updatedAt }) => ({
					target,
					body,
					updatedAt,
				})),
				replies: state.replies,
			}),
		);
	} catch {
		// A full or unavailable storage only loses the copy, not the drafts.
	}
}

export const annotationDraftStore = createStore<AnnotationDraftState>(
	emptyState(null),
);

annotationDraftStore.subscribe((state) => persist(state));

/** Switches to a project's drafts (what this tab kept for it). */
export function loadAnnotationDrafts(projectScope: string | null) {
	if (annotationDraftStore.get().projectScope === projectScope) {
		return;
	}
	annotationDraftStore.setState(() =>
		projectScope ? readStoredAnnotationDrafts(projectScope) : emptyState(null),
	);
}

/** Writes a new annotation's draft; an empty body discards it. */
export function setAnnotationDraft(target: AnnotationTarget, body: string) {
	const key = annotationTargetKey(target);
	annotationDraftStore.setState((state) => {
		const drafts = { ...state.drafts };
		if (body.trim() === "") {
			if (!drafts[key]) return state;
			delete drafts[key];
		} else {
			drafts[key] = { key, target, body, updatedAt: Date.now() };
		}
		return { ...state, drafts };
	});
}

export function discardAnnotationDrafts(keys: readonly string[]) {
	annotationDraftStore.setState((state) => {
		if (!keys.some((key) => state.drafts[key])) return state;
		const drafts = { ...state.drafts };
		for (const key of keys) delete drafts[key];
		return { ...state, drafts };
	});
}

export function setReplyDraft(annotationId: string, body: string) {
	annotationDraftStore.setState((state) => {
		const replies = { ...state.replies };
		if (body.trim() === "") {
			if (!(annotationId in replies)) return state;
			delete replies[annotationId];
		} else {
			replies[annotationId] = body;
		}
		return { ...state, replies };
	});
}

export function getAnnotationDrafts() {
	return Object.values(annotationDraftStore.get().drafts);
}

export function useAnnotationDraft(targetKey: string | null) {
	return useSelector(annotationDraftStore, (state) =>
		targetKey ? (state.drafts[targetKey] ?? null) : null,
	);
}

export function useReplyDraft(annotationId: string) {
	return useSelector(
		annotationDraftStore,
		(state) => state.replies[annotationId] ?? "",
	);
}

/** Drafts whose target passes `filter`, oldest first. */
export function useAnnotationDrafts(
	filter: (draft: AnnotationDraft) => boolean,
) {
	return useSelector(
		annotationDraftStore,
		(state) =>
			Object.values(state.drafts)
				.filter(filter)
				.sort((a, b) => a.updatedAt - b.updatedAt),
		{ compare: shallow },
	);
}
